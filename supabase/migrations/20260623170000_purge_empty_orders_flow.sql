-- generic function to purge empty orders of any type
CREATE OR REPLACE FUNCTION public.purge_empty_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_id uuid;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_shift_gate_ok boolean := false;
  v_creator_empty boolean := false;
  v_branch_view_ok boolean := false;
  v_item_count integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Must have 0 items to be considered empty/invalid.
  SELECT COUNT(*)
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_item_count > 0 THEN
    RETURN NULL;
  END IF;

  -- 2. DINE_IN orders can only be purged if they are DRAFT and have no kitchen/ready/dispatched timestamps.
  IF v_order.order_type = 'DINE_IN' THEN
    IF v_order.status <> 'DRAFT'
      OR v_order.sent_to_kitchen_at IS NOT NULL
      OR v_order.ready_at IS NOT NULL
      OR v_order.dispatched_at IS NOT NULL
    THEN
      RETURN NULL;
    END IF;
  END IF;

  -- 3. Check permissions (same as relaxed purge_empty_dine_in_draft_order)
  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_shift_id,
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = auth.uid()
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  v_shift_gate_ok := (
    v_shift_id IS NOT NULL
    AND COALESCE(v_user_enabled, false) IS TRUE
    AND (
      COALESCE(v_can_serve_tables, false) IS TRUE
      OR COALESCE(v_can_access_orders, false) IS TRUE
      OR COALESCE(v_is_supervisor, false) IS TRUE
    )
  );

  v_creator_empty := (
    auth.uid() IS NOT NULL
    AND v_order.created_by IS NOT DISTINCT FROM auth.uid()
  );

  v_branch_view_ok := (
    public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'VIEW'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'VIEW'::public.access_level)
  );

  IF NOT (
    v_has_operate_permission
    OR v_shift_gate_ok
    OR v_creator_empty
    OR v_branch_view_ok
  ) THEN
    RETURN NULL;
  END IF;

  v_table_id := v_order.table_id;

  -- Delete modifiers, items, payments, and the order itself
  DELETE FROM public.order_item_modifiers oim
  USING public.order_items oi
  WHERE oi.id = oim.order_item_id
    AND oi.order_id = p_order_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.payments
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  IF v_order.order_type = 'DINE_IN' AND v_table_id IS NOT NULL THEN
    PERFORM public.compact_table_order_positions(v_table_id);
    RETURN v_table_id;
  END IF;

  RETURN p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_empty_order(uuid) TO authenticated;

