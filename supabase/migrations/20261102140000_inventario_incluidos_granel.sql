-- =============================================================================
-- Granel (tray_item_type = C): descontar productos incluidos al agregar/ajustar
-- borrador y devolverlos al quitar/cancelar.
-- - Cantidad = included_quantity del rango que cubre unit_price * quantity de la línea.
-- - Encebollado granel NO usa la regla 1:1 chifle-por-encebollado (evita doble descuento);
--   la fuente de verdad es bulk_included_products / ranges.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.inventario_resolver_producto_venta_id(
  p_sucursal_id uuid,
  p_candidato_id uuid,
  p_etiqueta text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_global_id uuid;
BEGIN
  IF p_candidato_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF public.inventario_debe_controlar_venta(p_sucursal_id, p_candidato_id) THEN
    RETURN p_candidato_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.productos_globales pg WHERE pg.id = p_candidato_id
  ) THEN
    RETURN p_candidato_id;
  END IF;

  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta), ''),
    NULLIF(btrim(p.description), '')
  )
  INTO v_label
  FROM public.products p
  WHERE p.id = p_candidato_id;

  v_label := COALESCE(v_label, NULLIF(btrim(p_etiqueta), ''));
  IF v_label IS NULL THEN
    RETURN p_candidato_id;
  END IF;

  SELECT pg.id
  INTO v_global_id
  FROM public.productos_globales pg
  WHERE lower(btrim(pg.nombre_principal)) = lower(btrim(v_label))
    AND COALESCE(pg.activo, true) = true
  ORDER BY
    CASE WHEN public.inventario_debe_controlar_venta(p_sucursal_id, pg.id) THEN 0 ELSE 1 END,
    pg.updated_at DESC NULLS LAST,
    pg.created_at DESC NULLS LAST,
    pg.id
  LIMIT 1;

  RETURN COALESCE(v_global_id, p_candidato_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_resolver_producto_venta_id(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_resolver_producto_venta_id(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_producto_id_desde_menu_node(
  p_sucursal_id uuid,
  p_menu_node_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cand uuid;
  v_name text;
BEGIN
  IF p_menu_node_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(mn.legacy_product_id, mn.id), mn.name
  INTO v_cand, v_name
  FROM public.menu_nodes mn
  WHERE mn.id = p_menu_node_id;

  IF v_cand IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.inventario_resolver_producto_venta_id(p_sucursal_id, v_cand, v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_producto_id_desde_menu_node(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_producto_id_desde_menu_node(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_bulk_menu_node_para_item(
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mn.id
  FROM public.menu_nodes mn
  WHERE mn.branch_id = p_branch_id
    AND mn.menu_scope = 'BULK'
    AND mn.node_type = 'product'
    AND COALESCE(mn.legacy_product_id, mn.id) = p_product_id
  ORDER BY mn.is_active DESC, mn.updated_at DESC NULLS LAST, mn.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.inventario_bulk_menu_node_para_item(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_bulk_menu_node_para_item(uuid, uuid) TO authenticated, service_role;

-- Alinea inventario de productos incluidos de un ítem granel al objetivo actual.
CREATE OR REPLACE FUNCTION public.inventario_sincronizar_incluidos_granel(
  p_order_item_id uuid,
  p_actor_id uuid,
  p_origen text DEFAULT 'INCLUIDO_GRANEL',
  p_forzar_cero boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_bulk_node_id uuid;
  v_origen text;
  v_unit_price numeric(14, 2);
  v_qty_linea numeric(14, 3);
  v_asig record;
  v_qty_unit integer;
  v_objetivo numeric(14, 3);
  v_producto_id uuid;
  v_neto numeric(14, 3);
  v_diff numeric(14, 3);
  v_label text;
  v_targets uuid[] := ARRAY[]::uuid[];
  v_prev uuid;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.product_id IS NULL THEN
    RETURN;
  END IF;

  -- Solo granel (tipo C).
  IF upper(COALESCE(v_item.tray_item_type::text, '')) <> 'C' THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_bulk_node_id := public.inventario_bulk_menu_node_para_item(v_order.branch_id, v_item.product_id);
  IF v_bulk_node_id IS NULL THEN
    RETURN;
  END IF;

  v_origen := COALESCE(NULLIF(btrim(p_origen), ''), 'INCLUIDO_GRANEL');
  IF v_origen NOT ILIKE '%INCLUIDO_GRANEL%' THEN
    v_origen := v_origen || '_INCLUIDO_GRANEL';
  END IF;

  v_unit_price := round(COALESCE(v_item.unit_price, 0)::numeric, 2);
  v_qty_linea := GREATEST(COALESCE(v_item.quantity, 0), 0);

  FOR v_asig IN
    SELECT
      bip.id AS assignment_id,
      bip.included_node_id,
      COALESCE(NULLIF(btrim(inc.name), ''), 'Producto incluido') AS included_name
    FROM public.bulk_included_products bip
    JOIN public.menu_nodes inc ON inc.id = bip.included_node_id
    WHERE bip.menu_node_id = v_bulk_node_id
      AND bip.is_active = true
    ORDER BY bip.display_order NULLS LAST, bip.created_at, bip.id
  LOOP
    v_producto_id := public.inventario_producto_id_desde_menu_node(
      v_order.branch_id,
      v_asig.included_node_id
    );
    IF v_producto_id IS NULL OR v_producto_id = v_item.product_id THEN
      CONTINUE;
    END IF;

    v_targets := array_append(v_targets, v_producto_id);

    IF p_forzar_cero OR v_qty_linea <= 0 THEN
      v_objetivo := 0;
    ELSE
      SELECT r.included_quantity
      INTO v_qty_unit
      FROM public.bulk_included_product_ranges r
      WHERE r.bulk_included_product_id = v_asig.assignment_id
        AND v_unit_price >= r.amount_from
        AND v_unit_price <= r.amount_to
      ORDER BY r.display_order NULLS LAST, r.amount_from, r.id
      LIMIT 1;

      v_objetivo := round((COALESCE(v_qty_unit, 0)::numeric * v_qty_linea), 3);
    END IF;

    v_neto := public.inventario_neto_descontado_item_producto(p_order_item_id, v_producto_id);
    v_diff := v_objetivo - v_neto;
    v_label := v_asig.included_name || ' (incluido granel)';

    IF v_diff > 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_producto_id,
        v_diff,
        'SALIDA'::public.tipo_movimiento_inventario,
        v_order.id,
        v_item.id,
        v_origen,
        p_actor_id,
        v_label
      );
    ELSIF v_diff < 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_producto_id,
        -v_diff,
        'INGRESO'::public.tipo_movimiento_inventario,
        v_order.id,
        v_item.id,
        v_origen,
        p_actor_id,
        v_label
      );
    END IF;
  END LOOP;

  -- Cerrar neto de incluidos ya no configurados / fuera de rango (solo movimientos de este origen).
  FOR v_prev IN
    SELECT DISTINCT x.producto_id
    FROM (
      SELECT mi.producto_id
      FROM public.movimientos_inventario mi
      WHERE mi.order_item_id = p_order_item_id
        AND mi.origen_venta ILIKE '%INCLUIDO_GRANEL%'
        AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO')
      UNION
      SELECT mbs.producto_global_id
      FROM public.movimientos_bodega_sucursal mbs
      WHERE mbs.order_item_id = p_order_item_id
        AND mbs.origen_venta ILIKE '%INCLUIDO_GRANEL%'
        AND mbs.tipo_movimiento IN ('SALIDA', 'INGRESO')
    ) x
    WHERE x.producto_id IS NOT NULL
      AND x.producto_id <> v_item.product_id
      AND NOT (x.producto_id = ANY (v_targets))
  LOOP
    v_neto := public.inventario_neto_descontado_item_producto(p_order_item_id, v_prev);
    IF v_neto > 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_prev,
        v_neto,
        'INGRESO'::public.tipo_movimiento_inventario,
        v_order.id,
        v_item.id,
        v_origen,
        p_actor_id,
        'Incluido granel (ajuste)'
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_sincronizar_incluidos_granel(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_sincronizar_incluidos_granel(uuid, uuid, text, boolean) TO authenticated, service_role;

-- Devolución parcial/total de incluidos al cancelar cantidad de una línea granel ya enviada.
CREATE OR REPLACE FUNCTION public.inventario_devolver_incluidos_granel_parcial(
  p_sucursal_id uuid,
  p_order_item_id uuid,
  p_order_id uuid,
  p_cantidad numeric,
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
  v_cantidad numeric(14, 3);
  v_qty_linea numeric(14, 3);
  v_prod uuid;
  v_neto numeric(14, 3);
  v_devolver numeric(14, 3);
  v_origen text;
BEGIN
  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);
  IF v_cantidad <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR upper(COALESCE(v_item.tray_item_type::text, '')) <> 'C' THEN
    RETURN;
  END IF;

  v_qty_linea := GREATEST(COALESCE(v_item.quantity, 0), 0);
  v_origen := COALESCE(NULLIF(btrim(p_origen_venta), ''), 'CANCEL') || '_INCLUIDO_GRANEL';

  FOR v_prod IN
    SELECT DISTINCT x.producto_id
    FROM (
      SELECT mi.producto_id
      FROM public.movimientos_inventario mi
      WHERE mi.order_item_id = p_order_item_id
        AND mi.origen_venta ILIKE '%INCLUIDO_GRANEL%'
        AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO')
      UNION
      SELECT mbs.producto_global_id
      FROM public.movimientos_bodega_sucursal mbs
      WHERE mbs.order_item_id = p_order_item_id
        AND mbs.origen_venta ILIKE '%INCLUIDO_GRANEL%'
        AND mbs.tipo_movimiento IN ('SALIDA', 'INGRESO')
    ) x
    WHERE x.producto_id IS NOT NULL
      AND x.producto_id IS DISTINCT FROM v_item.product_id
  LOOP
    v_neto := public.inventario_neto_descontado_item_producto(p_order_item_id, v_prod);
    IF v_neto <= 0 THEN
      CONTINUE;
    END IF;

    IF v_qty_linea <= 0 OR v_cantidad >= v_qty_linea THEN
      v_devolver := v_neto;
    ELSE
      v_devolver := round(v_neto * (v_cantidad / v_qty_linea), 3);
    END IF;

    IF v_devolver > 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        p_sucursal_id,
        v_prod,
        v_devolver,
        'INGRESO'::public.tipo_movimiento_inventario,
        p_order_id,
        p_order_item_id,
        v_origen,
        p_actor_id,
        'Incluido granel (devolución)'
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_devolver_incluidos_granel_parcial(uuid, uuid, uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventario_devolver_incluidos_granel_parcial(uuid, uuid, uuid, numeric, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventario_sincronizar_item_borrador(
  p_order_item_id uuid,
  p_actor_id uuid,
  p_origen text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_diff numeric(14, 3);
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.product_id IS NULL OR v_item.status <> 'DRAFT' THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF NOT FOUND OR COALESCE(v_order.estado_aprobacion_qr::text, '') = 'PENDIENTE' THEN
    RETURN;
  END IF;

  v_diff := COALESCE(v_item.quantity, 0) - public.inventario_neto_descontado_item(p_order_item_id);

  IF v_diff > 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      v_order.branch_id, v_item.product_id, v_diff,
      'SALIDA'::public.tipo_movimiento_inventario,
      v_order.id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
    );
  ELSIF v_diff < 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      v_order.branch_id, v_item.product_id, -v_diff,
      'INGRESO'::public.tipo_movimiento_inventario,
      v_order.id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
    );
  END IF;

  -- Incluidos de granel: misma cadencia que nevera (al agregar / ajustar borrador).
  PERFORM public.inventario_sincronizar_incluidos_granel(
    p_order_item_id,
    p_actor_id,
    COALESCE(NULLIF(btrim(p_origen), ''), 'AGREGAR') || '_INCLUIDO_GRANEL',
    false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inventario_devolver_item_borrador(
  p_order_item_id uuid,
  p_actor_id uuid,
  p_origen text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_branch_id uuid;
  v_neto numeric(14, 3);
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.branch_id INTO v_branch_id FROM public.orders o WHERE o.id = v_item.order_id;

  v_neto := public.inventario_neto_descontado_item(p_order_item_id);
  IF v_neto > 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      v_branch_id, v_item.product_id, v_neto,
      'INGRESO'::public.tipo_movimiento_inventario,
      v_item.order_id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
    );
  END IF;

  -- Devolver incluidos aunque el producto principal no controle inventario.
  PERFORM public.inventario_sincronizar_incluidos_granel(
    p_order_item_id,
    p_actor_id,
    COALESCE(NULLIF(btrim(p_origen), ''), 'QUITAR') || '_INCLUIDO_GRANEL',
    true
  );
END;
$$;

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
      oi.description_snapshot,
      oi.tray_item_type
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

    -- Incluidos granel (idempotente si ya se descontaron al agregar).
    PERFORM public.inventario_sincronizar_incluidos_granel(
      v_item.id,
      p_actor_id,
      'ENVIO_INCLUIDO_GRANEL',
      false
    );

    -- Regla 1:1 chifle/encebollado: no aplica a granel (tipo C).
    IF upper(COALESCE(v_item.tray_item_type::text, '')) <> 'C' THEN
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
    END IF;
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

  IF upper(COALESCE(v_item.tray_item_type::text, '')) = 'C' THEN
    PERFORM public.inventario_devolver_incluidos_granel_parcial(
      p_sucursal_id,
      p_order_item_id,
      p_order_id,
      v_cantidad,
      p_actor_id,
      p_origen_venta
    );
    RETURN;
  END IF;

  -- Devolver chifle acompañante si esta línea era encebollado (no granel).
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

NOTIFY pgrst, 'reload schema';
