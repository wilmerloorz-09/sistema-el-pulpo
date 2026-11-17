-- Lector: permite agregar por producto (menú) además de código de barras.
DROP FUNCTION IF EXISTS public.estacion_bebidas_agregar_por_codigo(uuid, uuid, text, integer, text);

CREATE OR REPLACE FUNCTION public.estacion_bebidas_agregar_por_codigo(
  p_id_operacion uuid,
  p_id_orden uuid,
  p_codigo_barras text DEFAULT NULL,
  p_cantidad integer DEFAULT 1,
  p_fuente text DEFAULT 'lector',
  p_id_producto uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $epulpo$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_map public.codigos_barras_bebidas%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_menu public.menu_nodes%ROWTYPE;
  v_qty integer := 1;
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_item_id uuid;
  v_precio numeric(12, 2);
  v_desc text;
  v_paid numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_was_paid boolean := false;
  v_event_id uuid;
  v_now timestamptz := now();
  v_codigo text := nullif(trim(COALESCE(p_codigo_barras, '')), '');
  v_tiene_mapa boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;
  IF p_id_operacion IS NULL OR p_id_orden IS NULL THEN
    RAISE EXCEPTION 'Operación y orden son obligatorias';
  END IF;

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id_operacion', v_existing.id,
      'duplicada', true,
      'id_orden', v_existing.id_orden,
      'id_producto', v_existing.id_producto,
      'cantidad', v_existing.cantidad,
      'monto', v_existing.monto,
      'id_order_item', v_existing.id_order_item
    );
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id_orden FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.cancelled_at IS NOT NULL OR v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Esta orden está cerrada. Selecciona una orden abierta.';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor, v_order.branch_id)
    OR public.has_branch_permission(v_actor, v_order.branch_id, 'orders', 'OPERATE')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para modificar órdenes en esta sucursal';
  END IF;

  IF v_codigo IS NOT NULL THEN
    SELECT * INTO v_map
    FROM public.codigos_barras_bebidas
    WHERE codigo_barras = v_codigo
      AND activo IS TRUE
    LIMIT 1;
    IF FOUND THEN
      v_tiene_mapa := true;
      SELECT * INTO v_product FROM public.products WHERE id = v_map.id_producto;
    END IF;
  END IF;

  IF NOT v_tiene_mapa AND p_id_producto IS NOT NULL THEN
    SELECT * INTO v_product FROM public.products WHERE id = p_id_producto;
    IF FOUND THEN
      SELECT * INTO v_map
      FROM public.codigos_barras_bebidas
      WHERE id_producto = p_id_producto
        AND activo IS TRUE
      ORDER BY codigo_barras
      LIMIT 1;
      IF FOUND THEN
        v_tiene_mapa := true;
        v_codigo := COALESCE(v_codigo, v_map.codigo_barras);
      END IF;
    END IF;
  END IF;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Código o producto no encontrado / no habilitado para el lector.';
  END IF;

  IF v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Producto no disponible.';
  END IF;

  IF v_tiene_mapa AND v_map.id_nodo_menu IS NOT NULL THEN
    SELECT * INTO v_menu FROM public.menu_nodes WHERE id = v_map.id_nodo_menu;
    IF FOUND AND v_menu.branch_id IS DISTINCT FROM v_order.branch_id THEN
      RAISE EXCEPTION 'El producto no pertenece a la sucursal de la orden.';
    END IF;
  ELSE
    SELECT * INTO v_menu
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_order.branch_id
      AND mn.is_active IS TRUE
      AND (
        mn.legacy_product_id = v_product.id
        OR mn.producto_global_id = v_product.id
        OR mn.id = v_product.id
      )
    ORDER BY mn.display_order NULLS LAST, mn.created_at
    LIMIT 1;
  END IF;

  v_precio := COALESCE(v_menu.price, v_product.unit_price, 0);
  v_desc := COALESCE(NULLIF(trim(v_menu.name), ''), NULLIF(trim(v_product.description), ''), 'Producto');

  v_was_paid := (v_order.status = 'PAID');
  IF v_was_paid THEN
    UPDATE public.orders
    SET status = 'SENT_TO_KITCHEN',
        updated_at = v_now
    WHERE id = v_order.id;
  END IF;

  IF COALESCE(v_order.is_tray_order, false) THEN
    SELECT public.add_tray_order_item(
      v_order.id,
      v_product.id,
      v_qty,
      v_precio,
      'B',
      0,
      NULL,
      NULL
    ) INTO v_item_id;
  ELSE
    SELECT public.add_dine_in_order_item(
      v_order.id,
      v_product.id,
      v_menu.id,
      v_qty,
      v_precio,
      v_desc,
      NULL,
      NULL,
      NULL,
      0
    ) INTO v_item_id;
  END IF;

  PERFORM 1 FROM public.submit_order_draft_items(v_order.id);

  INSERT INTO public.order_dispatch_events (
    order_id, event_type, created_by, source_module, notes, status, created_at
  ) VALUES (
    v_order.id, 'partial', v_actor, 'orders', 'lector-codigos auto-despacho', 'APPLIED', v_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.order_item_dispatch_events (
    order_dispatch_event_id, order_id, order_item_id, quantity_dispatched, source_stage, created_at
  ) VALUES (
    v_event_id, v_order.id, v_item_id, v_qty, 'PENDING', v_now
  );

  UPDATE public.order_items
  SET dispatched_at = COALESCE(dispatched_at, v_now)
  WHERE id = v_item_id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM 1 FROM public.sync_order_payment_state_internal(v_order.id);

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion,
    v_order.branch_id,
    v_order.id,
    v_product.id,
    v_actor,
    v_qty,
    'agregar',
    v_item_id,
    v_codigo,
    round(v_precio * v_qty, 2),
    'confirmada',
    jsonb_build_object(
      'fuente', COALESCE(p_fuente, 'lector'),
      'descripcion', v_desc,
      'precio_unitario', v_precio,
      'reabierta_desde_pagada', v_was_paid,
      'auto_despachado', true,
      'id_producto_solicitado', p_id_producto
    )
  );

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed');

  SELECT COALESCE(SUM(oi.total), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.status NOT IN ('DRAFT', 'CANCELLED');

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion,
    'duplicada', false,
    'id_orden', v_order.id,
    'id_producto', v_product.id,
    'descripcion', v_desc,
    'cantidad', v_qty,
    'monto', round(v_precio * v_qty, 2),
    'id_order_item', v_item_id,
    'total_orden', v_total,
    'pagado', v_paid,
    'saldo', GREATEST(0, v_total - v_paid),
    'despachado', true
  );
END;
$epulpo$;

REVOKE ALL ON FUNCTION public.estacion_bebidas_agregar_por_codigo(uuid, uuid, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_agregar_por_codigo(uuid, uuid, text, integer, text, uuid) TO authenticated;
