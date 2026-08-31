-- =============================================================================
-- Blindaje: cobro completo NUNCA debe dejar la cabecera sin paid_at
-- (caso Pulpo 1 #123: payment OK + items paid_at, pero order.paid_at null → bloqueó caja final)
-- =============================================================================

-- 1) Helper: cobertura real de pago (monto + cantidades en payment_items)
CREATE OR REPLACE FUNCTION public.order_has_complete_payment_coverage(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH o AS (
    SELECT id, COALESCE(total, 0)::numeric AS total, COALESCE(is_special, false) AS is_special
    FROM public.orders
    WHERE id = p_order_id
  ),
  pay AS (
    SELECT COALESCE(SUM(p.amount), 0)::numeric AS amt
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND p.voided_at IS NULL
      AND lower(COALESCE(p.status, 'completed')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
  ),
  items AS (
    SELECT
      oi.id,
      GREATEST(
        0,
        COALESCE(oi.quantity, 0)::numeric
        - COALESCE((
            SELECT SUM(oic.quantity_cancelled)
            FROM public.order_item_cancellations oic
            JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
            WHERE oic.order_item_id = oi.id
              AND oc.status = 'APPLIED'
          ), 0)
      ) AS active_qty,
      COALESCE((
        SELECT SUM(pi.quantity_paid)
        FROM public.payment_items pi
        JOIN public.payments p ON p.id = pi.payment_id
        WHERE pi.order_item_id = oi.id
          AND p.voided_at IS NULL
          AND lower(COALESCE(p.status, 'completed')) NOT IN ('voided', 'reversed')
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
      ), 0) AS paid_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND COALESCE(oi.status, 'SENT') <> 'DRAFT'
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM o) THEN false
    WHEN (SELECT is_special FROM o) THEN false
    WHEN (SELECT total FROM o) <= 0 THEN false
    WHEN (SELECT amt FROM pay) <= 0 THEN false
    WHEN ROUND((SELECT amt FROM pay), 2) < ROUND((SELECT total FROM o), 2) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE active_qty > 0) THEN false
    WHEN EXISTS (
      SELECT 1 FROM items
      WHERE active_qty > 0
        AND paid_qty + 0.0001 < active_qty
    ) THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION public.order_has_complete_payment_coverage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_has_complete_payment_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_has_complete_payment_coverage(uuid) TO service_role;

COMMENT ON FUNCTION public.order_has_complete_payment_coverage(uuid) IS
  'True si hay pagos activos que cubren el total y payment_items cubren todas las cantidades activas.';

-- 2) Reparar órdenes del turno abierto con cobro completo pero paid_at null
CREATE OR REPLACE FUNCTION public.repair_shift_orders_missing_paid_at(p_branch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_order_id uuid;
  v_count integer := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_order_id IN
    SELECT o.id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.cash_shift_id IS NOT DISTINCT FROM v_shift_id
      AND o.paid_at IS NULL
      AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND public.order_has_complete_payment_coverage(o.id)
  LOOP
    PERFORM public.sync_order_payment_state_internal(v_order_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_shift_orders_missing_paid_at(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_shift_orders_missing_paid_at(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_shift_orders_missing_paid_at(uuid) TO service_role;

-- 3) Snapshot: quantity_dispatched_available = despachado neto (no pending+ready)
CREATE OR REPLACE FUNCTION public.get_order_operational_snapshot(p_order_id uuid)
RETURNS TABLE(
  order_id uuid,
  order_item_id uuid,
  description_snapshot text,
  item_status text,
  unit_price numeric,
  quantity_ordered integer,
  quantity_paid integer,
  quantity_ready_total integer,
  quantity_ready_available integer,
  quantity_dispatched_total integer,
  quantity_dispatched_available integer,
  quantity_cancelled_pending integer,
  quantity_cancelled_ready integer,
  quantity_cancelled_dispatched integer,
  quantity_cancelled_total integer,
  quantity_pending_prepare integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target_items AS (
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ),
  paid AS (
    SELECT
      pi.order_item_id,
      COALESCE(SUM(pi.quantity_paid), 0)::int AS quantity_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id IN (SELECT id FROM target_items)
      AND p.voided_at IS NULL
      AND lower(COALESCE(p.status, 'completed')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
    GROUP BY pi.order_item_id
  ),
  ready AS (
    SELECT
      oire.order_item_id,
      COALESCE(SUM(oire.quantity_ready), 0)::int AS quantity_ready_total
    FROM public.order_item_ready_events oire
    JOIN public.order_ready_events ore ON ore.id = oire.order_ready_event_id
    WHERE oire.order_item_id IN (SELECT id FROM target_items)
      AND ore.status = 'APPLIED'
    GROUP BY oire.order_item_id
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'PENDING'), 0)::int AS quantity_dispatched_from_pending,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'READY'), 0)::int AS quantity_dispatched_from_ready
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode ON ode.id = oide.order_dispatch_event_id
    WHERE oide.order_item_id IN (SELECT id FROM target_items)
      AND ode.status = 'APPLIED'
    GROUP BY oide.order_item_id
  ),
  cancelled AS (
    SELECT
      oic.order_item_id,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'PENDING'), 0)::int AS quantity_cancelled_pending,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'READY'), 0)::int AS quantity_cancelled_ready,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'DISPATCHED'), 0)::int AS quantity_cancelled_dispatched,
      COALESCE(SUM(oic.quantity_cancelled), 0)::int AS quantity_cancelled_total
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id IN (SELECT id FROM target_items)
      AND oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  base AS (
    SELECT
      oi.order_id,
      oi.id AS order_item_id,
      oi.description_snapshot,
      COALESCE(oi.status, 'SENT') AS item_status,
      oi.unit_price,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
      COALESCE(d.quantity_dispatched_from_pending, 0)::int AS quantity_dispatched_from_pending,
      COALESCE(d.quantity_dispatched_from_ready, 0)::int AS quantity_dispatched_from_ready,
      COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
      COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
      COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
      COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    FROM target_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
  ),
  computed AS (
    SELECT
      base.*,
      GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)::int AS quantity_ready_total_effective,
      GREATEST(
        0,
        base.quantity_ordered
        - GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)
        - base.quantity_cancelled_pending
      )::int AS quantity_pending_prepare,
      GREATEST(
        0,
        GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)
        - base.quantity_dispatched_total
        - base.quantity_cancelled_ready
      )::int AS quantity_ready_available
    FROM base
  )
  SELECT
    computed.order_id,
    computed.order_item_id,
    computed.description_snapshot,
    computed.item_status,
    computed.unit_price,
    computed.quantity_ordered,
    computed.quantity_paid,
    computed.quantity_ready_total,
    computed.quantity_ready_available,
    computed.quantity_dispatched_total,
    GREATEST(0, computed.quantity_dispatched_total - computed.quantity_cancelled_dispatched)::int AS quantity_dispatched_available,
    computed.quantity_cancelled_pending,
    computed.quantity_cancelled_ready,
    computed.quantity_cancelled_dispatched,
    computed.quantity_cancelled_total,
    computed.quantity_pending_prepare
  FROM computed;
