-- Etapa 3: integración inventario ↔ ventas
-- - Solo productos con inventario_productos.integra_con_ventas = true
-- - Descuenta stock al enviar ítems DRAFT (submit_*)
-- - Descuenta delta al aumentar cantidad en ítems ya enviados
-- - Restaura stock en cancelaciones / reducciones operativas
-- - NO descuenta al cobrar (register_payment_with_items)

ALTER TABLE public.movimientos_inventario
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origen_venta text;

COMMENT ON COLUMN public.movimientos_inventario.origen_venta IS
  'Traza de movimiento automático por venta: ENVIO, AJUSTE_QTY, CANCEL, etc.';

CREATE OR REPLACE FUNCTION public.inventario_debe_controlar_venta(
  p_sucursal_id uuid,
  p_producto_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_sucursal_id IS NOT NULL
    AND p_producto_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.inventario_productos ip
      WHERE ip.sucursal_id = p_sucursal_id
        AND ip.producto_id = p_producto_id
        AND ip.integra_con_ventas = true
        AND ip.activo = true
    );
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
AS $$
DECLARE
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_motivo text;
  v_label text;
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

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_anterior := 0;
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      integra_con_ventas,
      activo
    )
    VALUES (p_producto_id, p_sucursal_id, 0, true, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_label, v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
    v_motivo := format('Venta (%s)', COALESCE(p_origen_venta, 'SALIDA'));
  ELSE
    v_nueva := v_anterior + v_cantidad;
    v_motivo := format('Devolución venta (%s)', COALESCE(p_origen_venta, 'INGRESO'));
  END IF;

  UPDATE public.inventario_productos
  SET cantidad_disponible = v_nueva
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  v_registrado_nombre := COALESCE(v_registrado_nombre, 'Usuario');

  INSERT INTO public.movimientos_inventario (
    producto_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre,
    order_id,
    order_item_id,
    origen_venta
  )
  VALUES (
    p_producto_id,
    p_sucursal_id,
    p_tipo_movimiento,
    v_cantidad,
    v_anterior,
    v_nueva,
    v_motivo,
    COALESCE(p_actor_id, auth.uid()),
    v_registrado_nombre,
    p_order_id,
    p_order_item_id,
    p_origen_venta
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
    PERFORM public.inventario_movimiento_venta_internal(
      p_sucursal_id,
      v_item.product_id,
      v_item.quantity,
      'SALIDA'::public.tipo_movimiento_inventario,
      p_order_id,
      v_item.id,
      'ENVIO',
      p_actor_id,
      v_item.description_snapshot
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
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
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
    p_cantidad,
    'INGRESO'::public.tipo_movimiento_inventario,
    p_order_id,
    p_order_item_id,
    p_origen_venta,
    p_actor_id,
    v_item.description_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_debe_controlar_venta(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventario_movimiento_venta_internal(uuid, uuid, numeric, public.tipo_movimiento_inventario, uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventario_descontar_draft_orden(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventario_restaurar_por_order_item(uuid, uuid, numeric, uuid, uuid, text) FROM PUBLIC;

-- =============================================================================
-- Parche: descontar stock al enviar ítems DRAFT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_order_draft_items(
  p_order_id uuid
)
RETURNS TABLE (
  order_id uuid,
  order_status public.order_status,
  submitted_item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_branch_token text;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_especial_cero boolean := false;
  v_autopagar_al_enviar boolean := false;
  v_reabrir_despachada boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  v_reabrir_despachada := v_order.status = 'KITCHEN_DISPATCHED';

  SELECT COALESCE(b.workflow_mode, 'CASH_THEN_DISPATCH')
  INTO v_workflow_mode
  FROM public.branches b
  WHERE b.id = v_order.branch_id;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_especial_cero := COALESCE(v_order.is_special, false)
    AND v_order.special_total_manual IS NOT NULL
    AND v_order.special_total_manual = 0;

  v_autopagar_al_enviar := v_especial_cero
    AND v_workflow_mode = 'CASH_THEN_DISPATCH';

  v_next_status := CASE
    WHEN v_autopagar_al_enviar THEN 'PAID'::public.order_status
    ELSE 'SENT_TO_KITCHEN'::public.order_status
  END;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_number IS NULL THEN
    v_new_order_number := nextval('orders_order_number_seq');
  END IF;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
      INTO v_branch_token
    FROM public.branches
    WHERE id = v_order.branch_id;

    v_date_part := to_char(COALESCE(v_order.created_at, v_now) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

    LOOP
      v_try := v_try + 1;
      v_seq := public.next_human_sequence('orders_daily', v_order.branch_id, v_date_part);
      v_new_order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.order_code = v_new_order_code
      );

      IF v_try >= 50 THEN
        RAISE EXCEPTION 'No se pudo generar order_code unico';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = CASE
      WHEN v_autopagar_al_enviar THEN v_now
      WHEN v_reabrir_despachada THEN o.paid_at
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_reabrir_despachada THEN o.dispatched_at
      ELSE NULL
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  IF v_autopagar_al_enviar THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, v_actor_id);
    SELECT o.status INTO v_next_status FROM public.orders o WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_express_order_draft_items(
  p_order_id uuid
)
RETURNS TABLE (
  order_id uuid,
  order_status public.order_status,
  submitted_item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_reabrir_despachada boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.order_type <> 'EXPRESS' THEN
    RAISE EXCEPTION 'Esta operacion solo aplica a ordenes Express';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  v_reabrir_despachada := v_order.status = 'KITCHEN_DISPATCHED';

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_next_status := 'SENT_TO_KITCHEN'::public.order_status;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_number IS NULL THEN
    v_new_order_number := nextval('orders_order_number_seq');
  END IF;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
      INTO v_branch_token
    FROM public.branches
    WHERE id = v_order.branch_id;

    v_date_part := to_char(COALESCE(v_order.created_at, v_now) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

    LOOP
      v_try := v_try + 1;
      v_seq := public.next_human_sequence('orders_daily', v_order.branch_id, v_date_part);
      v_new_order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.order_code = v_new_order_code
      );

      IF v_try >= 50 THEN
        RAISE EXCEPTION 'No se pudo generar order_code unico';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = CASE WHEN v_reabrir_despachada THEN o.paid_at ELSE NULL END,
    dispatched_at = CASE WHEN v_reabrir_despachada THEN o.dispatched_at ELSE NULL END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_order_draft_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_express_order_draft_items(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

