DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_void_request_status'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.payment_void_request_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'executed'
    );
  END IF;
END
$$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS voided_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason text NULL,
  ADD COLUMN IF NOT EXISTS void_requested_by_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_approved_by_supervisor_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_terminal_id text NULL,
  ADD COLUMN IF NOT EXISTS void_reference text NULL;

UPDATE public.payments
SET status = CASE
  WHEN COALESCE(notes, '') ILIKE '%VOIDED:%' OR voided_at IS NOT NULL THEN 'voided'
  WHEN COALESCE(status, '') IN ('', 'completed') THEN 'active'
  ELSE status
END;

CREATE TABLE IF NOT EXISTS public.payment_void_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by_supervisor_id uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  terminal_id text NULL,
  status public.payment_void_request_status NOT NULL DEFAULT 'pending',
  approved_at timestamptz NULL,
  executed_at timestamptz NULL,
  rejected_at timestamptz NULL,
  rejection_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS void_request_id uuid NULL REFERENCES public.payment_void_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_void_requests_payment_id
  ON public.payment_void_requests(payment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_void_requests_one_pending_per_payment
  ON public.payment_void_requests(payment_id)
  WHERE status = 'pending';

ALTER TABLE public.payment_void_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read void requests from active branch" ON public.payment_void_requests;
CREATE POLICY "Users can read void requests from active branch"
ON public.payment_void_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.profiles p
      ON p.id = auth.uid()
    WHERE o.id = payment_void_requests.order_id
      AND o.branch_id = p.active_branch_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR EXISTS (
          SELECT 1
          FROM public.cash_shift_users csu
          WHERE csu.shift_id = payment_void_requests.shift_id
            AND csu.user_id = auth.uid()
            AND csu.is_enabled = true
            AND csu.can_use_caja = true
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can insert own void requests" ON public.payment_void_requests;
CREATE POLICY "Users can insert own void requests"
ON public.payment_void_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Users can update own pending void requests" ON public.payment_void_requests;
CREATE POLICY "Users can update own pending void requests"
ON public.payment_void_requests
FOR UPDATE
TO authenticated
USING (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
)
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
);

CREATE OR REPLACE FUNCTION public.touch_payment_void_request_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_void_requests_updated_at ON public.payment_void_requests;
CREATE TRIGGER trg_payment_void_requests_updated_at
BEFORE UPDATE ON public.payment_void_requests
FOR EACH ROW
EXECUTE FUNCTION public.touch_payment_void_request_updated_at();

CREATE OR REPLACE FUNCTION public.append_payment_note_marker(
  p_existing_notes text,
  p_marker text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_current text := btrim(COALESCE(p_existing_notes, ''));
BEGIN
  IF p_marker IS NULL OR btrim(p_marker) = '' THEN
    RETURN v_current;
  END IF;

  IF v_current = '' THEN
    RETURN p_marker;
  END IF;

  IF position(p_marker in v_current) > 0 THEN
    RETURN v_current;
  END IF;

  RETURN v_current || '|' || p_marker;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_payment_void_authorizer(
  p_user_id uuid,
  p_shift_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    public.can_manage_branch_admin(p_user_id, p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_user_id
        AND csu.is_enabled = true
        AND COALESCE(csu.is_supervisor, false) = true
    );
END;
$$;

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

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    error_code := 'PAYMENT_NOT_FOUND';
    error_message := 'El pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_current_shift_id;

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

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id;

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

CREATE OR REPLACE FUNCTION public.request_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_reason text,
  p_terminal_id text DEFAULT NULL
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

  INSERT INTO public.payment_void_requests (
    payment_id,
    order_id,
    shift_id,
    requested_by_user_id,
    reason,
    terminal_id,
    status
  )
  VALUES (
    v_payment.id,
    v_payment.order_id,
    p_current_shift_id,
    v_actor_id,
    v_reason,
    NULLIF(btrim(COALESCE(p_terminal_id, '')), ''),
    'pending'
  )
  ON CONFLICT (payment_id)
  WHERE status = 'pending'
  DO UPDATE
  SET
    requested_by_user_id = EXCLUDED.requested_by_user_id,
    reason = EXCLUDED.reason,
    terminal_id = EXCLUDED.terminal_id,
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
      'created_at', now()
    )
  );

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_check_balance(
  p_check_id uuid
)
RETURNS TABLE (
  order_id uuid,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.sync_order_payment_state_internal(p_check_id);
END;
$$;

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

REVOKE ALL ON FUNCTION public.is_payment_void_authorizer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payment_void_authorizer(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_void_payment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_void_payment(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.request_void_payment(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_void_payment(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.recalculate_check_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_check_balance(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_and_void_payment(uuid, uuid, text, uuid, uuid, uuid, text) FROM PUBLIC;