$$;

-- 4) Sync: coverage fuerza all_fully_paid; no deja paid_at null si cobro completo

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_internal(p_order_id uuid)
 RETURNS TABLE(order_id uuid, status text, paid_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order           public.orders%ROWTYPE;
  v_now             timestamptz := now();
  v_pending_prepare integer     := 0;
  v_ready_available integer     := 0;
  v_dispatched_available integer := 0;
  v_cancelled_total integer     := 0;
  v_active_not_cancelled integer := 0;
  v_item_count      integer     := 0;
  v_all_fully_paid  boolean     := false;
  v_operational_status public.order_status;
  v_final_status    public.order_status;
  v_final_paid_at   timestamptz;
  v_last_ready_at   timestamptz;
  v_last_dispatched_at timestamptz;
  v_active_payments_total numeric := 0;
  v_special_total   numeric     := 0;
  v_computed_total  numeric     := 0;
  v_release_table_id uuid := NULL;
  v_table_name      text := 'Mesa';
  v_workflow_mode   text := 'CASH_THEN_DISPATCH';
  v_use_ordered_qty boolean := false;
  v_has_active_payment boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  SELECT COALESCE(workflow_mode, 'CASH_THEN_DISPATCH') INTO v_workflow_mode
  FROM public.branches
  WHERE id = v_order.branch_id;

  v_use_ordered_qty := (
    v_order.order_type IN ('TAKEOUT', 'EXPRESS')
    OR COALESCE(v_order.is_special, false)
    OR v_workflow_mode = 'CASH_THEN_DISPATCH'
  );

  IF v_order.status = 'KITCHEN_DISPATCHED'
     AND v_order.order_type = 'DINE_IN'
     AND v_order.paid_at IS NOT NULL THEN
    IF v_order.table_id IS NOT NULL THEN
      v_release_table_id := v_order.table_id;
      SELECT rt.name
      INTO v_table_name
      FROM public.restaurant_tables rt
      WHERE rt.id = v_release_table_id;

      UPDATE public.orders o
      SET
        table_name_snapshot = COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa'),
        table_id = NULL,
        table_order_position = NULL,
        split_id = NULL,
        updated_at = v_now
      WHERE o.id = p_order_id;

      PERFORM public.queue_or_compact_table_order_positions(v_release_table_id);
    END IF;

    RETURN QUERY SELECT p_order_id, 'KITCHEN_DISPATCHED'::text, v_order.paid_at;
    RETURN;
  END IF;

  IF v_order.status = 'PAID' THEN
    IF v_order.order_type = 'DINE_IN'
       AND v_order.table_id IS NOT NULL
       AND v_order.dispatched_at IS NOT NULL THEN
      v_release_table_id := v_order.table_id;
      SELECT rt.name
      INTO v_table_name
      FROM public.restaurant_tables rt
      WHERE rt.id = v_release_table_id;

      UPDATE public.orders o
      SET
        table_name_snapshot = COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa'),
        table_id = NULL,
        table_order_position = NULL,
        split_id = NULL,
        updated_at = v_now
      WHERE o.id = p_order_id;

      PERFORM public.queue_or_compact_table_order_positions(v_release_table_id);
    END IF;

    RETURN QUERY SELECT p_order_id, 'PAID'::text, v_order.paid_at;
    RETURN;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN QUERY SELECT p_order_id, 'CANCELLED'::text, v_order.paid_at;
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_sync_op_snapshot (
    order_item_id uuid PRIMARY KEY,
    unit_price numeric NOT NULL,
    quantity_ordered integer NOT NULL,
    quantity_paid integer NOT NULL,
    quantity_pending_prepare integer NOT NULL,
    quantity_ready_available integer NOT NULL,
    quantity_dispatched_total integer NOT NULL,
    quantity_cancelled_dispatched integer NOT NULL,
    quantity_cancelled_total integer NOT NULL,
    oi_paid_at timestamptz
  ) ON COMMIT DROP;

  TRUNCATE tmp_sync_op_snapshot;

  INSERT INTO tmp_sync_op_snapshot (
    order_item_id,
    unit_price,
    quantity_ordered,
    quantity_paid,
    quantity_pending_prepare,
    quantity_ready_available,
    quantity_dispatched_total,
    quantity_cancelled_dispatched,
    quantity_cancelled_total,
    oi_paid_at
  )
  SELECT
    snapshot.order_item_id,
    COALESCE(snapshot.unit_price, 0),
    COALESCE(snapshot.quantity_ordered, 0)::int,
    COALESCE(snapshot.quantity_paid, 0)::int,
    COALESCE(snapshot.quantity_pending_prepare, 0)::int,
    COALESCE(snapshot.quantity_ready_available, 0)::int,
    COALESCE(snapshot.quantity_dispatched_total, 0)::int,
    COALESCE(snapshot.quantity_cancelled_dispatched, 0)::int,
    COALESCE(snapshot.quantity_cancelled_total, 0)::int,
    oi.paid_at
  FROM public.get_order_operational_snapshot(p_order_id) snapshot
  JOIN public.order_items oi ON oi.id = snapshot.order_item_id;

  SELECT COALESCE(SUM(
    GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total) * s.unit_price
  ), 0)
  INTO v_computed_total
  FROM tmp_sync_op_snapshot s;

  IF v_computed_total IS DISTINCT FROM v_order.total THEN
    UPDATE public.orders
    SET total = v_computed_total, updated_at = v_now
    WHERE id = p_order_id;
    v_order.total := v_computed_total;
  END IF;

  SELECT MAX(ore.created_at) INTO v_last_ready_at
  FROM public.order_ready_events ore
  WHERE ore.order_id = p_order_id AND ore.status = 'APPLIED';

  SELECT MAX(ode.created_at) INTO v_last_dispatched_at
  FROM public.order_dispatch_events ode
  WHERE ode.order_id = p_order_id AND ode.status = 'APPLIED';

  WITH item_state AS (
    SELECT
      s.order_item_id,
      s.quantity_ordered,
      s.oi_paid_at AS paid_at,
      s.quantity_pending_prepare,
      s.quantity_ready_available,
      GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)::int
        AS quantity_dispatched_available,
      s.quantity_cancelled_total,
      CASE
        WHEN v_use_ordered_qty THEN
          GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)
        ELSE
          GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_use_ordered_qty THEN
            GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)
          ELSE
            GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)
        END,
        CASE
          WHEN s.quantity_paid > 0 THEN s.quantity_paid
          WHEN s.oi_paid_at IS NOT NULL THEN s.quantity_ordered
          ELSE 0
        END
      )::int AS paid_qty_effective
    FROM tmp_sync_op_snapshot s
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(item_state.quantity_pending_prepare), 0)::int,
    COALESCE(SUM(item_state.quantity_ready_available), 0)::int,
    COALESCE(SUM(item_state.quantity_dispatched_available), 0)::int,
    COALESCE(SUM(item_state.quantity_cancelled_total), 0)::int,
    COALESCE(SUM(GREATEST(0, item_state.quantity_ordered - item_state.quantity_cancelled_total)), 0)::int,
    COALESCE(
      BOOL_AND(
        GREATEST(0, item_state.quantity_ordered - item_state.quantity_cancelled_total) <= 0
        OR (
          item_state.payable_qty > 0
          AND item_state.paid_qty_effective >= item_state.payable_qty
        )
      ),
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
    SELECT
      COALESCE(SUM(p.amount), 0),
      COUNT(*) > 0
    INTO v_active_payments_total, v_has_active_payment
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    v_special_total := COALESCE(v_order.special_total_manual, 0);
    v_all_fully_paid := (
      v_order.special_total_manual IS NOT NULL
      AND v_order.special_total_manual = 0
      AND v_has_active_payment
    ) OR (
      v_special_total > 0
      AND ROUND(COALESCE(v_active_payments_total, 0), 2) >= ROUND(v_special_total, 2)
    );
  ELSE
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_active_payments_total
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND p.voided_at IS NULL
      AND lower(COALESCE(p.status, 'completed')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    IF v_all_fully_paid
       AND v_computed_total > 0
       AND ROUND(COALESCE(v_active_payments_total, 0), 2) < ROUND(v_computed_total, 2) THEN
      v_all_fully_paid := false;
    END IF;

    IF NOT v_all_fully_paid
       AND public.order_has_complete_payment_coverage(p_order_id) THEN
      v_all_fully_paid := true;
    END IF;
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
        s.order_item_id,
        CASE
          WHEN v_use_ordered_qty THEN
            GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)
          ELSE
            GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_use_ordered_qty THEN
              GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)
            ELSE
              GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)
          END,
          CASE
            WHEN s.quantity_paid > 0 THEN s.quantity_paid
            WHEN s.oi_paid_at IS NOT NULL THEN s.quantity_ordered
            ELSE 0
          END
        )::int AS paid_qty_effective
      FROM tmp_sync_op_snapshot s
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

  IF NOT v_all_fully_paid
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND public.order_has_complete_payment_coverage(p_order_id) THEN
    v_all_fully_paid := true;
  END IF;

  IF v_all_fully_paid THEN
    IF v_order.order_type = 'DINE_IN'
       AND COALESCE(v_order.is_special, false) IS NOT TRUE
       AND v_operational_status = 'KITCHEN_DISPATCHED' THEN
      v_final_status := 'KITCHEN_DISPATCHED';
    ELSIF COALESCE(v_order.is_tray_order, false) AND v_operational_status <> 'KITCHEN_DISPATCHED' THEN
      v_final_status := 'READY';
    ELSE
      v_final_status := 'PAID';
    END IF;
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSE
    v_final_status := v_operational_status;
    -- Nunca borrar paid_at si el cobro ya cubre la orden
    IF public.order_has_complete_payment_coverage(p_order_id) THEN
      v_final_paid_at := COALESCE(v_order.paid_at, v_now);
      v_final_status := CASE
        WHEN v_order.order_type = 'DINE_IN'
             AND COALESCE(v_order.is_special, false) IS NOT TRUE
             AND v_operational_status = 'KITCHEN_DISPATCHED'
          THEN 'KITCHEN_DISPATCHED'
        WHEN COALESCE(v_order.is_tray_order, false) AND v_operational_status <> 'KITCHEN_DISPATCHED'
          THEN 'READY'
        ELSE 'PAID'
      END;
    ELSE
      v_final_paid_at := NULL;
    END IF;
  END IF;

  IF v_order.order_type = 'DINE_IN'
     AND v_order.table_id IS NOT NULL
     AND (v_order.paid_at IS NOT NULL OR v_final_paid_at IS NOT NULL)
     AND (
       v_final_status = 'KITCHEN_DISPATCHED'
       OR (
         v_final_status = 'PAID'
         AND v_operational_status = 'KITCHEN_DISPATCHED'
       )
     ) THEN
    v_release_table_id := v_order.table_id;
    SELECT rt.name
    INTO v_table_name
    FROM public.restaurant_tables rt
    WHERE rt.id = v_release_table_id;
  END IF;

  UPDATE public.orders o
  SET
    status = v_final_status,
    paid_at = v_final_paid_at,
    table_name_snapshot = CASE
      WHEN v_release_table_id IS NOT NULL
        THEN COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa')
      ELSE o.table_name_snapshot
    END,
    table_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE o.table_id END,
    table_order_position = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE o.table_order_position END,
    split_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE o.split_id END,
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

  IF v_release_table_id IS NOT NULL THEN
    PERFORM public.queue_or_compact_table_order_positions(v_release_table_id);
  END IF;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$function$;



