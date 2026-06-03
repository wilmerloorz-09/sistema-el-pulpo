CREATE OR REPLACE FUNCTION public.approve_and_void_payment(
  p_payment_id uuid,
  p_request_id uuid,
  p_reason text,
  p_current_shift_id uuid,
  p_requested_by_user_id uuid,
  p_supervisor_id uuid,
  p_terminal_id text DEFAULT NULL,
  p_payment_item_selections jsonb DEFAULT NULL,
  p_cash_refund_detail jsonb DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  order_id uuid,
  shift_id uuid,
  request_id uuid,
  payment_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_request public.payment_void_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_terminal text := NULLIF(btrim(COALESCE(p_terminal_id, '')), '');
  v_validation record;
  v_payment_method_name text;
  v_before jsonb;
  v_after jsonb;
  v_reference text;
  v_payment_items_count integer := 0;
  v_item_selections jsonb := '[]'::jsonb;
  v_cash_refund jsonb := '[]'::jsonb;
  v_refund_amount numeric(10,2) := 0;
  v_remaining_amount numeric(10,2) := 0;
  v_refund_cash_total numeric(10,2) := 0;
  v_replacement_payment_id uuid := NULL;
  v_item record;
  v_selected_qty numeric(10,3);
  v_remaining_qty numeric(10,3);
  v_cash_row record;
  v_sync_result record;
  v_cancellation_id uuid := gen_random_uuid();

BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'El pago no existe';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de anulacion no existe';
  END IF;

  IF p_requested_by_user_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar al solicitante';
  END IF;

  IF p_supervisor_id IS NULL THEN
    RAISE EXCEPTION 'Solo un supervisor puede autorizar la anulacion del pago';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Debes indicar un motivo para anular el pago';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe';
  END IF;

  SELECT *
  INTO v_request
  FROM public.payment_void_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud de anulacion no existe';
  END IF;

  IF v_request.payment_id <> p_payment_id THEN
    RAISE EXCEPTION 'La solicitud no corresponde al pago indicado';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud de anulacion ya fue procesada';
  END IF;

  IF v_request.requested_by_user_id <> p_requested_by_user_id THEN
    RAISE EXCEPTION 'La solicitud de anulacion no pertenece al usuario solicitante';
  END IF;

  SELECT *
  INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_current_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno actual';
  END IF;

  IF v_shift.status <> 'OPEN' OR v_shift.caja_status <> 'OPEN' THEN
    RAISE EXCEPTION 'No se puede anular un pago de un turno cerrado';
  END IF;

  -- Logica simplificada: si el supervisor es el mismo solicitante, es anulacion directa (sin despacho)
  -- Si es un supervisor diferente, validar que tenga permisos de autorizacion
  IF p_supervisor_id <> p_requested_by_user_id THEN
    IF NOT public.is_payment_void_authorizer(p_supervisor_id, p_current_shift_id, v_shift.branch_id) THEN
      RAISE EXCEPTION 'Solo un supervisor puede autorizar la anulacion del pago';
    END IF;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id
  FOR UPDATE;

  SELECT pm.name
  INTO v_payment_method_name
  FROM public.payment_methods pm
  WHERE pm.id = v_payment.payment_method_id;

  v_reference := 'VOID-' || COALESCE(v_payment.payment_code, substr(v_payment.id::text, 1, 8)) || '-' || to_char(now(), 'YYYYMMDDHH24MISS');

  SELECT COUNT(*)
  INTO v_payment_items_count
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  v_item_selections := COALESCE(v_request.payment_item_selections, p_payment_item_selections, '[]'::jsonb);
  v_cash_refund := COALESCE(v_request.cash_refund_detail, p_cash_refund_detail, '[]'::jsonb);

  IF v_payment_items_count = 0 THEN
    v_refund_amount := ROUND(COALESCE(v_request.refund_amount, v_payment.amount, 0)::numeric, 2);
    v_remaining_amount := 0;
  ELSE
    FOR v_item IN
      SELECT
        pi.id,
        pi.order_item_id,
        pi.quantity_paid,
        pi.unit_price,
        pi.total_amount
      FROM public.payment_items pi
      WHERE pi.payment_id = p_payment_id
      ORDER BY pi.created_at, pi.id
    LOOP
      IF COALESCE(jsonb_array_length(v_item_selections), 0) = 0 THEN
        v_selected_qty := v_item.quantity_paid;
      ELSE
        SELECT COALESCE(SUM((selection ->> 'quantity')::numeric), 0)
        INTO v_selected_qty
        FROM jsonb_array_elements(v_item_selections) AS selection
        WHERE (selection ->> 'payment_item_id')::uuid = v_item.id;
      END IF;

      IF v_selected_qty < 0 OR v_selected_qty > v_item.quantity_paid THEN
        RAISE EXCEPTION 'La cantidad seleccionada para anular no es valida';
      END IF;

      v_remaining_qty := v_item.quantity_paid - v_selected_qty;
      v_refund_amount := ROUND(v_refund_amount + (v_selected_qty * v_item.unit_price)::numeric, 2);
      v_remaining_amount := ROUND(v_remaining_amount + (v_remaining_qty * v_item.unit_price)::numeric, 2);
    END LOOP;
  END IF;

  IF v_refund_amount <= 0 THEN
    RAISE EXCEPTION 'No hay valor para devolver en esta anulacion';
  END IF;

  FOR v_cash_row IN
    SELECT
      csd.id AS shrink_denom_id,
      csd.denomination_id,
      csd.qty_current,
      d.label,
      d.value,
      d.image_url,
      (selection ->> 'qty')::integer AS qty
    FROM jsonb_array_elements(v_cash_refund) AS selection
    JOIN public.cash_shift_denoms csd
      ON csd.shift_id = p_current_shift_id
     AND csd.cashier_id = p_requested_by_user_id
     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
    FOR UPDATE OF csd
  LOOP
    v_refund_cash_total := ROUND(v_refund_cash_total + (v_cash_row.qty * v_cash_row.value)::numeric, 2);

    IF v_cash_row.qty_current < v_cash_row.qty THEN
      RAISE EXCEPTION 'La caja no tiene suficiente % para devolver este pago', v_cash_row.label;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_cash_refund) > 0 AND ABS(v_refund_cash_total - v_refund_amount) > 0.01 THEN
    RAISE EXCEPTION 'La devolucion en efectivo no coincide con el valor a anular';
  END IF;

  v_before := jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_payment.order_id,
    'shift_id', v_payment.shift_id,
    'status', v_payment.status,
    'amount', v_payment.amount,
    'payment_method_id', v_payment.payment_method_id,
    'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
    'refund_amount', v_refund_amount,
    'remaining_amount', v_remaining_amount,
    'payment_item_selections', v_item_selections,
    'cash_refund_detail', v_cash_refund
  );

  UPDATE public.payment_void_requests pvr
  SET
    status = 'approved',
    approved_by_supervisor_id = p_supervisor_id,
    approved_at = now(),
    terminal_id = COALESCE(v_terminal, pvr.terminal_id),
    reason = v_reason,
    payment_item_selections = CASE
      WHEN COALESCE(jsonb_array_length(v_item_selections), 0) > 0 THEN v_item_selections
      ELSE pvr.payment_item_selections
    END,
    refund_amount = v_refund_amount,
    cash_refund_detail = CASE
      WHEN COALESCE(jsonb_array_length(v_cash_refund), 0) > 0 THEN v_cash_refund
      ELSE pvr.cash_refund_detail
    END
  WHERE pvr.id = p_request_id;

  -- Registrar en el historial de cancelaciones/anulaciones para auditoria
  INSERT INTO public.order_cancellations (
    id,
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  )
  VALUES (
    v_cancellation_id,
    v_payment.order_id,
    'partial',
    'ANULACION DE PAGO: ' || v_reason,
    'Pago de $' || v_payment.amount || ' (' || v_payment_method_name || ') anulado por supervisor. La orden regresa a estado enviado a caja.',
    p_supervisor_id,
    'APPLIED',
    now()
  );

  IF v_payment_items_count > 0 AND v_remaining_amount > 0.009 THEN
    INSERT INTO public.payments (
      id,
      order_id,
      payment_method_id,
      shift_id,
      amount,
      status,
      notes,
      created_by,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      v_payment.order_id,
      v_payment.payment_method_id,
      v_payment.shift_id,
      ROUND(v_remaining_amount::numeric, 2),
      'active',
      'REPLACEMENT_FOR_VOID:' || v_payment.id::text,
      v_payment.created_by,
      now()
    )
    RETURNING id INTO v_replacement_payment_id;

    FOR v_item IN
      SELECT
        pi.id,
        pi.order_item_id,
        pi.quantity_paid,
        pi.unit_price
      FROM public.payment_items pi
      WHERE pi.payment_id = p_payment_id
      ORDER BY pi.created_at, pi.id
    LOOP
      SELECT COALESCE(SUM((selection ->> 'quantity')::numeric), 0)
      INTO v_selected_qty
      FROM jsonb_array_elements(v_item_selections) AS selection
      WHERE (selection ->> 'payment_item_id')::uuid = v_item.id;

      v_remaining_qty := v_item.quantity_paid - v_selected_qty;

      IF v_remaining_qty > 0 THEN
        INSERT INTO public.payment_items (
          id,
          payment_id,
          order_item_id,
          quantity_paid,
          unit_price,
          total_amount,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          v_replacement_payment_id,
          v_item.order_item_id,
          v_remaining_qty,
          v_item.unit_price,
          ROUND((v_remaining_qty * v_item.unit_price)::numeric, 2),
          now()
        );
      END IF;

      -- Registrar en order_item_cancellations si hubo cantidad anulada
      IF v_selected_qty > 0 THEN
        INSERT INTO public.order_item_cancellations (
          id,
          order_cancellation_id,
          order_id,
          order_item_id,
          quantity_cancelled,
          unit_price,
          total_amount,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          v_cancellation_id,
          v_payment.order_id,
          v_item.order_item_id,
          v_selected_qty::integer,
          v_item.unit_price,
          ROUND((v_selected_qty * v_item.unit_price)::numeric, 2),
          now()
        );
      END IF;

      -- Update or delete the original payment items to reflect only the voided items/quantities
      IF v_selected_qty = 0 THEN
        DELETE FROM public.payment_items WHERE id = v_item.id;
      ELSIF v_selected_qty < v_item.quantity_paid THEN
        UPDATE public.payment_items
        SET quantity_paid = v_selected_qty,
            total_amount = ROUND((v_selected_qty * v_item.unit_price)::numeric, 2)
        WHERE id = v_item.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payments p
  SET
    status = 'voided',
    amount = v_refund_amount,
    voided_at = now(),
    voided_by = p_supervisor_id,
    void_reason = v_reason,
    void_requested_by_user_id = p_requested_by_user_id,
    void_approved_by_supervisor_id = p_supervisor_id,
    void_terminal_id = COALESCE(v_terminal, v_request.terminal_id, p.void_terminal_id),
    void_reference = v_reference,
    void_request_id = p_request_id,
    notes = public.append_payment_note_marker(
      p.notes,
      'VOIDED:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || p_supervisor_id::text || ':' || replace(v_reason, '|', '/')
    )
  WHERE p.id = p_payment_id;

  UPDATE public.payment_void_requests pvr
  SET
    status = 'executed',
    executed_at = now(),
    approved_by_supervisor_id = p_supervisor_id,
    approved_at = COALESCE(pvr.approved_at, now()),
    terminal_id = COALESCE(v_terminal, pvr.terminal_id),
    reason = v_reason,
    replacement_payment_id = v_replacement_payment_id,
    payment_item_selections = CASE
      WHEN COALESCE(jsonb_array_length(v_item_selections), 0) > 0 THEN v_item_selections
      ELSE pvr.payment_item_selections
    END,
    refund_amount = v_refund_amount,
    cash_refund_detail = CASE
      WHEN COALESCE(jsonb_array_length(v_cash_refund), 0) > 0 THEN v_cash_refund
      ELSE pvr.cash_refund_detail
    END
  WHERE pvr.id = p_request_id;

  -- Si la orden no tiene ningun pago activo (todos fueron anulados), resetear paid_at
  -- para que la orden vuelva a aparecer en Caja pendiente de pago y salga de Despacho
  UPDATE public.orders o
  SET 
    paid_at = NULL,
    notes = public.append_payment_note_marker(
      o.notes,
      'VOIDED_PAYMENT:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || p_supervisor_id::text || ':' || replace(v_reason, '|', '/')
    )
  WHERE o.id = v_payment.order_id
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p2
      WHERE p2.order_id = v_payment.order_id
        AND p2.status <> 'voided'
        AND p2.id <> p_payment_id
    );



  FOR v_cash_row IN
    SELECT
      csd.denomination_id,
      d.label,
      d.value,
      (selection ->> 'qty')::integer AS qty
    FROM jsonb_array_elements(v_cash_refund) AS selection
    JOIN public.cash_shift_denoms csd
      ON csd.shift_id = p_current_shift_id
     AND csd.cashier_id = p_requested_by_user_id
     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
  LOOP
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current - v_cash_row.qty
    WHERE csd.shift_id = p_current_shift_id
      AND csd.cashier_id = p_requested_by_user_id
      AND csd.denomination_id = v_cash_row.denomination_id;

    INSERT INTO public.cash_movements (
      id,
      shift_id,
      movement_type,
      denomination_id,
      qty_delta,
      payment_id,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      p_current_shift_id,
      'CHANGE_OUT',
      v_cash_row.denomination_id,
      v_cash_row.qty,
      p_payment_id,
      now()
    );
  END LOOP;

  INSERT INTO public.cash_register_movements (
    shift_id,
    branch_id,
    movement_type,
    amount,
    reason,
    movement_detail,
    recorded_by
  )
  VALUES (
    p_current_shift_id,
    v_shift.branch_id,
    'salida',
    ROUND(v_refund_amount::numeric, 2),
    'Anulacion de pago ' || COALESCE(v_payment.payment_code, substr(v_payment.id::text, 1, 8)) || ': ' || v_reason,
    jsonb_build_object(
      'kind', 'cash_refund',
      'refund', v_cash_refund,
      'totals', jsonb_build_object('refund', ROUND(v_refund_amount::numeric, 2))
    ),
    p_supervisor_id
  );

  SELECT *
  INTO v_sync_result
  FROM public.recalculate_check_balance(v_payment.order_id)
  LIMIT 1;

  SELECT jsonb_build_object(
    'payment_id', p.id,
    'order_id', p.order_id,
    'shift_id', p.shift_id,
    'status', p.status,
    'amount', p.amount,
    'refund_amount', v_refund_amount,
    'replacement_payment_id', v_replacement_payment_id,
    'order_status', o.status,
    'order_paid_at', o.paid_at
  )
  INTO v_after
  FROM public.payments p
  JOIN public.orders o
    ON o.id = p.order_id
  WHERE p.id = p_payment_id;

  INSERT INTO public.audit_log (
    user_id,
    action,
    entity,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    p_supervisor_id,
    'payment_voided',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'event_type', 'payment_voided',
      'payment_id', p_payment_id,
      'order_id', v_payment.order_id,
      'check_id', v_payment.order_id,
      'shift_id', p_current_shift_id,
      'refund_amount', v_refund_amount,
      'remaining_amount', v_remaining_amount,
      'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
      'requested_by_user_id', p_requested_by_user_id,
      'approved_by_supervisor_id', p_supervisor_id,
      'reason', v_reason,
      'terminal_id', COALESCE(v_terminal, v_request.terminal_id),
      'payment_item_selections', v_item_selections,
      'cash_refund_detail', v_cash_refund,
      'before', v_before
    ),
    jsonb_build_object(
      'event_type', 'payment_voided',
      'payment_id', p_payment_id,
      'order_id', v_payment.order_id,
      'check_id', v_payment.order_id,
      'shift_id', p_current_shift_id,
      'refund_amount', v_refund_amount,
      'remaining_amount', v_remaining_amount,
      'replacement_payment_id', v_replacement_payment_id,
      'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
      'requested_by_user_id', p_requested_by_user_id,
      'approved_by_supervisor_id', p_supervisor_id,
      'reason', v_reason,
      'terminal_id', COALESCE(v_terminal, v_request.terminal_id),
      'payment_item_selections', v_item_selections,
      'cash_refund_detail', v_cash_refund,
      'created_at', now(),
      'after', v_after
    )
  );

  payment_id := p_payment_id;
  order_id := v_payment.order_id;
  shift_id := p_current_shift_id;
  request_id := p_request_id;
  payment_status := CASE WHEN v_replacement_payment_id IS NULL THEN 'voided' ELSE 'partially_voided' END;
  RETURN NEXT;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_successor_order_after_payment_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_order public.orders%ROWTYPE;
  v_new_order_id uuid := gen_random_uuid();
  v_new_order_number integer;
  v_new_order_code text;
  v_table_name text;
  v_old_item record;
  v_new_item_id uuid;
  v_voided_qty integer;
  v_remaining_qty integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(lower(NEW.status), '') <> 'voided'
    OR COALESCE(lower(OLD.status), '') = 'voided'
    OR NEW.voided_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_old_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_old_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RETURN NEW;
  END IF;

  IF v_old_order.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(rt.name, v_old_order.table_name_snapshot)
  INTO v_table_name
  FROM public.restaurant_tables rt
  WHERE rt.id = v_old_order.table_id;

  -- Release original order_code to avoid unique constraint conflict
  UPDATE public.orders
  SET order_code = order_code || '-V' || substr(NEW.id::text, 1, 4)
  WHERE id = v_old_order.id;

  v_new_order_number := v_old_order.order_number;
  v_new_order_code := v_old_order.order_code;

  INSERT INTO public.orders (
    id,
    branch_id,
    order_type,
    menu_scope,
    table_id,
    split_id,
    table_order_position,
    status,
    order_number,
    order_code,
    created_by,
    created_at,
    updated_at,
    sent_to_kitchen_at,
    ready_at,
    dispatched_at,
    paid_at,
    is_special,
    special_total_manual,
    special_marked_at,
    special_marked_by,
    special_origin_table_id,
    special_origin_split_id,
    is_tray_order,
    table_name_snapshot,
    notes
  )
  VALUES (
    v_new_order_id,
    v_old_order.branch_id,
    v_old_order.order_type,
    v_old_order.menu_scope,
    v_old_order.table_id,
    v_old_order.split_id,
    v_old_order.table_order_position,
    CASE
      WHEN v_old_order.status IN ('DRAFT', 'CANCELLED', 'PAID') THEN 'KITCHEN_DISPATCHED'::public.order_status
      ELSE v_old_order.status
    END,
    v_new_order_number,
    v_new_order_code,
    v_old_order.created_by,
    now(),
    now(),
    COALESCE(v_old_order.sent_to_kitchen_at, now()),
    COALESCE(v_old_order.ready_at, now()),
    COALESCE(v_old_order.dispatched_at, now()),
    NULL,
    v_old_order.is_special,
    v_old_order.special_total_manual,
    v_old_order.special_marked_at,
    v_old_order.special_marked_by,
    v_old_order.special_origin_table_id,
    v_old_order.special_origin_split_id,
    v_old_order.is_tray_order,
    COALESCE(v_table_name, v_old_order.table_name_snapshot),
    public.append_payment_note_marker(v_old_order.notes, 'SUCCESSOR_OF_VOIDED_ORDER:' || v_old_order.id::text)
  );

  FOR v_old_item IN
    SELECT *
    FROM public.order_items oi
    WHERE oi.order_id = v_old_order.id
      AND COALESCE(oi.status::text, '') <> 'CANCELLED'
    ORDER BY oi.created_at, oi.id
  LOOP
    -- Obtener la cantidad total anulada/devuelta de este item en la orden original (historial)
    SELECT COALESCE(SUM(oic.quantity_cancelled), 0)::integer
    INTO v_voided_qty
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id = v_old_item.id
      AND oc.order_id = v_old_order.id
      AND oc.status = 'APPLIED';

    v_remaining_qty := v_old_item.quantity - v_voided_qty;

    IF v_remaining_qty <= 0 THEN
      CONTINUE;
    END IF;

    v_new_item_id := gen_random_uuid();

    INSERT INTO public.order_items (
      id,
      order_id,
      product_id,
      description_snapshot,
      item_note,
      quantity,
      unit_price,
      total,
      status,
      created_at,
      dispatched_at,
      paid_at,
      cancelled_at,
      cancelled_by,
      cancellation_reason,
      cancelled_from_status,
      sent_to_kitchen_at,
      ready_at,
      tray_item_type,
      tray_container_cost
    )
    VALUES (
      v_new_item_id,
      v_new_order_id,
      v_old_item.product_id,
      v_old_item.description_snapshot,
      v_old_item.item_note,
      v_remaining_qty,
      v_old_item.unit_price,
      ROUND((v_remaining_qty * v_old_item.unit_price)::numeric, 2),
      CASE
        WHEN NULLIF(btrim(v_old_item.status::text), '') IS NULL THEN 'SENT'
        WHEN v_old_item.status::text = 'DRAFT' THEN 'SENT'
        WHEN v_old_item.status::text IN ('SENT', 'DISPATCHED', 'PAID', 'CANCELLED') THEN v_old_item.status::text
        ELSE 'SENT'
      END::public.order_item_status,
      now(),
      v_old_item.dispatched_at,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      COALESCE(v_old_item.sent_to_kitchen_at, now()),
      COALESCE(v_old_item.ready_at, now()),
      v_old_item.tray_item_type,
      v_old_item.tray_container_cost
    );

    INSERT INTO public.order_item_modifiers (
      id,
      order_item_id,
      modifier_id
    )
    SELECT
      gen_random_uuid(),
      v_new_item_id,
      oim.modifier_id
    FROM public.order_item_modifiers oim
    WHERE oim.order_item_id = v_old_item.id
    ON CONFLICT DO NOTHING;

    UPDATE public.payment_items pi
    SET order_item_id = v_new_item_id
    WHERE pi.order_item_id = v_old_item.id
      AND EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.id = pi.payment_id
          AND p.order_id = v_old_order.id
          AND p.id <> NEW.id
          AND COALESCE(lower(p.status), 'active') <> 'voided'
          AND p.voided_at IS NULL
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      );
  END LOOP;

  UPDATE public.payments p
  SET order_id = v_new_order_id
  WHERE p.order_id = v_old_order.id
    AND p.id <> NEW.id
    AND COALESCE(lower(p.status), 'active') <> 'voided'
    AND p.voided_at IS NULL
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%';

  UPDATE public.orders o
  SET
    table_name_snapshot = COALESCE(v_table_name, o.table_name_snapshot),
    table_id = NULL,
    split_id = NULL,
    table_order_position = NULL,
    status = 'CANCELLED',
    paid_at = NULL,
    cancelled_at = COALESCE(o.cancelled_at, now()),
    cancelled_by = COALESCE(o.cancelled_by, NEW.voided_by),
    cancelled_from_status = COALESCE(o.cancelled_from_status, v_old_order.status::text),
    cancellation_reason = COALESCE(o.cancellation_reason, 'Pago anulado; orden conservada como historial'),
    notes = public.append_payment_note_marker(
      public.append_payment_note_marker(o.notes, 'VOID_SUCCESSOR_ORDER:' || v_new_order_id::text),
      'VOIDED_PAYMENT_HISTORICAL:' || NEW.id::text
    ),
    updated_at = now()
  WHERE o.id = v_old_order.id;

  PERFORM public.compact_table_order_positions(v_old_order.table_id);

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_create_successor_order_after_payment_void ON public.payments;
CREATE TRIGGER trg_create_successor_order_after_payment_void
AFTER UPDATE OF status, voided_at ON public.payments
FOR EACH ROW
WHEN (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.create_successor_order_after_payment_void();

CREATE OR REPLACE FUNCTION public.request_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_reason text,
  p_terminal_id text DEFAULT NULL,
  p_payment_item_selections jsonb DEFAULT NULL,
  p_cash_refund_detail jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_validation record;
  v_payment public.payments%ROWTYPE;
  v_request_id uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_refund_amount numeric(10,2) := 0;
  v_refund_cash_total numeric(10,2) := 0;
  v_payment_items_count integer := 0;
  v_resolved_item_selections jsonb := '[]'::jsonb;
  v_resolved_cash_detail jsonb := '[]'::jsonb;
  v_item_row record;
  v_requested_qty numeric(10,3);
  v_cash_row record;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Debes indicar un motivo para anular el pago';
  END IF;

  SELECT *
  INTO v_validation
  FROM public.can_void_payment(p_payment_id, p_current_shift_id, v_actor_id)
  LIMIT 1;

  IF COALESCE(v_validation.can_void, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_validation.error_message, 'No se puede anular el pago');
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id;

  SELECT COUNT(*)
  INTO v_payment_items_count
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  IF v_payment_items_count > 0 THEN
    IF COALESCE(jsonb_array_length(COALESCE(p_payment_item_selections, '[]'::jsonb)), 0) = 0 THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'payment_item_id', pi.id,
            'quantity', pi.quantity_paid
          )
          ORDER BY pi.created_at, pi.id
        ),
        '[]'::jsonb
      )
      INTO v_resolved_item_selections
      FROM public.payment_items pi
      WHERE pi.payment_id = p_payment_id;
    ELSE
      FOR v_item_row IN
        SELECT
          pi.id,
          pi.quantity_paid,
          pi.unit_price
        FROM public.payment_items pi
        JOIN jsonb_array_elements(p_payment_item_selections) AS selection
          ON (selection ->> 'payment_item_id')::uuid = pi.id
        WHERE pi.payment_id = p_payment_id
      LOOP
        SELECT COALESCE(SUM((selection ->> 'quantity')::numeric), 0)
        INTO v_requested_qty
        FROM jsonb_array_elements(p_payment_item_selections) AS selection
        WHERE (selection ->> 'payment_item_id')::uuid = v_item_row.id;

        IF v_requested_qty <= 0 THEN
          CONTINUE;
        END IF;

        IF v_requested_qty > v_item_row.quantity_paid THEN
          RAISE EXCEPTION 'No puedes anular una cantidad mayor a la pagada';
        END IF;

        v_refund_amount := ROUND(v_refund_amount + (v_requested_qty * v_item_row.unit_price)::numeric, 2);
        v_resolved_item_selections := v_resolved_item_selections || jsonb_build_array(
          jsonb_build_object(
            'payment_item_id', v_item_row.id,
            'quantity', v_requested_qty
          )
        );
      END LOOP;

      IF COALESCE(jsonb_array_length(v_resolved_item_selections), 0) = 0 THEN
        RAISE EXCEPTION 'Debes seleccionar al menos una cantidad para anular';
      END IF;
    END IF;

    IF v_refund_amount <= 0 THEN
      SELECT ROUND(COALESCE(SUM(pi.total_amount), 0)::numeric, 2)
      INTO v_refund_amount
      FROM public.payment_items pi
      WHERE pi.payment_id = p_payment_id;
    END IF;
  ELSE
    v_resolved_item_selections := NULL;
    v_refund_amount := ROUND(COALESCE(v_payment.amount, 0)::numeric, 2);
  END IF;

  IF v_refund_amount <= 0 THEN
    RAISE EXCEPTION 'No se pudo calcular el valor a devolver';
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_cash_refund_detail, '[]'::jsonb)), 0) > 0 THEN
    FOR v_cash_row IN
      SELECT
        csd.denomination_id,
        d.label,
        d.value,
        d.image_url,
        (selection ->> 'qty')::integer AS qty
      FROM jsonb_array_elements(p_cash_refund_detail) AS selection
      JOIN public.cash_shift_denoms csd
        ON csd.shift_id = p_current_shift_id
       AND csd.cashier_id = v_actor_id
       AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
      JOIN public.denominations d
        ON d.id = csd.denomination_id
      WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
    LOOP
      v_refund_cash_total := ROUND(v_refund_cash_total + (v_cash_row.qty * v_cash_row.value)::numeric, 2);
      v_resolved_cash_detail := v_resolved_cash_detail || jsonb_build_array(
        jsonb_build_object(
          'denomination_id', v_cash_row.denomination_id,
          'label', v_cash_row.label,
          'value', v_cash_row.value,
          'image_url', v_cash_row.image_url,
          'qty', v_cash_row.qty
        )
      );
    END LOOP;
  END IF;

  IF COALESCE(jsonb_array_length(v_resolved_cash_detail), 0) > 0
    AND ABS(v_refund_cash_total - v_refund_amount) > 0.01
  THEN
    RAISE EXCEPTION 'La devolucion en efectivo no coincide con el valor a anular';
  END IF;

  INSERT INTO public.payment_void_requests (
    payment_id,
    order_id,
    shift_id,
    requested_by_user_id,
    reason,
    terminal_id,
    status,
    payment_item_selections,
    refund_amount,
    cash_refund_detail
  )
  VALUES (
    v_payment.id,
    v_payment.order_id,
    p_current_shift_id,
    v_actor_id,
    v_reason,
    NULLIF(btrim(COALESCE(p_terminal_id, '')), ''),
    'pending',
    v_resolved_item_selections,
    v_refund_amount,
    CASE
      WHEN COALESCE(jsonb_array_length(v_resolved_cash_detail), 0) > 0 THEN v_resolved_cash_detail
      ELSE NULL
    END
  )
  ON CONFLICT (payment_id)
  WHERE status = 'pending'
  DO UPDATE
  SET
    requested_by_user_id = EXCLUDED.requested_by_user_id,
    reason = EXCLUDED.reason,
    terminal_id = EXCLUDED.terminal_id,
    payment_item_selections = EXCLUDED.payment_item_selections,
    refund_amount = EXCLUDED.refund_amount,
    cash_refund_detail = EXCLUDED.cash_refund_detail,
    updated_at = now()
  RETURNING id
  INTO v_request_id;

  UPDATE public.payments
  SET
    void_requested_by_user_id = v_actor_id,
    void_reason = v_reason,
    void_terminal_id = COALESCE(NULLIF(btrim(COALESCE(p_terminal_id, '')), ''), void_terminal_id),
    void_request_id = v_request_id,
    notes = public.append_payment_note_marker(
      notes,
      'VOID_REQUESTED:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || v_actor_id::text || ':' || replace(v_reason, '|', '/')
    )
  WHERE id = p_payment_id;

  INSERT INTO public.audit_log (
    user_id,
    action,
    entity,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    v_actor_id,
    'payment_void_requested',
    'payment',
    p_payment_id::text,
    NULL,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'shift_id', p_current_shift_id,
      'reason', v_reason,
      'terminal_id', NULLIF(btrim(COALESCE(p_terminal_id, '')), ''),
      'requested_by_user_id', v_actor_id,
      'request_id', v_request_id,
      'refund_amount', v_refund_amount,
      'payment_item_selections', v_resolved_item_selections,
      'cash_refund_detail', CASE
        WHEN COALESCE(jsonb_array_length(v_resolved_cash_detail), 0) > 0 THEN v_resolved_cash_detail
        ELSE NULL
      END,
      'created_at', now()
    )
  );

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');

