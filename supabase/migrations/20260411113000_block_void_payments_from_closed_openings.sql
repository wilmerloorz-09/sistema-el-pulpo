CREATE OR REPLACE FUNCTION public.can_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  can_void boolean,
  error_code text,
  error_message text,
  payment_id uuid,
  order_id uuid,
  payment_shift_id uuid,
  request_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_pending_request_id uuid;
  v_has_cash_access boolean := false;
  v_payment_opening public.cash_register_openings%ROWTYPE;
BEGIN
  can_void := false;
  error_code := NULL;
  error_message := NULL;
  payment_id := p_payment_id;
  order_id := NULL;
  payment_shift_id := NULL;
  request_id := NULL;

  IF p_payment_id IS NULL THEN
    error_code := 'PAYMENT_REQUIRED';
    error_message := 'El pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_current_shift_id IS NULL THEN
    error_code := 'SHIFT_REQUIRED';
    error_message := 'No se encontro un turno activo para anular el pago';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    error_code := 'PAYMENT_NOT_FOUND';
    error_message := 'El pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_current_shift_id;
  IF NOT FOUND THEN
    error_code := 'SHIFT_NOT_FOUND';
    error_message := 'No se encontro el turno actual';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_shift.status <> 'OPEN' OR v_shift.caja_status <> 'OPEN' THEN
    error_code := 'SHIFT_CLOSED';
    error_message := 'No se puede anular un pago de un turno cerrado';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id;
  order_id := v_order.id;
  payment_shift_id := v_payment.shift_id;

  IF v_payment.shift_id IS NULL THEN
    error_code := 'PAYMENT_SHIFT_MISSING';
    error_message := 'El pago no tiene turno asociado';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_payment.shift_id <> p_current_shift_id THEN
    error_code := 'DIFFERENT_SHIFT';
    error_message := 'El pago solo puede anularse dentro del mismo turno en que fue registrado';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT cro.*
  INTO v_payment_opening
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = v_payment.shift_id
    AND cro.opened_at <= COALESCE(v_payment.created_at, now())
    AND (cro.closed_at IS NULL OR cro.closed_at >= COALESCE(v_payment.created_at, now()))
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF FOUND AND COALESCE(v_payment_opening.status, '') <> 'abierta' THEN
    error_code := 'PAYMENT_OPENING_CLOSED';
    error_message := 'El pago fue realizado en una apertura de caja ya cerrada y no puede anularse';
    RETURN NEXT;
    RETURN;
  END IF;

  IF COALESCE(lower(v_payment.status), 'active') = 'voided'
    OR v_payment.voided_at IS NOT NULL
    OR COALESCE(v_payment.notes, '') ILIKE '%VOIDED:%'
  THEN
    error_code := 'PAYMENT_ALREADY_VOIDED';
    error_message := 'El pago ya fue anulado';
    RETURN NEXT;
    RETURN;
  END IF;

  IF COALESCE(lower(v_payment.status), 'active') NOT IN ('active', 'completed', 'captured') THEN
    error_code := 'PAYMENT_STATUS_INVALID';
    error_message := 'El pago no esta en un estado anulable';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.id IS NULL THEN
    error_code := 'ORDER_NOT_FOUND';
    error_message := 'La cuenta asociada al pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    error_code := 'ORDER_STATUS_BLOCKED';
    error_message := 'La cuenta asociada esta en un estado incompatible para anular el pago';
    RETURN NEXT;
    RETURN;
  END IF;

  v_has_cash_access :=
    public.can_manage_branch_admin(p_user_id, v_shift.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_current_shift_id
        AND csu.user_id = p_user_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    );

  IF NOT v_has_cash_access THEN
    error_code := 'REQUESTER_NOT_ALLOWED';
    error_message := 'Tu usuario no tiene permisos para iniciar la anulacion del pago';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pvr.id
  INTO v_pending_request_id
  FROM public.payment_void_requests pvr
  WHERE pvr.payment_id = p_payment_id
    AND pvr.status = 'pending'
  ORDER BY pvr.created_at DESC
  LIMIT 1;

  can_void := true;
  request_id := v_pending_request_id;
  RETURN NEXT;
END;
$$;
