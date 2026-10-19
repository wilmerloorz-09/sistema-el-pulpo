-- =============================================================================
-- Venta: Nevera primero; si se agota, Bodega sucursal (excepto El Pulpo 1).
-- P1 Mañana / P1 Tarde (inventario compartido): solo Nevera, igual que hoy.
-- =============================================================================

-- Trazabilidad de ventas en bodega sucursal (para devolver al anular/editar).
ALTER TABLE public.movimientos_bodega_sucursal
  ADD COLUMN IF NOT EXISTS order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid NULL REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origen_venta text NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_sucursal_order_item
  ON public.movimientos_bodega_sucursal (order_item_id)
  WHERE order_item_id IS NOT NULL AND origen_venta IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_sucursal_order
  ON public.movimientos_bodega_sucursal (order_id)
  WHERE order_id IS NOT NULL AND origen_venta IS NOT NULL;

COMMENT ON COLUMN public.movimientos_bodega_sucursal.origen_venta IS
  'Si no es NULL, el movimiento proviene de una venta (mismo criterio que movimientos_inventario).';

-- True = solo nevera (El Pulpo 1 y sucursales que usan su inventario).
CREATE OR REPLACE FUNCTION public.inventario_venta_solo_nevera(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = public.inventario_sucursal_efectiva(p_sucursal_id)
      AND b.name ~* '^el pulpo 1\M'
  );
$$;

