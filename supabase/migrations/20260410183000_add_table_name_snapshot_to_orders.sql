-- Migration to preserve table identity when an order is unassigned due to voided payment
-- This implements the "virtual instance" requirement.

-- 1. Add the column to store the table name snapshot
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS table_name_snapshot TEXT;

-- 2. Update the approve_and_void_payment function
CREATE OR REPLACE FUNCTION public.approve_and_void_payment(
  p_payment_id uuid,
  p_request_id uuid,
  p_reason text,
  p_current_shift_id uuid,
  p_requested_by_user_id uuid,
  p_supervisor_id uuid,
  p_terminal_id text DEFAULT NULL
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
  v_table_name text;
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

  IF p_supervisor_id = p_requested_by_user_id THEN
    RAISE EXCEPTION 'La anulacion del pago debe ser autorizada por un supervisor distinto al solicitante';
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

  SELECT *
  INTO v_validation
  FROM public.can_void_payment(p_payment_id, p_current_shift_id, p_requested_by_user_id)
  LIMIT 1;

  IF COALESCE(v_validation.can_void, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_validation.error_message, 'No se puede anular el pago');
  END IF;

  IF NOT public.is_payment_void_authorizer(p_supervisor_id, p_current_shift_id, v_shift.branch_id) THEN
    RAISE EXCEPTION 'Solo un supervisor puede autorizar la anulacion del pago';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id
  FOR UPDATE;

  -- CAPTURE TABLE NAME BEFORE UNASSIGNING
  SELECT name INTO v_table_name
  FROM public.restaurant_tables
  WHERE id = v_order.table_id;

  SELECT pm.name
  INTO v_payment_method_name
  FROM public.payment_methods pm
  WHERE pm.id = v_payment.payment_method_id;

  v_reference := 'VOID-' || COALESCE(v_payment.payment_code, substr(v_payment.id::text, 1, 8)) || '-' || to_char(now(), 'YYYYMMDDHH24MISS');

  v_before := jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_payment.order_id,
    'shift_id', v_payment.shift_id,
    'status', v_payment.status,
    'amount', v_payment.amount,
    'payment_method_id', v_payment.payment_method_id,
    'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
    'voided_at', v_payment.voided_at,
    'voided_by', v_payment.voided_by,
    'void_reason', v_payment.void_reason,
    'void_requested_by_user_id', v_payment.void_requested_by_user_id,
    'void_approved_by_supervisor_id', v_payment.void_approved_by_supervisor_id,
    'void_terminal_id', v_payment.void_terminal_id,
    'void_reference', v_payment.void_reference,
    'order_status', v_order.status,
    'order_paid_at', v_order.paid_at
  );

  UPDATE public.payments
  SET
    status = 'voided',
    voided_at = now(),
    voided_by = p_supervisor_id,
    void_reason = v_reason,
    void_requested_by_user_id = p_requested_by_user_id,
    void_approved_by_supervisor_id = p_supervisor_id,
    void_terminal_id = COALESCE(v_terminal, v_request.terminal_id, void_terminal_id),
    void_reference = v_reference,
    void_request_id = p_request_id,
    notes = public.append_payment_note_marker(
      notes,
      'VOIDED:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || p_supervisor_id::text || ':' || replace(v_reason, '|', '/')
    )
  WHERE id = p_payment_id;

  UPDATE public.payment_void_requests
  SET
    status = 'approved',
    approved_by_supervisor_id = p_supervisor_id,
    approved_at = now(),
    terminal_id = COALESCE(v_terminal, terminal_id),
    reason = v_reason
  WHERE id = p_request_id;

  -- Requirement: "ya no en mesa a la cual corresponde"
  -- We unassign the table but PRESERVE IT in table_name_snapshot
  UPDATE public.orders
  SET table_id = NULL,
      table_name_snapshot = COALESCE(v_table_name, table_name_snapshot),
      is_special = true,
      updated_at = now()
  WHERE id = v_order.id;

  PERFORM public.recalculate_check_balance(v_payment.order_id);

  UPDATE public.payment_void_requests
  SET
    status = 'executed',
    executed_at = now(),
    approved_by_supervisor_id = p_supervisor_id,
    approved_at = COALESCE(approved_at, now()),
    terminal_id = COALESCE(v_terminal, terminal_id),
    reason = v_reason
  WHERE id = p_request_id;

  INSERT INTO public.cash_register_movements (
    shift_id,
    branch_id,
    movement_type,
    amount,
    reason,
    recorded_by
  )
  VALUES (
    p_current_shift_id,
    v_shift.branch_id,
    'salida',
    ROUND(v_payment.amount::numeric, 2),
    'Anulacion de pago ' || COALESCE(v_payment.payment_code, substr(v_payment.id::text, 1, 8)) || ': ' || v_reason,
    p_supervisor_id
  );

  SELECT jsonb_build_object(
    'payment_id', p.id,
    'order_id', p.order_id,
    'shift_id', p.shift_id,
    'status', p.status,
    'amount', p.amount,
    'payment_method_id', p.payment_method_id,
    'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
    'voided_at', p.voided_at,
    'voided_by', p.voided_by,
    'void_reason', p.void_reason,
    'void_requested_by_user_id', p.void_requested_by_user_id,
    'void_approved_by_supervisor_id', p.void_approved_by_supervisor_id,
    'void_terminal_id', p.void_terminal_id,
    'void_reference', p.void_reference,
    'void_request_id', p.void_request_id,
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
      'amount', v_payment.amount,
      'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
      'requested_by_user_id', p_requested_by_user_id,
      'approved_by_supervisor_id', p_supervisor_id,
      'reason', v_reason,
      'terminal_id', COALESCE(v_terminal, v_request.terminal_id),
      'before', v_before
    ),
    jsonb_build_object(
      'event_type', 'payment_voided',
      'payment_id', p_payment_id,
      'order_id', v_payment.order_id,
      'check_id', v_payment.order_id,
      'shift_id', p_current_shift_id,
      'amount', v_payment.amount,
      'payment_method', COALESCE(v_payment_method_name, 'Metodo'),
      'requested_by_user_id', p_requested_by_user_id,
      'approved_by_supervisor_id', p_supervisor_id,
      'reason', v_reason,
      'terminal_id', COALESCE(v_terminal, v_request.terminal_id),
      'created_at', now(),
      'station_id', COALESCE(v_terminal, v_request.terminal_id),
      'after', v_after
    )
  );

  payment_id := p_payment_id;
  order_id := v_payment.order_id;
  shift_id := p_current_shift_id;
  request_id := p_request_id;
  payment_status := 'voided';
  RETURN NEXT;
END;
$$;

NOTIFY pgrst, 'reload schema';
