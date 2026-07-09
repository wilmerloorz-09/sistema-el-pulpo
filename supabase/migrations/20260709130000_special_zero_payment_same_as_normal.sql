-- Orden especial $0: mismo registro de pago que caja manual; solo cambia el disparador (autopago).

CREATE OR REPLACE FUNCTION public.autopagar_orden_especial_cero_interna(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := COALESCE(p_actor_id, auth.uid());
  v_now timestamptz := COALESCE(p_recorded_at, now());
  v_payment_id uuid;
  v_payment_method_id uuid;
  v_group_id text;
  v_existing_payment_id uuid;
  v_shift_id uuid;
  v_payments jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item record;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE
     OR v_order.special_total_manual IS NULL
     OR v_order.special_total_manual <> 0 THEN
    RETURN NULL;
  END IF;

  v_actor_id := COALESCE(v_actor_id, v_order.created_by);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el usuario del cobro';
  END IF;

  SELECT p.id
  INTO v_existing_payment_id
  FROM public.payments p
  WHERE p.order_id = p_order_id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1;

  IF v_existing_payment_id IS NOT NULL THEN
    PERFORM public.sync_order_payment_state_internal(p_order_id);
    RETURN v_existing_payment_id;
  END IF;

  SELECT pm.id
  INTO v_payment_method_id
  FROM public.payment_methods pm
  WHERE pm.branch_id = v_order.branch_id
    AND pm.is_active IS TRUE
    AND lower(trim(pm.name)) IN ('efectivo', 'cash')
  ORDER BY pm.name
  LIMIT 1;

  IF v_payment_method_id IS NULL THEN
    SELECT pm.id
    INTO v_payment_method_id
    FROM public.payment_methods pm
    WHERE pm.branch_id = v_order.branch_id
      AND pm.is_active IS TRUE
    ORDER BY pm.name
    LIMIT 1;
  END IF;

  IF v_payment_method_id IS NULL THEN
    RAISE EXCEPTION 'No hay metodo de pago activo en la sucursal';
  END IF;

  v_payment_id := gen_random_uuid();
  v_group_id := replace(v_payment_id::text, '-', '');
  v_shift_id := COALESCE(
    v_order.cash_shift_id,
    public.infer_payment_shift_id(p_order_id, v_now, false)
  );

  v_payments := jsonb_build_array(
    jsonb_build_object(
      'id', v_payment_id::text,
      'order_id', p_order_id::text,
      'payment_method_id', v_payment_method_id::text,
      'amount', '0',
      'change_amount', '0',
      'notes', format(
        'GROUP:%s|ITEMS_ANCHOR:1|TENDERED:0.00|APPLIED:0.00|SPECIAL_ORDER:1',
        v_group_id
      ),
      'created_by', v_actor_id::text
    )
  );

  FOR v_item IN
    SELECT oi.id, oi.quantity, oi.unit_price
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('DRAFT', 'CANCELLED')
      AND COALESCE(oi.quantity, 0) > 0
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'payment_id', v_payment_id::text,
        'order_item_id', v_item.id::text,
        'quantity_paid', GREATEST(0, COALESCE(v_item.quantity, 0))::text,
        'unit_price', COALESCE(v_item.unit_price, 0)::text,
        'total_amount', '0'
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'La orden especial no tiene items enviados para registrar el cobro';
  END IF;

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    created_by,
    created_at,
    status,
    shift_id
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    (p->>'change_amount')::numeric,
    p->>'notes',
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, v_now),
    'active',
    v_shift_id
  FROM jsonb_array_elements(v_payments) AS p;

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
  FROM jsonb_array_elements(v_items) AS i;

  PERFORM public.sync_order_payment_state_internal(p_order_id);

  RETURN v_payment_id;
END;
$$;

-- Misma regla de “cobrada” que otras especiales: pago activo que cubre el total manual.
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
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
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

      PERFORM public.compact_table_order_positions(v_release_table_id);
    END IF;

    RETURN QUERY SELECT p_order_id, 'KITCHEN_DISPATCHED'::text, v_order.paid_at;
    RETURN;
  END IF;

  IF v_order.status = 'PAID' THEN
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

  IF v_final_status = 'KITCHEN_DISPATCHED'
     AND v_order.order_type = 'DINE_IN'
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND (v_order.paid_at IS NOT NULL OR v_final_paid_at IS NOT NULL)
     AND v_order.table_id IS NOT NULL THEN
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
    PERFORM public.compact_table_order_positions(v_release_table_id);
  END IF;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

UPDATE public.payments p
SET notes = replace(p.notes, '|AUTOPAY_SPECIAL_ZERO:1', '')
WHERE COALESCE(p.notes, '') ILIKE '%AUTOPAY_SPECIAL_ZERO:1%';

-- Re-sincronizar órdenes especiales $0 ya pagadas para alinear estado con el pago registrado.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE COALESCE(o.is_special, false)
      AND o.special_total_manual IS NOT NULL
      AND o.special_total_manual = 0
      AND o.paid_at IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.autopagar_orden_especial_cero_interna(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autopagar_orden_especial_cero_interna(uuid, uuid, timestamptz) TO authenticated;