-- 5) register_payment: sync aunque el pago ya exista (idempotencia)

CREATE OR REPLACE FUNCTION public.register_payment_with_items(p_payments jsonb, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_order_count int;
  v_existing_count int;
  v_payment_count int;
  v_item record;
  v_qty_item numeric;
  v_qty_already_paid numeric;
  v_qty_cancelled numeric;
  v_available numeric;
BEGIN
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'payments es obligatorio';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items es obligatorio';
  END IF;

  SELECT count(DISTINCT (p->>'order_id')::uuid)
  INTO v_order_count
  FROM jsonb_array_elements(p_payments) AS p;

  IF v_order_count <> 1 THEN
    RAISE EXCEPTION 'Todos los pagos deben pertenecer a la misma orden';
  END IF;

  SELECT (p->>'order_id')::uuid
  INTO v_order_id
  FROM jsonb_array_elements(p_payments) AS p
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio en payments';
  END IF;

  PERFORM 1
  FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  PERFORM 1
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id
    AND oi.id IN (
      SELECT DISTINCT (i->>'order_item_id')::uuid
      FROM jsonb_array_elements(p_items) AS i
    )
  FOR UPDATE;

  SELECT count(*)::int
  INTO v_payment_count
  FROM jsonb_array_elements(p_payments) AS p;

  SELECT count(*)::int
  INTO v_existing_count
  FROM jsonb_array_elements(p_payments) AS p
  WHERE EXISTS (
    SELECT 1
    FROM public.payments pay
    WHERE pay.id = (p->>'id')::uuid
  );

  IF v_existing_count = v_payment_count THEN
    -- Pago ya existía: igual sincronizar cabecera (evita paid_at null)
    PERFORM public.sync_order_payment_state_internal(v_order_id);
    RETURN;
  END IF;

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Pago parcial ya registrado; reintenta el cobro completo';
  END IF;

  FOR v_item IN
    SELECT
      (i->>'order_item_id')::uuid AS order_item_id,
      SUM(COALESCE((i->>'quantity_paid')::numeric, 0)) AS qty_requested
    FROM jsonb_array_elements(p_items) AS i
    GROUP BY 1
  LOOP
    IF v_item.order_item_id IS NULL THEN
      RAISE EXCEPTION 'order_item_id es obligatorio en items';
    END IF;

    IF v_item.qty_requested IS NULL OR v_item.qty_requested <= 0 THEN
      RAISE EXCEPTION 'Cantidad a cobrar invalida';
    END IF;

    SELECT oi.quantity::numeric
    INTO v_qty_item
    FROM public.order_items oi
    WHERE oi.id = v_item.order_item_id
      AND oi.order_id = v_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la orden', v_item.order_item_id;
    END IF;

    SELECT COALESCE(SUM(pi.quantity_paid), 0)
    INTO v_qty_already_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id = v_item.order_item_id
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed');

    SELECT COALESCE(SUM(oic.quantity_cancelled), 0)
    INTO v_qty_cancelled
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id = v_item.order_item_id
      AND oc.status = 'APPLIED';

    v_available := GREATEST(0, COALESCE(v_qty_item, 0) - COALESCE(v_qty_cancelled, 0) - COALESCE(v_qty_already_paid, 0));

    IF v_item.qty_requested > v_available + 0.0001 THEN
      RAISE EXCEPTION
        'No se puede cobrar % unidades del item; solo hay % pendientes',
        v_item.qty_requested,
        v_available;
    END IF;
  END LOOP;

  -- Evitar doble sync (payments + payment_items) bajo el mismo FOR UPDATE.
  PERFORM set_config('app.skip_payment_state_sync', '1', true);

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    banco_id,
    numero_transferencia,
    created_by,
    created_at
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    NULLIF(p->>'change_amount', '')::numeric,
    p->>'notes',
    NULLIF(p->>'banco_id', '')::uuid,
    NULLIF(TRIM(p->>'numero_transferencia'), ''),
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p;

  INSERT INTO public.payment_items (
    id,
    payment_id,
    order_item_id,
    quantity_paid,
    unit_price,
    total_amount
  )
  SELECT
    (i->>'id')::uuid,
    (i->>'payment_id')::uuid,
    (i->>'order_item_id')::uuid,
    (i->>'quantity_paid')::numeric,
    (i->>'unit_price')::numeric,
    (i->>'total_amount')::numeric
  FROM jsonb_array_elements(p_items) AS i;

  PERFORM set_config('app.skip_payment_state_sync', '0', true);
  PERFORM public.sync_order_payment_state_internal(v_order_id);
END;
$function$;



-- 6) list blockers: no bloquear si coverage completa

