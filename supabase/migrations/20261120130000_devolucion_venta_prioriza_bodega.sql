-- Al devolver ventas, priorizar bodega sucursal (fuente de control actual).
-- Antes se devolvía primero a nevera si la orden tenía neto histórico en nevera,
-- y el stock de bodega no se recuperaba (p. ej. Coca en Extra no reaparecía).

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

    v_neto_nevera := GREATEST(COALESCE(v_neto_nevera, 0), 0);
    v_neto_bodega := GREATEST(COALESCE(v_neto_bodega, 0), 0);
    v_cantidad := LEAST(v_cantidad, v_neto_nevera + v_neto_bodega);
    IF v_cantidad <= 0 THEN
      RETURN;
    END IF;

    -- Priorizar devolver a bodega (control actual); nevera solo remanente histórico.
    v_qty_bodega := LEAST(v_cantidad, v_neto_bodega);
    v_qty_nevera := v_cantidad - v_qty_bodega;
  ELSE
    -- SALIDA: solo bodega sucursal.
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

    IF v_anterior_bodega < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_label,
        trim(both from to_char(v_anterior_bodega, 'FM999999999990.999')),
        trim(both from to_char(v_cantidad, 'FM999999999990.999'));
    END IF;

    v_qty_nevera := 0;
    v_qty_bodega := v_cantidad;
  END IF;

  IF v_qty_nevera > 0 THEN
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

    UPDATE public.inventario_productos
    SET cantidad_disponible = v_nueva_nevera
    WHERE id = v_inventario_nevera_id;

    INSERT INTO public.movimientos_inventario (
      producto_id, sucursal_id, tipo_movimiento, cantidad_movimiento,
      cantidad_anterior, cantidad_nueva, motivo, registrado_por, registrado_por_nombre,
      order_id, order_item_id, origen_venta
    )
    VALUES (
      p_producto_id, v_inventario_sucursal_id, 'INGRESO', v_qty_nevera,
      v_anterior_nevera, v_nueva_nevera, v_motivo,
      COALESCE(p_actor_id, auth.uid()), v_registrado_nombre,
      p_order_id, p_order_item_id, p_origen_venta
    );
  END IF;

  IF v_qty_bodega > 0 THEN
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
            '0',
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
          trim(both from to_char(v_anterior_bodega, 'FM999999999990.999')),
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

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
