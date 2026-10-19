-- =============================================================================
-- Acompañamiento: 1 Chifle por cada Encebollado al enviar a cocina/despacho.
-- - Aplica en todas las sucursales excepto P1 (Mañana/Tarde).
-- - Si anulan, se devuelve el chifle descontado.
-- - No descuenta al agregar en borrador; solo en ENVIO (descontar_draft_orden).
-- =============================================================================

-- Neto descontado de un producto concreto en una línea (nevera + bodega sucursal).
CREATE OR REPLACE FUNCTION public.inventario_neto_descontado_item_producto(
  p_order_item_id uuid,
  p_producto_id uuid
)
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
        AND mi.producto_id = p_producto_id
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
        AND mbs.producto_global_id = p_producto_id
        AND mbs.origen_venta IS NOT NULL
        AND mbs.tipo_movimiento IN ('SALIDA', 'INGRESO')
    ), 0);
$$;

REVOKE ALL ON FUNCTION public.inventario_neto_descontado_item_producto(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_neto_descontado_item_producto(uuid, uuid) TO authenticated, service_role;

-- Neto de la línea = solo el producto de la línea (no acompañamientos).
CREATE OR REPLACE FUNCTION public.inventario_neto_descontado_item(p_order_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.inventario_neto_descontado_item_producto(p_order_item_id, oi.product_id),
    0
  )
  FROM public.order_items oi
  WHERE oi.id = p_order_item_id;
$$;

CREATE OR REPLACE FUNCTION public.inventario_producto_chifle_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg.id
  FROM public.productos_globales pg
  WHERE lower(btrim(pg.nombre_principal)) = 'chifle'
    AND COALESCE(pg.activo, true) = true
  ORDER BY pg.updated_at DESC NULLS LAST, pg.created_at DESC NULLS LAST, pg.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.inventario_producto_chifle_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_producto_chifle_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_es_encebollado(
  p_producto_id uuid,
  p_etiqueta text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(p_etiqueta), ''), '') ~* 'encebollad'
    OR EXISTS (
      SELECT 1
      FROM public.productos_globales pg
      WHERE pg.id = p_producto_id
        AND pg.nombre_principal ~* 'encebollad'
    )
    OR EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = p_producto_id
        AND p.description ~* 'encebollad'
    );
$$;