CREATE OR REPLACE FUNCTION public.list_branch_closure_blocking_orders(p_branch_id uuid)
 RETURNS TABLE(order_id uuid, reference_label text, order_status order_status, paid_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH open_shift AS (
    SELECT cs.id AS shift_id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  shift_orders AS (
    SELECT o.*
    FROM public.orders o
    CROSS JOIN open_shift os
    WHERE o.branch_id = p_branch_id
      AND o.cash_shift_id IS NOT DISTINCT FROM os.shift_id
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
  ),
  -- Solo PAID no-especiales se evalúan por despacho pendiente
  paid_candidates AS (
    SELECT so.id
    FROM shift_orders so
    WHERE so.status = 'PAID'
      AND NOT COALESCE(so.is_special, false)
  ),
  item_ops AS (
    SELECT
      oi.order_id,
      oi.id AS order_item_id,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered
    FROM public.order_items oi
    JOIN paid_candidates pc ON pc.id = oi.order_id
    WHERE oi.status <> 'DRAFT'
      AND COALESCE(oi.quantity, 0) > 0
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode
      ON ode.id = oide.order_dispatch_event_id
    JOIN item_ops io
      ON io.order_item_id = oide.order_item_id
    WHERE ode.status = 'APPLIED'
    GROUP BY oide.order_item_id
  ),
  cancelled AS (
    SELECT
      oic.order_item_id,
      COALESCE(SUM(oic.quantity_cancelled), 0)::int AS quantity_cancelled_total,
      COALESCE(
        SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'DISPATCHED'),
        0
      )::int AS quantity_cancelled_dispatched
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc
      ON oc.id = oic.order_cancellation_id
    JOIN item_ops io
      ON io.order_item_id = oic.order_item_id
    WHERE oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  paid_with_pending_dispatch AS (
    SELECT DISTINCT io.order_id
    FROM item_ops io
    LEFT JOIN dispatched d ON d.order_item_id = io.order_item_id
    LEFT JOIN cancelled c ON c.order_item_id = io.order_item_id
    WHERE GREATEST(0, io.quantity_ordered - COALESCE(c.quantity_cancelled_total, 0))
        > GREATEST(
            0,
            COALESCE(d.quantity_dispatched_total, 0)
              - COALESCE(c.quantity_cancelled_dispatched, 0)
          )
    UNION
    SELECT pc.id
    FROM paid_candidates pc
    WHERE NOT EXISTS (
      SELECT 1
      FROM item_ops io
      WHERE io.order_id = pc.id
    )
  )
  SELECT
    o.id AS order_id,
    CASE
      WHEN COALESCE(o.is_special, false) THEN
        'Orden especial'
      WHEN COALESCE(o.is_tray_order, false) THEN
        'Bandeja'
      WHEN o.order_type = 'TAKEOUT' THEN
        'Para llevar'
      WHEN o.order_type = 'EXPRESS' THEN
        'Express'
      WHEN o.order_type = 'EXTRA' THEN
        'Extra'
      WHEN o.order_type = 'DINE_IN' AND ts.split_code IS NOT NULL THEN
        COALESCE(rt.name, 'Mesa') || ' ' || ts.split_code
      WHEN o.order_type = 'DINE_IN' THEN
        COALESCE(rt.name, o.table_name_snapshot, 'Mesa')
      ELSE
        'Orden'
    END AS reference_label,
    o.status AS order_status,
    o.paid_at,
    o.created_at,
    o.updated_at
  FROM shift_orders o
  LEFT JOIN public.restaurant_tables rt
    ON rt.id = o.table_id
  LEFT JOIN public.table_splits ts
    ON ts.id = o.split_id
  WHERE
    (
      o.status = 'DRAFT'
      AND (
        EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.order_id = o.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id = o.id
            AND oi.status <> 'DRAFT'
        )
      )
    )
    OR (
      o.status IN ('SENT_TO_KITCHEN', 'READY')
      AND NOT public.order_has_complete_payment_coverage(o.id)
    )
    OR (
      o.status = 'KITCHEN_DISPATCHED'
      AND o.paid_at IS NULL
      AND NOT public.order_has_complete_payment_coverage(o.id)
    )
    OR (
      -- PAID especiales NO bloquean (ya cobradas)
      o.status = 'PAID'
      AND NOT COALESCE(o.is_special, false)
      AND o.id IN (SELECT pwd.order_id FROM paid_with_pending_dispatch pwd)
    )
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST;
$function$;



-- 7) close_cash_register: repair antes de evaluar blockers

