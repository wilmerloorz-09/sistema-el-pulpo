-- Fix: "column reference order_id is ambiguous" en can_void_payment.
-- El parametro OUT order_id chocaba con la columna order_id de payments /
-- payment_void_requests. Se usa una variable local para las comparaciones.

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
  v_validation record;
  v_order_id uuid;
  v_prior_void_exists boolean := false;
BEGIN
  SELECT *
  INTO v_validation
  FROM public.can_void_payment_before_single_void_per_order_20260719(
    p_payment_id,
    p_current_shift_id,
    p_user_id
  )
  LIMIT 1;

  can_void := COALESCE(v_validation.can_void, false);
  error_code := v_validation.error_code;
  error_message := v_validation.error_message;
  payment_id := v_validation.payment_id;
  order_id := v_validation.order_id;
  payment_shift_id := v_validation.payment_shift_id;
  request_id := v_validation.request_id;

  v_order_id := v_validation.order_id;

  IF can_void IS NOT TRUE OR v_order_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Serializa anulaciones de pagos distintos pertenecientes a la misma orden.
  PERFORM 1
  FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = v_order_id
        AND p.id <> p_payment_id
        AND (
          COALESCE(lower(p.status), '') IN ('voided', 'reversed')
          OR p.voided_at IS NOT NULL
          OR COALESCE(p.notes, '') ILIKE '%VOIDED:%'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.payment_void_requests pvr
      WHERE pvr.order_id = v_order_id
        AND pvr.payment_id <> p_payment_id
        AND pvr.status = 'executed'
    )
  INTO v_prior_void_exists;

  IF v_prior_void_exists THEN
    can_void := false;
    error_code := 'ORDER_ALREADY_HAS_VOIDED_PAYMENT';
    error_message := 'Esta orden ya tuvo una anulacion de pago. Solo se permite una anulacion por orden.';
    request_id := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.can_void_payment(uuid, uuid, uuid) IS
  'Valida la anulacion y bloquea nuevos intentos cuando la orden ya tuvo un pago anulado.';

REVOKE ALL ON FUNCTION public.can_void_payment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_void_payment(uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
