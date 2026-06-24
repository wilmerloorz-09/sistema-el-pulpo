-- =============================================================================
-- Regla única: pagado + todo despachado = KITCHEN_DISPATCHED (orden terminada).
-- =============================================================================
-- Corrige de raíz:
--   1. PAID ya no es terminal si todo está despachado (sync puede finalizar).
--   2. Cierre de turno solo bloquea PAID con despacho pendiente (no las atascadas).
--   3. Órdenes del turno abierto únicamente (no historial de turnos cerrados).
--   4. Backfill: PAID + despacho completo → KITCHEN_DISPATCHED en toda la sucursal.

-- ─── Helpers operativos ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.order_is_fully_dispatched(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        COALESCE(SUM(s.quantity_pending_prepare), 0) = 0
        AND COALESCE(SUM(s.quantity_ready_available), 0) = 0
        AND COALESCE(
          SUM(GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)),
          0
        ) > 0
        AND COALESCE(SUM(GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)), 0) > 0
      FROM public.get_order_operational_snapshot(p_order_id) s
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.order_is_operationally_complete(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.paid_at IS NOT NULL
      AND o.status <> 'CANCELLED'
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
      AND public.order_is_fully_dispatched(p_order_id)
  );
$$;

REVOKE ALL ON FUNCTION public.order_is_fully_dispatched(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_is_fully_dispatched(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.order_is_operationally_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_is_operationally_complete(uuid) TO authenticated;

-- ─── Cierre de turno: solo lo realmente pendiente ───────────────────────────

CREATE OR REPLACE FUNCTION public.list_branch_closure_blocking_orders(
  p_branch_id uuid
)
RETURNS TABLE (
  order_id uuid,
  reference_label text,
  order_status public.order_status,
  paid_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_shift AS (
    SELECT cs.id AS shift_id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
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
  FROM public.orders o
  LEFT JOIN public.restaurant_tables rt
    ON rt.id = o.table_id
  LEFT JOIN public.table_splits ts
    ON ts.id = o.split_id
  CROSS JOIN open_shift os
  WHERE o.branch_id = p_branch_id
    AND o.cash_shift_id IS NOT DISTINCT FROM os.shift_id
    AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
    AND (
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
      OR o.status IN ('SENT_TO_KITCHEN', 'READY')
      OR (o.status = 'KITCHEN_DISPATCHED' AND o.paid_at IS NULL)
      OR (
        o.status = 'PAID'
        AND (
          COALESCE(o.is_special, false)
          OR NOT public.order_is_fully_dispatched(o.id)
        )
      )
    )
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST;
$$;

-- ─── Sync: PAID + despachado → KITCHEN_DISPATCHED ───────────────────────────

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
  v_fully_dispatched boolean := false;
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

  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RETURN QUERY SELECT p_order_id, 'CANCELLED'::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN QUERY SELECT p_order_id, 'CANCELLED'::text, v_order.paid_at;
    RETURN;
  END IF;

  v_fully_dispatched := public.order_is_fully_dispatched(p_order_id);

  -- Orden terminada: pagada y todo despachado. Solo asegurar mesa liberada.
  IF v_order.status = 'KITCHEN_DISPATCHED'
     AND v_order.paid_at IS NOT NULL
     AND v_fully_dispatched THEN
    IF v_order.order_type = 'DINE_IN'
       AND COALESCE(v_order.is_special, false) IS NOT TRUE
       AND v_order.table_id IS NOT NULL THEN
      v_release_table_id := v_order.table_id;
      SELECT rt.name INTO v_table_name
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

      PERFORM public.compact_table_order_positions(v_release_table_id);
    END IF;

    RETURN QUERY SELECT p_order_id, 'KITCHEN_DISPATCHED'::text, v_order.paid_at;
    RETURN;
  END IF;

  -- PAID con despacho pendiente: no recalcular (espera despacho).
  IF v_order.status = 'PAID'
     AND v_order.paid_at IS NOT NULL
     AND NOT v_fully_dispatched THEN
    RETURN QUERY SELECT p_order_id, 'PAID'::text, v_order.paid_at;
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
        WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
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

  v_fully_dispatched := v_pending_prepare = 0
    AND v_ready_available = 0
    AND v_dispatched_available > 0
    AND v_active_not_cancelled > 0;

  IF v_order.status <> 'DRAFT' AND v_active_not_cancelled <= 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_fully_dispatched THEN
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
          WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
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

  IF COALESCE(v_order.is_special, false) THEN
    IF v_all_fully_paid THEN
      v_final_status := 'PAID';
      v_final_paid_at := COALESCE(v_order.paid_at, v_now);
    ELSE
      v_final_status := v_operational_status;
      v_final_paid_at := NULL;
    END IF;
  ELSIF COALESCE(v_order.is_tray_order, false) AND v_all_fully_paid AND NOT v_fully_dispatched THEN
    v_final_status := 'READY';
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSIF (v_all_fully_paid OR v_order.paid_at IS NOT NULL) AND v_fully_dispatched THEN
    v_final_status := 'KITCHEN_DISPATCHED';
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSIF v_all_fully_paid OR v_order.paid_at IS NOT NULL THEN
    v_final_status := 'PAID';
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSE
    v_final_status := v_operational_status;
    v_final_paid_at := NULL;
  END IF;

  IF v_final_status = 'KITCHEN_DISPATCHED'
     AND v_order.order_type = 'DINE_IN'
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND v_final_paid_at IS NOT NULL
     AND v_order.table_id IS NOT NULL THEN
    v_release_table_id := v_order.table_id;
    SELECT rt.name INTO v_table_name
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
    PERFORM public.compact_table_order_positions(v_release_table_id);
  END IF;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

-- ─── Recompute: misma regla al despachar ────────────────────────────────────

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
    PERFORM public.compact_table_order_positions(v_release_table_id);
  END IF;
END;
$$;

-- ─── Backfill: PAID atascadas con despacho completo ───────────────────────────

DO $$
DECLARE
  r record;
  v_table_name text;
  v_release_table_id uuid;
BEGIN
  FOR r IN
    SELECT o.id, o.table_id, o.order_type
    FROM public.orders o
    WHERE o.status = 'PAID'
      AND o.paid_at IS NOT NULL
      AND COALESCE(o.is_special, false) IS NOT TRUE
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
      AND public.order_is_fully_dispatched(o.id)
  LOOP
    v_release_table_id := NULL;
    IF r.order_type = 'DINE_IN' AND r.table_id IS NOT NULL THEN
      v_release_table_id := r.table_id;
      SELECT rt.name INTO v_table_name
      FROM public.restaurant_tables rt
      WHERE rt.id = v_release_table_id;
    END IF;

    UPDATE public.orders
    SET
      status = 'KITCHEN_DISPATCHED',
      table_name_snapshot = CASE
        WHEN v_release_table_id IS NOT NULL
          THEN COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa')
        ELSE table_name_snapshot
      END,
      table_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_id END,
      table_order_position = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_order_position END,
      split_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE split_id END,
      dispatched_at = COALESCE(dispatched_at, now()),
      updated_at = now()
    WHERE id = r.id;

    IF v_release_table_id IS NOT NULL THEN
      PERFORM public.compact_table_order_positions(v_release_table_id);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.list_branch_closure_blocking_orders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_branch_closure_blocking_orders(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.recompute_order_operational_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