CREATE OR REPLACE FUNCTION public.close_cash_register(p_shift_id uuid, p_cashier_id uuid, p_branch_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_opening_id uuid;
  v_other_real_open int := 0;
  v_unpaid_count int := 0;
  v_unpaid_preview text := '';
  v_blockers jsonb;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_cashier_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_cashier_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una apertura de caja activa para cerrar';
  END IF;

  -- Otras cajas "reales" que seguirían abiertas si cerramos esta
  SELECT COUNT(*)::int
  INTO v_other_real_open
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
    AND cro.id <> v_opening_id
    AND (
      NOT public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
      OR public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id)
    );

  IF v_other_real_open = 0 THEN
    -- Autoreparar cabeceras con cobro completo antes de evaluar bloqueos
    PERFORM public.repair_shift_orders_missing_paid_at(p_branch_id);
    v_blockers := public.get_branch_shift_closure_blockers(p_branch_id);
    v_unpaid_count := jsonb_array_length(COALESCE(v_blockers -> 'unpaid_orders', '[]'::jsonb));

    IF v_unpaid_count > 0 THEN
      SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
      INTO v_unpaid_preview
      FROM (
        SELECT r.order_ref, r.label
        FROM jsonb_to_recordset(v_blockers -> 'unpaid_orders') AS r(order_id uuid, order_ref text, label text, status text)
        ORDER BY r.order_ref
        LIMIT 20
      ) x;

      RAISE EXCEPTION
        'No puedes cerrar la caja porque es la última abierta y aún hay órdenes por cobrar.%s%s',
        E'\n\nÓrdenes sin pagar: ' || COALESCE(v_unpaid_preview, ''),
        CASE
          WHEN v_unpaid_count > 20 THEN E'\n… y ' || (v_unpaid_count - 20)::text || ' más'
          ELSE ''
        END;
    END IF;
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$function$;


