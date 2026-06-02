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
      csd.id AS shift_denom_id,
      csd.denomination_id,
      csd.qty_current,
      d.label,
      d.value,
      d.image_url,
      (selection ->> 'qty')::integer AS qty
    FROM jsonb_array_elements(v_cash_refund) AS selection
    JOIN public.cash_shift_denoms csd
      ON csd.shift_id = p_current_shift_id
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
    gen_random_uuid(),
    v_payment.order_id,
    'partial',
    'ANULACION DE PAGO: ' || v_reason,
    'Pago de $' || v_payment.amount || ' (' || v_payment_method_name || ') anulado por supervisor. La orden regresa a estado enviado a caja.',
    p_supervisor_id,
    'APPLIED',
    now()
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
     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
  LOOP
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current - v_cash_row.qty
    WHERE csd.shift_id = p_current_shift_id
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