REVOKE ALL ON FUNCTION public.inventario_es_encebollado(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_es_encebollado(uuid, text) TO authenticated, service_role;

-- P1 Mañana/Tarde quedan fuera (misma regla que venta solo-nevera).
CREATE OR REPLACE FUNCTION public.inventario_aplica_chifle_por_encebollado(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_sucursal_id IS NOT NULL
    AND NOT public.inventario_venta_solo_nevera(p_sucursal_id);
$$;

REVOKE ALL ON FUNCTION public.inventario_aplica_chifle_por_encebollado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_aplica_chifle_por_encebollado(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_sincronizar_chifle_encebollado(
  p_sucursal_id uuid,
  p_order_id uuid,
  p_order_item_id uuid,
  p_producto_encebollado_id uuid,
  p_cantidad_objetivo numeric,
  p_actor_id uuid,
  p_etiqueta text DEFAULT NULL,
  p_origen_venta text DEFAULT 'ENVIO_CHIFLE'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chifle_id uuid;
  v_objetivo numeric(14, 3);
  v_neto numeric(14, 3);
  v_diff numeric(14, 3);
BEGIN
  IF NOT public.inventario_aplica_chifle_por_encebollado(p_sucursal_id) THEN
    RETURN;
  END IF;

  IF NOT public.inventario_es_encebollado(p_producto_encebollado_id, p_etiqueta) THEN
    RETURN;
  END IF;

  v_chifle_id := public.inventario_producto_chifle_id();
  IF v_chifle_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el producto global Chifle para descontar acompañamiento.';
  END IF;

  -- Evitar auto-referencia si alguien nombra mal un producto.
  IF v_chifle_id = p_producto_encebollado_id THEN
    RETURN;
  END IF;

  v_objetivo := round(GREATEST(COALESCE(p_cantidad_objetivo, 0), 0)::numeric, 3);
  v_neto := public.inventario_neto_descontado_item_producto(p_order_item_id, v_chifle_id);
  v_diff := v_objetivo - v_neto;

  IF v_diff > 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      p_sucursal_id,
      v_chifle_id,
      v_diff,
      'SALIDA'::public.tipo_movimiento_inventario,
      p_order_id,
      p_order_item_id,
      COALESCE(NULLIF(btrim(p_origen_venta), ''), 'ENVIO_CHIFLE'),
      p_actor_id,
      'Chifle (por encebollado)'
    );
  ELSIF v_diff < 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      p_sucursal_id,
      v_chifle_id,
      -v_diff,
      'INGRESO'::public.tipo_movimiento_inventario,
      p_order_id,
      p_order_item_id,
      COALESCE(NULLIF(btrim(p_origen_venta), ''), 'ENVIO_CHIFLE'),
      p_actor_id,
      'Chifle (por encebollado)'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_sincronizar_chifle_encebollado(uuid, uuid, uuid, uuid, numeric, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_sincronizar_chifle_encebollado(uuid, uuid, uuid, uuid, numeric, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_descontar_draft_orden(
  p_order_id uuid,
  p_sucursal_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_pendiente numeric(14, 3);
BEGIN
  FOR v_item IN
    SELECT
      oi.id,
      oi.product_id,
      oi.quantity,
      oi.description_snapshot
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status = 'DRAFT'
      AND COALESCE(oi.quantity, 0) > 0
      AND oi.product_id IS NOT NULL
  LOOP
    v_pendiente := v_item.quantity - public.inventario_neto_descontado_item(v_item.id);
    IF v_pendiente > 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        p_sucursal_id,
        v_item.product_id,
        v_pendiente,
        'SALIDA'::public.tipo_movimiento_inventario,
        p_order_id,
        v_item.id,
        'ENVIO',
        p_actor_id,
        v_item.description_snapshot
      );
    END IF;

    -- 1 chifle por cada unidad de encebollado enviada.
    PERFORM public.inventario_sincronizar_chifle_encebollado(
      p_sucursal_id,
      p_order_id,
      v_item.id,
      v_item.product_id,
      v_item.quantity,
      p_actor_id,
      v_item.description_snapshot,
      'ENVIO_CHIFLE'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventario_restaurar_por_order_item(
  p_sucursal_id uuid,
  p_order_item_id uuid,
  p_cantidad numeric,
  p_order_id uuid,
  p_actor_id uuid,
  p_origen_venta text DEFAULT 'CANCEL'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_chifle_id uuid;
  v_neto_chifle numeric(14, 3);
  v_devolver_chifle numeric(14, 3);
  v_cantidad numeric(14, 3);
BEGIN
  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);
  IF v_cantidad <= 0 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_order_item_id;

  IF NOT FOUND OR v_item.product_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.inventario_movimiento_venta_internal(
    p_sucursal_id,
    v_item.product_id,
    v_cantidad,
    'INGRESO'::public.tipo_movimiento_inventario,
    p_order_id,
    p_order_item_id,
    p_origen_venta,
    p_actor_id,
    v_item.description_snapshot
  );

  -- Devolver chifle acompañante si esta línea era encebollado.
  IF public.inventario_aplica_chifle_por_encebollado(p_sucursal_id)
     AND public.inventario_es_encebollado(v_item.product_id, v_item.description_snapshot)
  THEN
    v_chifle_id := public.inventario_producto_chifle_id();
    IF v_chifle_id IS NOT NULL AND v_chifle_id <> v_item.product_id THEN
      v_neto_chifle := public.inventario_neto_descontado_item_producto(p_order_item_id, v_chifle_id);
      v_devolver_chifle := LEAST(v_cantidad, GREATEST(v_neto_chifle, 0));
      IF v_devolver_chifle > 0 THEN
        PERFORM public.inventario_movimiento_venta_internal(
          p_sucursal_id,
          v_chifle_id,
          v_devolver_chifle,
          'INGRESO'::public.tipo_movimiento_inventario,
          p_order_id,
          p_order_item_id,
          COALESCE(NULLIF(btrim(p_origen_venta), ''), 'CANCEL') || '_CHIFLE',
          p_actor_id,
          'Chifle (por encebollado)'
        );
      END IF;
    END IF;
  END IF;
END;
$$;

-- Activar control de ventas de Chifle en bodega sucursal fuera de P1,
-- para que el descuento automático tenga efecto.
DO $$
DECLARE
  v_chifle_id uuid := public.inventario_producto_chifle_id();
  v_branch record;
  v_inv_sucursal uuid;
BEGIN
  IF v_chifle_id IS NULL THEN
    RAISE NOTICE 'Chifle global no encontrado; se omite activación integra_con_ventas';
    RETURN;
  END IF;

  FOR v_branch IN
    SELECT b.id, b.name
    FROM public.branches b
  LOOP
    IF public.inventario_venta_solo_nevera(v_branch.id) THEN
      CONTINUE;
    END IF;

    v_inv_sucursal := public.inventario_sucursal_efectiva(v_branch.id);

    INSERT INTO public.inventario_bodega_sucursal (
      producto_global_id, sucursal_id, cantidad_disponible, integra_con_ventas, activo
    )
    VALUES (v_chifle_id, v_inv_sucursal, 0, true, true)
    ON CONFLICT (producto_global_id, sucursal_id)
    DO UPDATE SET
      integra_con_ventas = true,
      activo = true;
  END LOOP;
END;
$$;
