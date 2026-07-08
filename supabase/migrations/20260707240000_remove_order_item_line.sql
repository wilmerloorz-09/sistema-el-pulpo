-- Eliminar o reducir una linea de orden en un solo paso (sin dialogo de anulacion).
-- Borrador: DELETE. Enviado sin despachar: cancelacion operativa directa.

CREATE OR REPLACE FUNCTION public.remove_order_item_line(
  p_item_id uuid,
  p_target_quantity integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_paid_qty integer := 0;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
  v_visible_qty integer := 0;
  v_qty_to_cancel integer := 0;
  v_cancellation_id uuid;
  v_cancel_pending integer := 0;
  v_cancel_ready integer := 0;
  v_cancel_dispatched integer := 0;
  v_remaining integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_target_quantity IS NULL OR p_target_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
  END IF;

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
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  IF v_item.status = 'DRAFT' THEN
    IF p_target_quantity = 0 OR p_target_quantity < COALESCE(v_item.quantity, 0) THEN
      IF p_target_quantity = 0 THEN
        DELETE FROM public.order_item_modifiers WHERE order_item_id = p_item_id;
        DELETE FROM public.order_items WHERE id = p_item_id;
        PERFORM public.recompute_order_operational_state(v_order.id);
        RETURN;
      END IF;

      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;

      PERFORM public.recompute_order_operational_state(v_order.id);
      RETURN;
    END IF;

    IF p_target_quantity > COALESCE(v_item.quantity, 0) THEN
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;

    RETURN;
  END IF;

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  IF COALESCE(v_paid_qty, 0) > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
  END IF;

  SELECT
    COALESCE(snapshot.quantity_pending_prepare, 0),
    COALESCE(snapshot.quantity_ready_available, 0),
    GREATEST(
      0,
      COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
    )
  INTO v_pending_prepare, v_ready_available, v_dispatched_net
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_operational_active := v_pending_prepare + v_ready_available + v_dispatched_net;
  v_visible_qty := v_operational_active;

  IF v_visible_qty <= 0 AND p_target_quantity <= 0 THEN
    RETURN;
  END IF;

  IF v_dispatched_net > 0 AND p_target_quantity < v_visible_qty THEN
    RAISE EXCEPTION 'No se puede eliminar un item ya despachado desde aqui.';
  END IF;

  IF p_target_quantity = 0 THEN
    v_qty_to_cancel := v_operational_active;
  ELSE
    v_qty_to_cancel := GREATEST(0, v_visible_qty - p_target_quantity);
  END IF;

  IF v_qty_to_cancel <= 0 THEN
    IF p_target_quantity > v_visible_qty THEN
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;
    RETURN;
  END IF;

  IF v_qty_to_cancel > v_operational_active THEN
    RAISE EXCEPTION 'No puedes eliminar mas cantidad de la disponible.';
  END IF;

  INSERT INTO public.order_cancellations (
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    v_order.id,
    'partial',
    'Eliminado desde orden',
    NULL,
    v_actor_id,
    'APPLIED',
    v_now
  )
  RETURNING id INTO v_cancellation_id;

  v_cancel_pending := LEAST(v_qty_to_cancel, v_pending_prepare);
  v_remaining := GREATEST(0, v_qty_to_cancel - v_cancel_pending);
  v_cancel_ready := LEAST(v_remaining, v_ready_available);
  v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
  v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

  IF v_cancel_pending > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_pending, v_item.unit_price,
      ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
      'PENDING', v_now
    );
  END IF;

  IF v_cancel_ready > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_ready, v_item.unit_price,
      ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
      'READY', v_now
    );
  END IF;

  IF v_cancel_dispatched > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_dispatched, v_item.unit_price,
      ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
      'DISPATCHED', v_now
    );
  END IF;

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = v_order.id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_order_item_line(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_order_item_line(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
