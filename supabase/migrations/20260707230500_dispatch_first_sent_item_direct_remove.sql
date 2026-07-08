-- Despacho primero: permitir eliminar o reducir lineas enviadas que aun no se despacharon
-- sin pasar por el dialogo de anulacion (set_draft_order_item_quantity).

CREATE OR REPLACE FUNCTION public.set_draft_order_item_quantity(
  p_item_id uuid,
  p_quantity integer,
  p_unit_price numeric DEFAULT NULL
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
  v_effective_unit_price numeric;
  v_paid_qty integer := 0;
  v_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_dispatch_first boolean := false;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
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

  IF p_quantity IS NULL OR p_quantity < 0 THEN
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

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_paid_qty := COALESCE(v_paid_qty, 0);

  IF v_item.status <> 'DRAFT' AND v_paid_qty > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
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

  IF v_item.status <> 'DRAFT' AND (p_quantity = 0 OR p_quantity < COALESCE(v_item.quantity, 0)) THEN
    SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
    INTO v_workflow_mode
    FROM public.branches b
    WHERE b.id = v_order.branch_id;

    v_dispatch_first :=
      v_order.order_type = 'EXPRESS'
      OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND COALESCE(v_order.order_type, '') <> 'TAKEOUT');

    IF v_dispatch_first THEN
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

      IF v_dispatched_net = 0 AND v_operational_active > 0 THEN
        IF p_quantity = 0 THEN
          v_qty_to_cancel := v_operational_active;
        ELSE
          v_qty_to_cancel := GREATEST(0, v_operational_active - p_quantity);
        END IF;

        IF v_qty_to_cancel <= 0 THEN
          RETURN;
        END IF;

        IF v_qty_to_cancel > v_operational_active THEN
          RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para este item.';
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
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_pending,
            v_item.unit_price,
            ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
            'PENDING',
            v_now
          );
        END IF;

        IF v_cancel_ready > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_ready,
            v_item.unit_price,
            ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
            'READY',
            v_now
          );
        END IF;

        IF v_cancel_dispatched > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_dispatched,
            v_item.unit_price,
            ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
            'DISPATCHED',
            v_now
          );
        END IF;

        UPDATE public.orders
        SET cancel_requested_at = NULL,
            cancel_requested_by = NULL
        WHERE id = v_order.id;

        PERFORM public.recompute_order_operational_state(v_order.id);
        PERFORM public.sync_order_payment_state_internal(v_order.id);
        RETURN;
      END IF;
    END IF;

    IF p_quantity = 0 THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    IF p_quantity < COALESCE(v_item.quantity, 0) THEN
      RAISE EXCEPTION 'Para reducir un item ya enviado usa el flujo de anulacion.';
    END IF;
  END IF;

  IF p_quantity = 0 THEN
    IF v_item.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = p_item_id;

    DELETE FROM public.order_items
    WHERE id = p_item_id;

    PERFORM public.recompute_order_operational_state(v_order.id);
    RETURN;
  END IF;

  v_effective_unit_price := COALESCE(p_unit_price, v_item.unit_price);

  IF v_effective_unit_price IS NULL OR v_effective_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  UPDATE public.order_items
  SET quantity = p_quantity,
      unit_price = v_effective_unit_price,
      total = ((p_quantity * v_effective_unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
  WHERE id = p_item_id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
