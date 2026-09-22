-- =============================================================================
-- Fix: ordenes especiales cobradas sin special_total_manual no marcaban paid_at
-- Sintoma: UI Pagado + payment COMPLETED, pero paid_at null + KITCHEN_DISPATCHED
--         bloquea cierre de ultima caja (ej. SUC003260921-0035).
-- Causa: sync/coverage solo miraban special_total_manual (NULL => nunca pagada).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_has_complete_payment_coverage(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH o AS (
    SELECT
      id,
      COALESCE(total, 0)::numeric AS total,
      special_total_manual,
      COALESCE(is_special, false) AS is_special
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
  expected_special AS (
    SELECT CASE
      WHEN (SELECT special_total_manual FROM o) IS NOT NULL
        THEN (SELECT special_total_manual FROM o)
      ELSE (SELECT total FROM o)
    END AS amount
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
    WHEN (SELECT is_special FROM o) THEN
      CASE
        WHEN (SELECT amount FROM expected_special) = 0 THEN
          EXISTS (
            SELECT 1 FROM public.payments p
            WHERE p.order_id = p_order_id
              AND p.voided_at IS NULL
              AND lower(COALESCE(p.status, 'completed')) NOT IN ('voided', 'reversed')
          )
        WHEN (SELECT amount FROM expected_special) > 0 THEN
          ROUND((SELECT amt FROM pay), 2) >= ROUND((SELECT amount FROM expected_special), 2)
        ELSE false
      END
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

COMMENT ON FUNCTION public.order_has_complete_payment_coverage(uuid) IS
  'True si pagos activos cubren el total. En especiales usa COALESCE(special_total_manual, total).';

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_internal(p_order_id uuid)
 RETURNS TABLE(order_id uuid, status text, paid_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- Manual si existe; si no, total de la orden (especial cobrada por items).
    v_special_total := CASE
      WHEN v_order.special_total_manual IS NOT NULL THEN v_order.special_total_manual
      ELSE COALESCE(v_order.total, 0)
    END;
    v_all_fully_paid := (
      v_special_total = 0
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
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register(p_shift_id uuid, p_cashier_id uuid, p_branch_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
    AND cro.register_role <> 'auxiliary'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una apertura de caja activa para cerrar';
  END IF;

  SELECT COUNT(*)::int
  INTO v_other_real_open
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
    AND cro.id <> v_opening_id
    AND (
      NOT public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
      OR public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id)
    );

  IF v_other_real_open = 0 THEN
    -- Autoreparar cabeceras con cobro completo (incl. especiales sin manual)
    PERFORM public.repair_shift_orders_missing_paid_at(p_branch_id);
    v_blockers := public.get_branch_shift_closure_blockers(p_branch_id);
    v_unpaid_count := jsonb_array_length(COALESCE(v_blockers -> 'unpaid_orders', '[]'::jsonb));

    IF v_unpaid_count > 0 THEN
      SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
      INTO v_unpaid_preview
      FROM (
        SELECT r.order_ref, r.label
        FROM jsonb_to_recordset(v_blockers -> 'unpaid_orders')
          AS r(order_id uuid, order_ref text, label text, status text)
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
$$;

-- Reparar turnos abiertos ya afectadoscidos
DO $$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN
    SELECT DISTINCT cs.branch_id
    FROM public.cash_shifts cs
    WHERE cs.status = 'OPEN'
  LOOP
    n := public.repair_shift_orders_missing_paid_at(r.branch_id);
    RAISE NOTICE 'repair_shift_orders_missing_paid_at(%) -> %', r.branch_id, n;
  END LOOP;
END;
$$;

