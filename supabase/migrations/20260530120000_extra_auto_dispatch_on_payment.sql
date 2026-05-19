-- Extra: al quedar totalmente cobrada, auto-despachar y cerrar la orden.

CREATE OR REPLACE FUNCTION public.auto_finalize_extra_order_after_payment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_actor uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_order.order_type::text, '') <> 'EXTRA'
     OR COALESCE(v_order.is_special, false)
     OR COALESCE(v_order.is_tray_order, false) THEN
    RETURN;
  END IF;

  v_actor := COALESCE(auth.uid(), v_order.created_by);
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  IF v_order.status = 'PAID' THEN
    BEGIN
      PERFORM public.dispatch_order_quantities(
        p_order_id := p_order_id,
        p_dispatched_by := v_actor,
        p_items := '[]'::jsonb,
        p_operation_type := 'total',
        p_source_module := 'orders',
        p_notes := 'Auto-despacho Extra al cobrar'
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%No hay cantidades pendientes para despachar%' THEN
          RAISE;
        END IF;
    END;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order.status = 'KITCHEN_DISPATCHED' AND v_order.closed_at IS NULL THEN
    UPDATE public.orders
    SET
      closed_at = v_now,
      locked_for_editing = true,
      updated_at = v_now
    WHERE id = p_order_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_finalize_extra_order_after_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_finalize_extra_order_after_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_internal(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_available integer := 0;
  v_cancelled_total integer := 0;
  v_active_not_cancelled integer := 0;
  v_item_count integer := 0;
  v_all_fully_paid boolean := false;
  v_operational_status public.order_status;
  v_final_status public.order_status;
  v_final_paid_at timestamptz;
  v_last_ready_at timestamptz;
  v_last_dispatched_at timestamptz;
  v_active_payments_total numeric := 0;
  v_special_total numeric := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    UPDATE public.orders o
    SET status = 'CANCELLED',
        paid_at = NULL,
        table_id = NULL,
        split_id = NULL,
        table_order_position = NULL,
        cancelled_at = COALESCE(o.cancelled_at, v_now),
        updated_at = v_now
    WHERE o.id = p_order_id;

    RETURN QUERY
    SELECT p_order_id, 'CANCELLED'::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT MAX(ore.created_at)
  INTO v_last_ready_at
  FROM public.order_ready_events ore
  WHERE ore.order_id = p_order_id
    AND ore.status = 'APPLIED';

  SELECT MAX(ode.created_at)
  INTO v_last_dispatched_at
  FROM public.order_dispatch_events ode
  WHERE ode.order_id = p_order_id
    AND ode.status = 'APPLIED';

  WITH item_state AS (
    SELECT
      oi.id AS order_item_id,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
      GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))::int AS payable_qty,
      LEAST(
        GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
        COALESCE(snapshot.quantity_paid, 0)::int
      )::int AS paid_qty_effective
    FROM public.order_items oi
    LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
      ON snapshot.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(item_state.quantity_pending_prepare), 0)::int,
    COALESCE(SUM(item_state.quantity_ready_available), 0)::int,
    COALESCE(SUM(item_state.quantity_dispatched_available), 0)::int,
    COALESCE(SUM(item_state.quantity_cancelled_total), 0)::int,
    COALESCE(SUM(GREATEST(0, item_state.quantity_ordered - item_state.quantity_cancelled_total)), 0)::int,
    COALESCE(
      BOOL_AND(item_state.payable_qty <= 0 OR item_state.paid_qty_effective >= item_state.payable_qty),
      false
    )
  INTO
    v_item_count,
    v_pending_prepare,
    v_ready_available,
    v_dispatched_available,
    v_cancelled_total,
    v_active_not_cancelled,
    v_all_fully_paid
  FROM item_state;

  IF v_item_count = 0 THEN
    v_all_fully_paid := false;
  END IF;

  IF COALESCE(v_order.is_special, false) THEN
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_active_payments_total
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    v_special_total := COALESCE(v_order.special_total_manual, 0);
    v_all_fully_paid := v_special_total > 0
      AND ROUND(COALESCE(v_active_payments_total, 0), 2) >= ROUND(v_special_total, 2);
  END IF;

  IF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched_available > 0 THEN
    v_operational_status := 'KITCHEN_DISPATCHED';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_operational_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_operational_status := 'SENT_TO_KITCHEN';
  ELSE
    v_operational_status := v_order.status;
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE THEN
    WITH item_state AS (
      SELECT
        oi.id AS order_item_id,
        GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))::int AS payable_qty,
        LEAST(
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
          COALESCE(snapshot.quantity_paid, 0)::int
        )::int AS paid_qty_effective
      FROM public.order_items oi
      LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
        ON snapshot.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
    )
    UPDATE public.order_items oi
    SET paid_at = CASE
      WHEN item_state.payable_qty > 0 AND item_state.paid_qty_effective >= item_state.payable_qty
        THEN COALESCE(oi.paid_at, v_now)
      ELSE NULL
    END
    FROM item_state
    WHERE item_state.order_item_id = oi.id;
  END IF;

  IF v_all_fully_paid THEN
    v_final_status := CASE
      WHEN v_operational_status = 'KITCHEN_DISPATCHED' THEN 'KITCHEN_DISPATCHED'
      ELSE 'PAID'
    END;
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSE
    v_final_status := v_operational_status;
    v_final_paid_at := NULL;
  END IF;

  UPDATE public.orders o
  SET
    status = v_final_status,
    paid_at = v_final_paid_at,
    ready_at = CASE
      WHEN v_final_status IN ('READY', 'KITCHEN_DISPATCHED') THEN COALESCE(o.ready_at, v_last_ready_at, v_now)
      ELSE o.ready_at
    END,
    dispatched_at = CASE
      WHEN v_final_status = 'KITCHEN_DISPATCHED' THEN COALESCE(o.dispatched_at, v_last_dispatched_at, v_now)
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN v_final_status = 'CANCELLED' THEN COALESCE(o.cancelled_at, v_now)
      ELSE o.cancelled_at
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  IF COALESCE(v_order.order_type::text, '') = 'EXTRA'
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND COALESCE(v_order.is_tray_order, false) IS NOT TRUE
     AND v_all_fully_paid
     AND v_final_status IN ('PAID', 'KITCHEN_DISPATCHED') THEN
    PERFORM public.auto_finalize_extra_order_after_payment(p_order_id);

    SELECT o.status, o.paid_at
    INTO v_final_status, v_final_paid_at
    FROM public.orders o
    WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