-- Redefine purge_empty_dine_in_draft_order to call generic purge_empty_order
CREATE OR REPLACE FUNCTION public.purge_empty_dine_in_draft_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.purge_empty_order(p_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_empty_dine_in_draft_order(uuid) TO authenticated;

-- Generic branch purging
CREATE OR REPLACE FUNCTION public.purge_empty_orders_for_branch(
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND (
        (order_type = 'DINE_IN' AND status = 'DRAFT')
        OR
        (order_type IN ('TAKEOUT', 'EXPRESS', 'EXTRA'))
      )
  LOOP
    IF public.purge_empty_order(r.id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_empty_orders_for_branch(uuid) TO authenticated;

-- Redefine purge_empty_dine_in_draft_orders_for_branch to call public.purge_empty_orders_for_branch
CREATE OR REPLACE FUNCTION public.purge_empty_dine_in_draft_orders_for_branch(
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.purge_empty_orders_for_branch(p_branch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_empty_dine_in_draft_orders_for_branch(uuid) TO authenticated;

-- Update operational state triggers to cancel active orders that become empty
CREATE OR REPLACE FUNCTION public.recompute_order_operational_state(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_cancelled_total integer := 0;
  v_active_not_cancelled integer := 0;
  v_next_status public.order_status;
  v_last_ready_at timestamptz;
  v_last_dispatched_at timestamptz;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    UPDATE public.orders
    SET status = 'CANCELLED',
        paid_at = NULL,
        table_id = NULL,
        split_id = NULL,
        table_order_position = NULL,
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_at = now()
    WHERE id = p_order_id;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(quantity_pending_prepare), 0)::int,
    COALESCE(SUM(quantity_ready_available), 0)::int,
    COALESCE(SUM(quantity_dispatched_total - quantity_cancelled_dispatched), 0)::int,
    COALESCE(SUM(quantity_cancelled_total), 0)::int,
    COALESCE(SUM(quantity_ordered - quantity_cancelled_total), 0)::int
  INTO v_pending_prepare, v_ready_available, v_dispatched_net, v_cancelled_total, v_active_not_cancelled
  FROM public.get_order_operational_snapshot(p_order_id);

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

  IF v_order.status <> 'DRAFT' AND v_active_not_cancelled <= 0 THEN
    v_next_status := 'CANCELLED';
  ELSIF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_next_status := 'CANCELLED';
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched_net > 0 THEN
    v_next_status := 'KITCHEN_DISPATCHED';
  ELSIF v_order.status = 'PAID' THEN
    v_next_status := 'PAID';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_next_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_next_status := 'SENT_TO_KITCHEN';
  ELSE
    v_next_status := v_order.status;
  END IF;

  UPDATE public.orders
  SET
    status = v_next_status,
    ready_at = CASE
      WHEN v_next_status IN ('READY', 'KITCHEN_DISPATCHED') THEN COALESCE(ready_at, v_last_ready_at, now())
      ELSE ready_at
    END,
    dispatched_at = CASE
      WHEN v_next_status = 'KITCHEN_DISPATCHED' THEN COALESCE(dispatched_at, v_last_dispatched_at, now())
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN v_next_status = 'CANCELLED' THEN COALESCE(cancelled_at, now())
      ELSE cancelled_at
    END,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;

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
      oi.paid_at,
      COALESCE(snapshot.quantity_paid, 0)::int AS quantity_paid_from_payments,
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
      CASE
        WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END,
        CASE
          WHEN COALESCE(snapshot.quantity_paid, 0) > 0 THEN COALESCE(snapshot.quantity_paid, 0)::int
          WHEN oi.paid_at IS NOT NULL THEN COALESCE(oi.quantity, 0)::int
          ELSE 0
        END
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

  IF v_order.status <> 'DRAFT' AND v_active_not_cancelled <= 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
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
        CASE
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
              GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
            ELSE
              GREATEST(
                0,
                COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
              )
          END,
          CASE
            WHEN COALESCE(snapshot.quantity_paid, 0) > 0 THEN COALESCE(snapshot.quantity_paid, 0)::int
            WHEN oi.paid_at IS NOT NULL THEN COALESCE(oi.quantity, 0)::int
            ELSE 0
          END
        )::int AS paid_qty_effective
      FROM public.order_items oi
      LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
        ON snapshot.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
    )
    UPDATE public.order_items oi
    SET paid_at = CASE
      WHEN item_state.payable_qty <= 0 OR item_state.paid_qty_effective >= item_state.payable_qty
        THEN COALESCE(oi.paid_at, v_now)
      ELSE NULL
    END
    FROM item_state
    WHERE item_state.order_item_id = oi.id;
  END IF;

  IF v_all_fully_paid THEN
    IF v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_tray_order, false) THEN
      v_final_status := CASE
        WHEN v_operational_status <> 'KITCHEN_DISPATCHED' THEN 'READY'
        ELSE 'KITCHEN_DISPATCHED'
      END;
    ELSE
      v_final_status := 'PAID';
    END IF;
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
      WHEN v_final_status IN ('READY', 'KITCHEN_DISPATCHED', 'PAID')
        THEN COALESCE(o.ready_at, v_last_ready_at, v_now)
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_final_status IN ('KITCHEN_DISPATCHED', 'PAID')
        THEN COALESCE(o.dispatched_at, v_last_dispatched_at, v_now)
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN v_final_status = 'CANCELLED' THEN COALESCE(o.cancelled_at, v_now)
      ELSE o.cancelled_at
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

-- One-time cleanup of existing empty takeout/express/extra orders
DELETE FROM public.orders o
WHERE o.order_type IN ('TAKEOUT', 'EXPRESS', 'EXTRA')
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
  );

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
