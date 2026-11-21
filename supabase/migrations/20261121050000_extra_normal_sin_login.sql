-- Extra normal público: lecturas + writes sin sesión cuando la sucursal tiene turno OPEN.

CREATE OR REPLACE FUNCTION public.extra_acceso_station_actor(p_branch_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT csu.user_id
  FROM public.cash_shifts cs
  JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND csu.is_enabled IS TRUE
  ORDER BY
    CASE WHEN csu.can_access_orders IS TRUE THEN 0 ELSE 1 END,
    CASE WHEN csu.can_edit_orders IS TRUE THEN 0 ELSE 1 END,
    csu.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_get_branch(p_branch_id uuid)
RETURNS TABLE (
  id uuid,
  nombre text,
  codigo text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    b.id,
    b.name::text AS nombre,
    COALESCE(b.branch_code, b.display_code)::text AS codigo
  FROM public.branches b
  WHERE b.id = p_branch_id
    AND b.is_active IS TRUE
    AND EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.branch_id = b.id
        AND cs.status = 'OPEN'
    );
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_list_catalog()
RETURNS TABLE (
  id_producto uuid,
  codigo_barras text,
  nombre text,
  precio numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id_producto,
    c.codigo_barras::text,
    COALESCE(p.description, 'Producto')::text AS nombre,
    COALESCE(p.unit_price, 0)::numeric AS precio
  FROM public.codigos_barras_bebidas c
  JOIN public.products p ON p.id = c.id_producto
  WHERE c.activo IS TRUE
    AND COALESCE(p.is_active, true) IS TRUE
  ORDER BY p.description, c.codigo_barras;
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_list_open_orders(p_branch_id uuid)
RETURNS TABLE (
  id uuid,
  codigo text,
  tipo text,
  estado text,
  mesa text,
  id_mesa uuid,
  total numeric,
  pagado numeric,
  saldo numeric,
  creada_en timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ordenes AS (
    SELECT o.*
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.cancelled_at IS NULL
      AND o.closed_at IS NULL
      AND o.status IS DISTINCT FROM 'CANCELLED'
      AND o.created_at >= (now() - interval '2 days')
    ORDER BY o.created_at DESC
    LIMIT 80
  ),
  tot AS (
    SELECT oi.order_id, COALESCE(SUM(oi.total), 0)::numeric AS total
    FROM public.order_items oi
    JOIN ordenes o ON o.id = oi.order_id
    WHERE oi.status NOT IN ('DRAFT', 'CANCELLED')
    GROUP BY oi.order_id
  ),
  pag AS (
    SELECT p.order_id, COALESCE(SUM(p.amount), 0)::numeric AS pagado
    FROM public.payments p
    JOIN ordenes o ON o.id = p.order_id
    WHERE COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
    GROUP BY p.order_id
  )
  SELECT
    o.id,
    o.order_code::text AS codigo,
    o.order_type::text AS tipo,
    o.status::text AS estado,
    o.table_name_snapshot::text AS mesa,
    o.table_id AS id_mesa,
    COALESCE(t.total, 0) AS total,
    COALESCE(p.pagado, 0) AS pagado,
    GREATEST(0, COALESCE(t.total, 0) - COALESCE(p.pagado, 0)) AS saldo,
    o.created_at AS creada_en
  FROM ordenes o
  LEFT JOIN tot t ON t.order_id = o.id
  LEFT JOIN pag p ON p.order_id = o.id
  ORDER BY o.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_list_lector_items(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  descripcion text,
  cantidad numeric,
  precio numeric,
  total numeric,
  id_producto uuid,
  creado_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH ops AS (
    SELECT op.id, op.id_order_item
    FROM public.operaciones_estacion_bebidas op
    WHERE op.id_orden = p_order_id
      AND op.tipo = 'agregar'
      AND op.estado = 'confirmada'
      AND NOT EXISTS (
        SELECT 1
        FROM public.operaciones_estacion_bebidas u
        WHERE u.id_operacion_origen = op.id
          AND u.tipo = 'deshacer'
          AND u.estado = 'confirmada'
      )
      AND op.id_order_item IS NOT NULL
  ),
  snap AS (
    SELECT *
    FROM public.get_order_operational_snapshot(p_order_id)
  )
  SELECT
    oi.id,
    oi.description_snapshot::text AS descripcion,
    GREATEST(
      0,
      LEAST(
        COALESCE(s.quantity_pending_prepare, 0)
          + COALESCE(s.quantity_ready_available, 0)
          + GREATEST(
            0,
            COALESCE(s.quantity_dispatched_total, 0)
              - COALESCE(s.quantity_cancelled_dispatched, 0)
          ),
        GREATEST(
          COALESCE(oi.quantity, 0),
          COALESCE(s.quantity_ordered, oi.quantity, 0)
        )
          - COALESCE(s.quantity_cancelled_total, 0)
      )
    )::numeric AS cantidad,
    COALESCE(s.unit_price, oi.unit_price, 0)::numeric AS precio,
    ROUND(
      GREATEST(
        0,
        LEAST(
          COALESCE(s.quantity_pending_prepare, 0)
            + COALESCE(s.quantity_ready_available, 0)
            + GREATEST(
              0,
              COALESCE(s.quantity_dispatched_total, 0)
                - COALESCE(s.quantity_cancelled_dispatched, 0)
            ),
          GREATEST(
            COALESCE(oi.quantity, 0),
            COALESCE(s.quantity_ordered, oi.quantity, 0)
          )
            - COALESCE(s.quantity_cancelled_total, 0)
        )
      )
      * COALESCE(s.unit_price, oi.unit_price, 0)
    , 2)::numeric AS total,
    oi.product_id AS id_producto,
    oi.created_at AS creado_en
  FROM ops
  JOIN public.order_items oi ON oi.id = ops.id_order_item
  LEFT JOIN snap s ON s.order_item_id = oi.id
  WHERE oi.status NOT IN ('DRAFT', 'CANCELLED')
    AND COALESCE(oi.quantity, 0) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.extra_acceso_station_actor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_get_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_list_catalog() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_list_open_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_list_lector_items(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.extra_acceso_station_actor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_get_branch(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_list_catalog() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_list_open_orders(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_list_lector_items(uuid) TO anon, authenticated;

-- Write RPCs: allow anonymous Extra when branch has OPEN shift.

CREATE OR REPLACE FUNCTION public.estacion_bebidas_agregar_por_codigo(p_id_operacion uuid, p_id_orden uuid, p_codigo_barras text DEFAULT NULL::text, p_cantidad integer DEFAULT 1, p_fuente text DEFAULT 'lector'::text, p_id_producto uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF v_actor IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_shifts cs
      WHERE cs.branch_id = v_order.branch_id AND cs.status = 'OPEN'
    ) THEN
      RAISE EXCEPTION 'Usuario no autenticado';
    END IF;
    v_actor := public.extra_acceso_station_actor(v_order.branch_id);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'No hay personal activo en el turno para Extra';
    END IF;
  ELSIF NOT (
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
$function$
;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_agregar_por_codigo(p_id_operacion uuid, p_id_orden uuid, p_codigo_barras text, p_cantidad integer, p_fuente text, p_id_producto uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.estacion_bebidas_quitar(p_id_orden uuid, p_id_producto uuid, p_cantidad integer, p_id_operacion uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_need integer := GREATEST(1, LEAST(99, COALESCE(p_cantidad, 1)));
  v_left integer;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_take integer;
  v_available integer;
  v_desc text;
  v_unit numeric(12, 2) := 0;
  v_cancelled integer := 0;
BEGIN
  IF p_id_orden IS NULL OR p_id_producto IS NULL THEN
    RAISE EXCEPTION 'Orden y producto son obligatorios';
  END IF;

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion;
  IF FOUND THEN
    RETURN jsonb_build_object('id_operacion', v_existing.id, 'duplicada', true);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id_orden FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.status = 'CANCELLED' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La orden está cerrada y no admite cambios.';
  END IF;

  IF v_actor IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_shifts cs
      WHERE cs.branch_id = v_order.branch_id AND cs.status = 'OPEN'
    ) THEN
      RAISE EXCEPTION 'Usuario no autenticado';
    END IF;
    v_actor := public.extra_acceso_station_actor(v_order.branch_id);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'No hay personal activo en el turno para Extra';
    END IF;
  ELSIF NOT (
    public.can_manage_branch_admin(v_actor, v_order.branch_id)
    OR public.has_branch_permission(v_actor, v_order.branch_id, 'orders', 'OPERATE')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para ajustar productos en esta sucursal';
  END IF;

  v_left := v_need;

  FOR v_row IN
    SELECT
      oi.id AS order_item_id,
      oi.description_snapshot,
      oi.unit_price,
      snap.quantity_pending_prepare,
      snap.quantity_ready_available,
      GREATEST(0, COALESCE(snap.quantity_dispatched_total, 0) - COALESCE(snap.quantity_cancelled_dispatched, 0)) AS dispatched_net
    FROM public.order_items oi
    JOIN public.operaciones_estacion_bebidas op
      ON op.id_order_item = oi.id
     AND op.id_orden = p_id_orden
     AND op.id_producto = p_id_producto
     AND op.tipo = 'agregar'
     AND op.estado = 'confirmada'
     AND NOT EXISTS (
       SELECT 1
       FROM public.operaciones_estacion_bebidas u
       WHERE u.id_operacion_origen = op.id
         AND u.tipo = 'deshacer'
         AND u.estado = 'confirmada'
     )
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.get_order_operational_snapshot(p_id_orden) s
      WHERE s.order_item_id = oi.id
      LIMIT 1
    ) snap ON true
    WHERE oi.order_id = p_id_orden
      AND oi.product_id = p_id_producto
      AND oi.status IS DISTINCT FROM 'DRAFT'
      AND oi.status IS DISTINCT FROM 'CANCELLED'
    ORDER BY oi.created_at DESC NULLS LAST, oi.id DESC
  LOOP
    EXIT WHEN v_left <= 0;

    v_available := GREATEST(
      0,
      COALESCE(v_row.quantity_pending_prepare, 0)
      + COALESCE(v_row.quantity_ready_available, 0)
      + COALESCE(v_row.dispatched_net, 0)
    );
    IF v_available <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_left, v_available);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_item_id', v_row.order_item_id,
      'quantity_cancelled', v_take
    ));
    v_desc := COALESCE(v_desc, v_row.description_snapshot);
    v_unit := COALESCE(v_row.unit_price, v_unit);
    v_left := v_left - v_take;
    v_cancelled := v_cancelled + v_take;
  END LOOP;

  IF v_cancelled <= 0 THEN
    RAISE EXCEPTION 'No hay unidades disponibles para quitar de este producto.';
  END IF;

  PERFORM public.cancel_order_quantities(
    p_id_orden,
    v_actor,
    'otro',
    format('Ajuste desde lector: quitar %s × %s', v_cancelled, COALESCE(v_desc, 'producto')),
    v_items,
    'partial',
    true
  );

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion,
    v_order.branch_id,
    v_order.id,
    p_id_producto,
    v_actor,
    v_cancelled,
    'deshacer',
    NULL,
    NULL,
    -ABS(round(COALESCE(v_unit, 0) * v_cancelled, 2)),
    'confirmada',
    jsonb_build_object(
      'fuente', 'lector-ajuste',
      'descripcion', v_desc,
      'items', v_items,
      'solicitado', v_need
    )
  );

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion,
    'duplicada', false,
    'id_orden', v_order.id,
    'id_producto', p_id_producto,
    'cantidad', v_cancelled,
    'descripcion', v_desc,
    'monto', -ABS(round(COALESCE(v_unit, 0) * v_cancelled, 2))
  );
END;
$function$
;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_quitar(p_id_orden uuid, p_id_producto uuid, p_cantidad integer, p_id_operacion uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.estacion_bebidas_deshacer(p_id_operacion uuid, p_id_orden uuid, p_id_operacion_nueva uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_orig public.operaciones_estacion_bebidas%ROWTYPE;
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_target_qty integer;
  v_paid numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
BEGIN

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion_nueva;
  IF FOUND THEN
    RETURN jsonb_build_object('id_operacion', v_existing.id, 'duplicada', true);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id_orden FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.status = 'CANCELLED' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La orden está cerrada y no admite cambios.';
  END IF;

  IF v_actor IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_shifts cs
      WHERE cs.branch_id = v_order.branch_id AND cs.status = 'OPEN'
    ) THEN
      RAISE EXCEPTION 'Usuario no autenticado';
    END IF;
    v_actor := public.extra_acceso_station_actor(v_order.branch_id);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'No hay personal activo en el turno para Extra';
    END IF;
  ELSIF NOT (
    public.can_manage_branch_admin(v_actor, v_order.branch_id)
    OR public.has_branch_permission(v_actor, v_order.branch_id, 'orders', 'OPERATE')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para deshacer en esta sucursal';
  END IF;

  SELECT * INTO v_orig
  FROM public.operaciones_estacion_bebidas
  WHERE id_orden = p_id_orden
    AND tipo = 'agregar'
    AND estado = 'confirmada'
    AND NOT EXISTS (
      SELECT 1 FROM public.operaciones_estacion_bebidas u
      WHERE u.id_operacion_origen = operaciones_estacion_bebidas.id
        AND u.tipo = 'deshacer'
        AND u.estado = 'confirmada'
    )
  ORDER BY fecha_registro DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta orden no tiene lecturas para deshacer.';
  END IF;

  IF p_id_operacion IS NOT NULL AND v_orig.id IS DISTINCT FROM p_id_operacion THEN
    RAISE EXCEPTION 'La última lectura ya no coincide. Actualiza e intenta de nuevo.';
  END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = v_orig.id_order_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden cambió. No se puede deshacer esta lectura.';
  END IF;

  IF COALESCE(v_item.quantity, 0) < v_orig.cantidad THEN
    RAISE EXCEPTION 'La orden cambió. No se puede deshacer esta lectura.';
  END IF;

  v_target_qty := GREATEST(0, COALESCE(v_item.quantity, 0) - v_orig.cantidad);
  PERFORM public.remove_order_item_line(v_item.id, v_target_qty);
  PERFORM 1 FROM public.sync_order_payment_state_internal(v_order.id);

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_operacion_origen, id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion_nueva,
    v_order.branch_id,
    v_order.id,
    v_orig.id_producto,
    v_actor,
    v_orig.cantidad,
    'deshacer',
    v_orig.id,
    v_orig.id_order_item,
    v_orig.codigo_barras,
    -ABS(COALESCE(v_orig.monto, 0)),
    'confirmada',
    jsonb_build_object('deshace', v_orig.id)
  );

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed');

  SELECT COALESCE(SUM(oi.total), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.status NOT IN ('DRAFT', 'CANCELLED');

  IF v_total < v_paid THEN
    RAISE EXCEPTION 'No se puede deshacer: el pago supera el total resultante.';
  END IF;

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion_nueva,
    'duplicada', false,
    'id_orden', v_order.id,
    'cantidad', v_orig.cantidad,
    'monto', -ABS(COALESCE(v_orig.monto, 0)),
    'total_orden', v_total,
    'pagado', v_paid,
    'saldo', GREATEST(0, v_total - v_paid)
  );
END;
$function$
;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_deshacer(p_id_operacion uuid, p_id_orden uuid, p_id_operacion_nueva uuid) TO anon, authenticated;

-- Lecturas Extra normal (anon) cuando hay turno OPEN.

DROP POLICY IF EXISTS menu_nodes_select_extra_acceso_anon ON public.menu_nodes;
CREATE POLICY menu_nodes_select_extra_acceso_anon
ON public.menu_nodes
FOR SELECT
TO anon
USING (
  is_active IS TRUE
  AND menu_scope = 'TABLE'
  AND EXISTS (
    SELECT 1 FROM public.cash_shifts cs
    WHERE cs.branch_id = menu_nodes.branch_id
      AND cs.status = 'OPEN'
  )
);

DROP POLICY IF EXISTS extra_frequent_products_select_extra_acceso_anon ON public.extra_frequent_products;
CREATE POLICY extra_frequent_products_select_extra_acceso_anon
ON public.extra_frequent_products
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.cash_shifts cs
    WHERE cs.branch_id = extra_frequent_products.branch_id
      AND cs.status = 'OPEN'
  )
);

DROP POLICY IF EXISTS inventario_bodega_sucursal_select_extra_acceso_anon ON public.inventario_bodega_sucursal;
CREATE POLICY inventario_bodega_sucursal_select_extra_acceso_anon
ON public.inventario_bodega_sucursal
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.branches b
    JOIN public.cash_shifts cs
      ON cs.branch_id = b.id
     AND cs.status = 'OPEN'
    WHERE inventario_bodega_sucursal.sucursal_id = COALESCE(b.inventario_sucursal_id, b.id)
       OR inventario_bodega_sucursal.sucursal_id = b.id
  )
);

DROP POLICY IF EXISTS productos_globales_select_extra_acceso_anon ON public.productos_globales;
CREATE POLICY productos_globales_select_extra_acceso_anon
ON public.productos_globales
FOR SELECT
TO anon
USING (COALESCE(activo, true) IS TRUE);

GRANT EXECUTE ON FUNCTION public.obtener_inventario_sucursales() TO anon, authenticated;
