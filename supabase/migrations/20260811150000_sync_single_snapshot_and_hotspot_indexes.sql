-- =============================================================================
-- Fase 3 rendimiento: índices hotspots + sync con snapshot único
-- =============================================================================
-- 1) Índices parciales / compuestos para gate, compact y eventos APPLIED.
-- 2) sync_order_payment_state_internal materializa UNA vez el snapshot operativo
--    (antes: 3–4 llamadas a get_order_operational_snapshot bajo FOR UPDATE).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- Gate: lookup usuario en turno + conteo de sesiones Caja
CREATE INDEX IF NOT EXISTS idx_cash_shift_users_shift_user
  ON public.cash_shift_users USING btree (shift_id, user_id);

CREATE INDEX IF NOT EXISTS idx_cash_shift_users_shift_caja_enabled
  ON public.cash_shift_users USING btree (shift_id)
  WHERE is_enabled IS TRUE AND can_use_caja IS TRUE;

-- Snapshot / sync: MAX(created_at) y joins solo sobre eventos aplicados
CREATE INDEX IF NOT EXISTS idx_order_ready_events_order_applied
  ON public.order_ready_events USING btree (order_id, created_at DESC)
  WHERE status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_order_dispatch_events_order_applied
  ON public.order_dispatch_events USING btree (order_id, created_at DESC)
  WHERE status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_order_cancellations_order_applied
  ON public.order_cancellations USING btree (order_id)
  WHERE status = 'APPLIED';

-- Compact de posiciones: órdenes activas de una mesa
CREATE INDEX IF NOT EXISTS idx_orders_table_active_position
  ON public.orders USING btree (table_id, table_order_position NULLS LAST, created_at, id)
  WHERE order_type = 'DINE_IN'
    AND table_id IS NOT NULL
    AND status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

-- ---------------------------------------------------------------------------
-- sync: un solo snapshot materializado
-- ---------------------------------------------------------------------------
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
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    IF v_all_fully_paid
       AND v_computed_total > 0
       AND ROUND(COALESCE(v_active_payments_total, 0), 2) < ROUND(v_computed_total, 2) THEN
      v_all_fully_paid := false;
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
    v_final_paid_at := NULL;
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
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