REVOKE ALL ON FUNCTION public.inventario_venta_solo_nevera(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_venta_solo_nevera(uuid) TO authenticated, service_role;

-- Neto descontado (nevera + bodega sucursal) por línea de orden.
CREATE OR REPLACE FUNCTION public.inventario_neto_descontado_item(p_order_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(
        CASE WHEN mi.tipo_movimiento = 'SALIDA' THEN mi.cantidad_movimiento ELSE -mi.cantidad_movimiento END
      )
      FROM public.movimientos_inventario mi
      WHERE mi.order_item_id = p_order_item_id
        AND mi.origen_venta IS NOT NULL
        AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO')
    ), 0)
    +
    COALESCE((
      SELECT SUM(
        CASE WHEN mbs.tipo_movimiento = 'SALIDA' THEN mbs.cantidad_movimiento ELSE -mbs.cantidad_movimiento END
      )
      FROM public.movimientos_bodega_sucursal mbs
      WHERE mbs.order_item_id = p_order_item_id
        AND mbs.origen_venta IS NOT NULL
        AND mbs.tipo_movimiento IN ('SALIDA', 'INGRESO')
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.inventario_movimiento_venta_internal(
  p_sucursal_id uuid,
  p_producto_id uuid,
  p_cantidad numeric,
  p_tipo_movimiento public.tipo_movimiento_inventario,
  p_order_id uuid,
  p_order_item_id uuid,
  p_origen_venta text,
  p_actor_id uuid,
  p_etiqueta_producto text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cantidad numeric(14, 3);
  v_qty_nevera numeric(14, 3) := 0;
  v_qty_bodega numeric(14, 3) := 0;
  v_neto_nevera numeric(14, 3) := 0;
  v_neto_bodega numeric(14, 3) := 0;
  v_anterior_nevera numeric(14, 3) := 0;
  v_nueva_nevera numeric(14, 3);
  v_anterior_bodega numeric(14, 3) := 0;
  v_nueva_bodega numeric(14, 3);
  v_inventario_nevera_id uuid;
  v_inventario_bodega_id uuid;
  v_registrado_nombre text;
  v_motivo text;
  v_label text;
  v_inventario_sucursal_id uuid;
  v_solo_nevera boolean;
  v_disponible_total numeric(14, 3);
BEGIN
  IF NOT public.inventario_debe_controlar_venta(p_sucursal_id, p_producto_id) THEN
    RETURN;
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);
  IF v_cantidad <= 0 THEN
    RETURN;
  END IF;

  IF p_tipo_movimiento NOT IN ('INGRESO', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo de movimiento de venta no soportado: %', p_tipo_movimiento;
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);
  v_solo_nevera := public.inventario_venta_solo_nevera(p_sucursal_id);

  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta_producto), ''),
    NULLIF(btrim(p.description), ''),
    NULLIF(btrim(oi.description_snapshot), ''),
    'Producto'
  )
  INTO v_label
  FROM public.products p
  LEFT JOIN public.order_items oi ON oi.id = p_order_item_id
  WHERE p.id = p_producto_id;

  v_label := COALESCE(v_label, 'Producto');

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = p_actor_id;
  v_registrado_nombre := COALESCE(v_registrado_nombre, 'Usuario');

  -- Cap de devolución: solo lo realmente descontado de cada ubicación para la línea/orden.
  IF p_tipo_movimiento = 'INGRESO' AND (p_order_item_id IS NOT NULL OR p_order_id IS NOT NULL) THEN
    SELECT COALESCE(SUM(
      CASE WHEN mi.tipo_movimiento = 'SALIDA' THEN mi.cantidad_movimiento ELSE -mi.cantidad_movimiento END
    ), 0)
    INTO v_neto_nevera
    FROM public.movimientos_inventario mi
    WHERE mi.sucursal_id = v_inventario_sucursal_id
      AND mi.producto_id = p_producto_id
      AND mi.origen_venta IS NOT NULL
      AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO')
      AND (mi.order_item_id = p_order_item_id OR mi.order_id = p_order_id);

    IF NOT v_solo_nevera THEN
      SELECT COALESCE(SUM(
        CASE WHEN mbs.tipo_movimiento = 'SALIDA' THEN mbs.cantidad_movimiento ELSE -mbs.cantidad_movimiento END
      ), 0)
      INTO v_neto_bodega
      FROM public.movimientos_bodega_sucursal mbs
      WHERE mbs.sucursal_id = v_inventario_sucursal_id
        AND mbs.producto_global_id = p_producto_id
        AND mbs.origen_venta IS NOT NULL
        AND mbs.tipo_movimiento IN ('SALIDA', 'INGRESO')
        AND (mbs.order_item_id = p_order_item_id OR mbs.order_id = p_order_id);
    END IF;

    v_neto_nevera := GREATEST(COALESCE(v_neto_nevera, 0), 0);
    v_neto_bodega := GREATEST(COALESCE(v_neto_bodega, 0), 0);
    v_cantidad := LEAST(v_cantidad, v_neto_nevera + v_neto_bodega);
    IF v_cantidad <= 0 THEN
      RETURN;
    END IF;

    -- Devolver primero a nevera (espejo de "siempre primero nevera" al descontar).
    v_qty_nevera := LEAST(v_cantidad, v_neto_nevera);
    v_qty_bodega := v_cantidad - v_qty_nevera;
  ELSE
    -- SALIDA: lock stocks y repartir.
    SELECT ip.id, ip.cantidad_disponible
    INTO v_inventario_nevera_id, v_anterior_nevera
    FROM public.inventario_productos ip
    WHERE ip.producto_id = p_producto_id
      AND ip.sucursal_id = v_inventario_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_anterior_nevera := 0;
      INSERT INTO public.inventario_productos (
        producto_id, sucursal_id, cantidad_disponible, integra_con_ventas, activo
      )
      VALUES (p_producto_id, v_inventario_sucursal_id, 0, true, true)
      RETURNING id, cantidad_disponible
      INTO v_inventario_nevera_id, v_anterior_nevera;
    END IF;
    v_anterior_nevera := COALESCE(v_anterior_nevera, 0);

    IF v_solo_nevera THEN
      v_anterior_bodega := 0;
    ELSE
      SELECT ibs.id, ibs.cantidad_disponible
      INTO v_inventario_bodega_id, v_anterior_bodega
      FROM public.inventario_bodega_sucursal ibs
      WHERE ibs.producto_global_id = p_producto_id
        AND ibs.sucursal_id = v_inventario_sucursal_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_anterior_bodega := 0;
        v_inventario_bodega_id := NULL;
      ELSE
        v_anterior_bodega := COALESCE(v_anterior_bodega, 0);
      END IF;
    END IF;

    v_disponible_total := v_anterior_nevera + CASE WHEN v_solo_nevera THEN 0 ELSE v_anterior_bodega END;
    IF v_disponible_total < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_label,
        trim(both from to_char(v_disponible_total, 'FM999999999990.999')),
        trim(both from to_char(v_cantidad, 'FM999999999990.999'));
    END IF;

    v_qty_nevera := LEAST(v_anterior_nevera, v_cantidad);
    v_qty_bodega := v_cantidad - v_qty_nevera;
  END IF;

  -- Aplicar nevera
  IF v_qty_nevera > 0 THEN
    IF p_tipo_movimiento = 'INGRESO' THEN
      SELECT ip.id, ip.cantidad_disponible
      INTO v_inventario_nevera_id, v_anterior_nevera
      FROM public.inventario_productos ip
      WHERE ip.producto_id = p_producto_id
        AND ip.sucursal_id = v_inventario_sucursal_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_anterior_nevera := 0;
        INSERT INTO public.inventario_productos (
          producto_id, sucursal_id, cantidad_disponible, integra_con_ventas, activo
        )
        VALUES (p_producto_id, v_inventario_sucursal_id, 0, true, true)
        RETURNING id, cantidad_disponible
        INTO v_inventario_nevera_id, v_anterior_nevera;
      END IF;
      v_anterior_nevera := COALESCE(v_anterior_nevera, 0);
      v_nueva_nevera := v_anterior_nevera + v_qty_nevera;
      v_motivo := format('Devolución venta (%s)', COALESCE(p_origen_venta, 'INGRESO'));
    ELSE
      -- Ya bloqueado arriba en SALIDA
      IF v_inventario_nevera_id IS NULL THEN
        SELECT ip.id, ip.cantidad_disponible
        INTO v_inventario_nevera_id, v_anterior_nevera
        FROM public.inventario_productos ip
        WHERE ip.producto_id = p_producto_id
          AND ip.sucursal_id = v_inventario_sucursal_id
        FOR UPDATE;
        v_anterior_nevera := COALESCE(v_anterior_nevera, 0);
      END IF;
      v_nueva_nevera := v_anterior_nevera - v_qty_nevera;
      v_motivo := format('Venta (%s)', COALESCE(p_origen_venta, 'SALIDA'));
    END IF;

    UPDATE public.inventario_productos
    SET cantidad_disponible = v_nueva_nevera
    WHERE id = v_inventario_nevera_id;

    INSERT INTO public.movimientos_inventario (
      producto_id, sucursal_id, tipo_movimiento, cantidad_movimiento,
      cantidad_anterior, cantidad_nueva, motivo, registrado_por, registrado_por_nombre,
      order_id, order_item_id, origen_venta
    )
    VALUES (
      p_producto_id, v_inventario_sucursal_id, p_tipo_movimiento, v_qty_nevera,
      v_anterior_nevera, v_nueva_nevera, v_motivo,
      COALESCE(p_actor_id, auth.uid()), v_registrado_nombre,
      p_order_id, p_order_item_id, p_origen_venta
    );
  END IF;

  -- Aplicar bodega sucursal (solo sucursales con waterfall)
  IF v_qty_bodega > 0 AND NOT v_solo_nevera THEN
    IF p_tipo_movimiento = 'INGRESO' OR v_inventario_bodega_id IS NULL THEN
      SELECT ibs.id, ibs.cantidad_disponible
      INTO v_inventario_bodega_id, v_anterior_bodega
      FROM public.inventario_bodega_sucursal ibs
      WHERE ibs.producto_global_id = p_producto_id
        AND ibs.sucursal_id = v_inventario_sucursal_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF p_tipo_movimiento = 'SALIDA' THEN
          RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
            v_label,
            trim(both from to_char(COALESCE(v_anterior_nevera, 0), 'FM999999999990.999')),
            trim(both from to_char(v_cantidad, 'FM999999999990.999'));
        END IF;
        INSERT INTO public.inventario_bodega_sucursal (
          producto_global_id, sucursal_id, cantidad_disponible, integra_con_ventas, activo
        )
        VALUES (p_producto_id, v_inventario_sucursal_id, 0, true, true)
        RETURNING id, cantidad_disponible
        INTO v_inventario_bodega_id, v_anterior_bodega;
      END IF;
      v_anterior_bodega := COALESCE(v_anterior_bodega, 0);
    END IF;

    IF p_tipo_movimiento = 'SALIDA' THEN
      IF v_anterior_bodega < v_qty_bodega THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
          v_label,
          trim(both from to_char(v_anterior_nevera + v_anterior_bodega, 'FM999999999990.999')),
          trim(both from to_char(v_cantidad, 'FM999999999990.999'));
      END IF;
      v_nueva_bodega := v_anterior_bodega - v_qty_bodega;
      v_motivo := format('Venta (%s)', COALESCE(p_origen_venta, 'SALIDA'));
    ELSE
      v_nueva_bodega := v_anterior_bodega + v_qty_bodega;
      v_motivo := format('Devolución venta (%s)', COALESCE(p_origen_venta, 'INGRESO'));
    END IF;

    UPDATE public.inventario_bodega_sucursal
    SET cantidad_disponible = v_nueva_bodega
    WHERE id = v_inventario_bodega_id;

    INSERT INTO public.movimientos_bodega_sucursal (
      producto_global_id, sucursal_id, tipo_movimiento, cantidad_movimiento,
      cantidad_anterior, cantidad_nueva, motivo, registrado_por, registrado_por_nombre,
      order_id, order_item_id, origen_venta
    )
    VALUES (
      p_producto_id, v_inventario_sucursal_id, p_tipo_movimiento, v_qty_bodega,
      v_anterior_bodega, v_nueva_bodega, v_motivo,
      COALESCE(p_actor_id, auth.uid()), v_registrado_nombre,
      p_order_id, p_order_item_id, p_origen_venta
    );
  END IF;
END;
$function$;
