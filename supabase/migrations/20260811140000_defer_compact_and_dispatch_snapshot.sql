-- =============================================================================
-- Mitigar locks cruzados en cobro/despacho (fase 2)
-- =============================================================================
-- 1) Despacho: un solo get_order_operational_snapshot (sin N+1 por ítem).
-- 2) Despacho: si la orden ya entró como PAID, no llamar sync_order_payment_state
--    (recompute + liberación de mesa basta; respeta PAID terminal / especial mixta).
-- 3) compact_table_order_positions fuera del camino crítico de sync: se encola
--    durante sync/recompute y se ejecuta al final de cobro/despacho (o inmediato
--    si no hay cola activa, p. ej. triggers sueltos).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers: cola diferida de compactación de posiciones de mesa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_deferred_table_compacts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_deferred_table_compacts (
    table_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_deferred_table_compacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_deferred_table_compacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_deferred_table_compacts() TO service_role;

CREATE OR REPLACE FUNCTION public.queue_or_compact_table_order_positions(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('pg_temp.tmp_deferred_table_compacts') IS NOT NULL THEN
    INSERT INTO tmp_deferred_table_compacts (table_id)
    VALUES (p_table_id)
    ON CONFLICT DO NOTHING;
  ELSE
    PERFORM public.compact_table_order_positions(p_table_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_or_compact_table_order_positions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_or_compact_table_order_positions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_or_compact_table_order_positions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.flush_deferred_table_compacts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF to_regclass('pg_temp.tmp_deferred_table_compacts') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT table_id
    FROM tmp_deferred_table_compacts
  LOOP
    PERFORM public.compact_table_order_positions(r.table_id);
  END LOOP;

  DELETE FROM tmp_deferred_table_compacts;
END;
$$;

REVOKE ALL ON FUNCTION public.flush_deferred_table_compacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flush_deferred_table_compacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.flush_deferred_table_compacts() TO service_role;

-- Liberación de mesa post-despacho cuando ya estaba PAID (incluye especial mixta).
CREATE OR REPLACE FUNCTION public.release_dine_in_table_after_paid_dispatch(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_release_table_id uuid;
  v_table_name text := 'Mesa';
  v_now timestamptz := now();
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.order_type <> 'DINE_IN'
     OR v_order.table_id IS NULL
     OR v_order.paid_at IS NULL THEN
    RETURN;
  END IF;

  IF v_order.status <> 'KITCHEN_DISPATCHED'
     AND v_order.dispatched_at IS NULL THEN
    RETURN;
  END IF;

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
END;
$$;

REVOKE ALL ON FUNCTION public.release_dine_in_table_after_paid_dispatch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_dine_in_table_after_paid_dispatch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_dine_in_table_after_paid_dispatch(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- recompute: compact diferido
-- ---------------------------------------------------------------------------
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
  v_release_table_id uuid := NULL;
  v_table_name text := 'Mesa';
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

  IF v_order.status = 'CANCELLED'
     AND COALESCE(v_order.notes, '') ILIKE '%VOIDED_PAYMENT_CLOSED:%' THEN
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
  ELSIF v_order.status = 'PAID' OR v_order.paid_at IS NOT NULL THEN
    v_next_status := 'PAID';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_next_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_next_status := 'SENT_TO_KITCHEN';
  ELSE
    v_next_status := v_order.status;
  END IF;

  IF v_next_status = 'KITCHEN_DISPATCHED'
     AND v_order.order_type = 'DINE_IN'
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND v_order.paid_at IS NOT NULL
     AND v_order.table_id IS NOT NULL THEN
    v_release_table_id := v_order.table_id;
    SELECT rt.name
    INTO v_table_name
    FROM public.restaurant_tables rt
    WHERE rt.id = v_release_table_id;
  END IF;

  UPDATE public.orders
  SET
    status = v_next_status,
    table_name_snapshot = CASE
      WHEN v_release_table_id IS NOT NULL
        THEN COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa')
      ELSE table_name_snapshot
    END,
    table_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_id END,
    table_order_position = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_order_position END,
    split_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE split_id END,
    ready_at = CASE
      WHEN v_next_status IN ('READY', 'KITCHEN_DISPATCHED') THEN COALESCE(ready_at, v_last_ready_at, now())
      ELSE ready_at
    END,
    dispatched_at = CASE
      WHEN v_next_status = 'KITCHEN_DISPATCHED' THEN COALESCE(dispatched_at, v_last_dispatched_at, now())
      ELSE dispatched_at
    END,
    cancelled_at = CASE
      WHEN v_next_status = 'CANCELLED' THEN COALESCE(cancelled_at, now())
      ELSE cancelled_at
    END,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_release_table_id IS NOT NULL THEN
    PERFORM public.queue_or_compact_table_order_positions(v_release_table_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_order_operational_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- sync: compact diferido (misma lógica operativa que 20260725200000)
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

  SELECT COALESCE(SUM(
    GREATEST(0, oi.quantity - COALESCE(snapshot.quantity_cancelled_total, 0)) * oi.unit_price
  ), 0)
  INTO v_computed_total
  FROM public.order_items oi
  LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
    ON snapshot.order_item_id = oi.id
  WHERE oi.order_id = p_order_id;

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
        WHEN v_use_ordered_qty THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_use_ordered_qty THEN
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
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_active_payments_total
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    SELECT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = p_order_id
        AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
        AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
        AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
        AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
    )
    INTO v_has_active_payment;

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
        oi.id AS order_item_id,
        CASE
          WHEN v_use_ordered_qty THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_use_ordered_qty THEN
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

-- ---------------------------------------------------------------------------
-- Despacho: snapshot único + skip sync si ya PAID + compact diferido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_order_quantities(
  p_order_id uuid,
  p_dispatched_by uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_operation_type text DEFAULT 'partial',
  p_source_module text DEFAULT 'dispatch',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_target_order_item_id uuid;
  v_target_qty integer;
  v_pending_prepare integer;
  v_ready_available integer;
  v_paid_qty_effective integer;
  v_already_dispatched integer;
  v_max_dispatchable integer;
  v_dispatch_from_ready integer;
  v_dispatch_from_pending integer;
  v_active_qty integer;
  v_is_express boolean := false;
  v_order_fully_paid boolean := false;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_dispatch_before_payment boolean := false;
  v_especial_cero boolean := false;
BEGIN
  IF p_operation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de operacion invalido';
  END IF;

  IF p_source_module NOT IN ('kitchen', 'dispatch', 'orders', 'admin') THEN
    RAISE EXCEPTION 'Modulo origen invalido';
  END IF;

  PERFORM public.begin_deferred_table_compacts();

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  SELECT COALESCE(workflow_mode, 'CASH_THEN_DISPATCH') INTO v_workflow_mode
  FROM public.branches
  WHERE id = v_order.branch_id;

  v_is_express := v_order.order_type = 'EXPRESS';
  v_order_fully_paid := v_order.status = 'PAID' AND v_order.paid_at IS NOT NULL;
  v_dispatch_before_payment := v_is_express OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND v_order.order_type <> 'TAKEOUT');
  v_especial_cero := COALESCE(v_order.is_special, false)
    AND v_order.special_total_manual IS NOT NULL
    AND v_order.special_total_manual = 0;

  IF v_order.status = 'CANCELLED'
    OR COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades';
  END IF;

  IF v_is_express THEN
    IF v_order.status NOT IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID') THEN
      RAISE EXCEPTION 'La orden Express no permite despachar en su estado actual';
    END IF;
  ELSIF v_order.status NOT IN ('SENT_TO_KITCHEN', 'READY', 'PAID', 'KITCHEN_DISPATCHED') THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades en su estado actual';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_dispatch_snapshot (
    order_item_id uuid PRIMARY KEY,
    quantity_pending_prepare integer NOT NULL,
    quantity_ready_available integer NOT NULL,
    quantity_paid integer NOT NULL,
    quantity_cancelled_total integer NOT NULL,
    quantity_dispatched_total integer NOT NULL,
    quantity_cancelled_dispatched integer NOT NULL,
    quantity_dispatched_available integer NOT NULL,
    oi_quantity integer NOT NULL,
    oi_status text NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE tmp_dispatch_snapshot;

  INSERT INTO tmp_dispatch_snapshot (
    order_item_id,
    quantity_pending_prepare,
    quantity_ready_available,
    quantity_paid,
    quantity_cancelled_total,
    quantity_dispatched_total,
    quantity_cancelled_dispatched,
    quantity_dispatched_available,
    oi_quantity,
    oi_status
  )
  SELECT
    snapshot.order_item_id,
    COALESCE(snapshot.quantity_pending_prepare, 0)::int,
    COALESCE(snapshot.quantity_ready_available, 0)::int,
    COALESCE(snapshot.quantity_paid, 0)::int,
    COALESCE(snapshot.quantity_cancelled_total, 0)::int,
    COALESCE(snapshot.quantity_dispatched_total, 0)::int,
    COALESCE(snapshot.quantity_cancelled_dispatched, 0)::int,
    COALESCE(snapshot.quantity_dispatched_available, 0)::int,
    COALESCE(oi.quantity, 0)::int,
    COALESCE(oi.status, 'SENT')
  FROM public.get_order_operational_snapshot(p_order_id) snapshot
  JOIN public.order_items oi ON oi.id = snapshot.order_item_id;

  CREATE TEMP TABLE IF NOT EXISTS tmp_dispatch_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS tmp_dispatch_stages (
    order_item_id uuid NOT NULL,
    source_stage text NOT NULL,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE tmp_dispatch_targets;
  TRUNCATE tmp_dispatch_stages;

  IF p_operation_type = 'total' THEN
    INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
    SELECT
      s.order_item_id,
      CASE
        WHEN v_dispatch_before_payment THEN s.quantity_dispatched_available
        ELSE LEAST(
          s.quantity_dispatched_available,
          GREATEST(
            0,
            LEAST(
              GREATEST(0, s.oi_quantity - s.quantity_cancelled_total),
              CASE
                WHEN v_order_fully_paid THEN
                  GREATEST(
                    s.quantity_paid,
                    GREATEST(0, s.oi_quantity - s.quantity_cancelled_total)
                  )
                ELSE s.quantity_paid
              END
            )
            - GREATEST(
                0,
                s.quantity_dispatched_total
                - s.quantity_cancelled_dispatched
              )
          )
        )::int
      END
    FROM tmp_dispatch_snapshot s
    WHERE s.quantity_dispatched_available > 0
      AND s.oi_status <> 'DRAFT'
      AND (
        v_dispatch_before_payment
        OR s.quantity_paid > 0
        OR v_order_fully_paid
      );
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para despacho parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_dispatched')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en despacho';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad invalida para despacho en item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_dispatched = tmp_dispatch_targets.quantity_dispatched + EXCLUDED.quantity_dispatched;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_dispatch_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para despachar';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_dispatched FROM tmp_dispatch_targets
  LOOP
    SELECT
      s.quantity_pending_prepare,
      s.quantity_ready_available,
      GREATEST(0, s.oi_quantity - s.quantity_cancelled_total)::int,
      LEAST(
        GREATEST(0, s.oi_quantity - s.quantity_cancelled_total),
        CASE
          WHEN v_order_fully_paid THEN
            GREATEST(
              s.quantity_paid,
              GREATEST(0, s.oi_quantity - s.quantity_cancelled_total)
            )
          ELSE s.quantity_paid
        END
      )::int,
      GREATEST(
        0,
        s.quantity_dispatched_total
        - s.quantity_cancelled_dispatched
      )::int
    INTO v_pending_prepare, v_ready_available, v_active_qty, v_paid_qty_effective, v_already_dispatched
    FROM tmp_dispatch_snapshot s
    WHERE s.order_item_id = v_target_order_item_id;

    IF v_pending_prepare IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_dispatch_before_payment THEN
      v_max_dispatchable := v_pending_prepare + v_ready_available;
    ELSE
      IF v_paid_qty_effective <= 0 THEN
        RAISE EXCEPTION 'El item % no tiene cantidad pagada para despachar', v_target_order_item_id;
      END IF;

      v_max_dispatchable := LEAST(
        v_pending_prepare + v_ready_available,
        GREATEST(0, v_paid_qty_effective - v_already_dispatched)
      );
    END IF;

    IF v_target_qty > v_max_dispatchable THEN
      RAISE EXCEPTION 'No puedes despachar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    v_dispatch_from_ready := LEAST(v_target_qty, v_ready_available);
    v_dispatch_from_pending := GREATEST(0, v_target_qty - v_dispatch_from_ready);

    IF v_dispatch_from_ready > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'READY', v_dispatch_from_ready);
    END IF;

    IF v_dispatch_from_pending > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'PENDING', v_dispatch_from_pending);
    END IF;
  END LOOP;

  INSERT INTO public.order_dispatch_events (
    order_id,
    event_type,
    created_by,
    source_module,
    notes,
    created_at
  ) VALUES (
    p_order_id,
    p_operation_type,
    p_dispatched_by,
    p_source_module,
    p_notes,
    v_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.order_item_dispatch_events (
    order_dispatch_event_id,
    order_id,
    order_item_id,
    quantity_dispatched,
    source_stage,
    created_at
  )
  SELECT v_event_id, p_order_id, order_item_id, quantity_dispatched, source_stage, v_now
  FROM tmp_dispatch_stages;

  UPDATE public.order_items oi
  SET dispatched_at = v_now
  WHERE oi.id IN (SELECT DISTINCT order_item_id FROM tmp_dispatch_stages);

  PERFORM public.recompute_order_operational_state(p_order_id);

  IF v_order_fully_paid THEN
    -- Ya pagada: no recalcular pagos. Solo asegurar liberación de mesa
    -- (normales vía recompute; especiales mixtas vía helper).
    PERFORM public.release_dine_in_table_after_paid_dispatch(p_order_id);
  ELSE
    PERFORM public.sync_order_payment_state_internal(p_order_id);
  END IF;

  IF v_especial_cero
     AND v_dispatch_before_payment
     AND public.order_is_fully_dispatched(p_order_id)
  THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, p_dispatched_by);
  END IF;

  PERFORM public.flush_deferred_table_compacts();

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cobro: abrir cola de compact antes del sync y vaciar al final
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments jsonb,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RETURN;
  END IF;

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Pago parcial ya registrado; reintenta el cobro completo';
  END IF;

  PERFORM public.begin_deferred_table_compacts();

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
  PERFORM public.flush_deferred_table_compacts();
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
