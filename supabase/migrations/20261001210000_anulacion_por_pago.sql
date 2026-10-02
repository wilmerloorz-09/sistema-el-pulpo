-- Anulación por pago: cada pago puede anularse una vez (lo valida la función base con
-- PAYMENT_ALREADY_VOIDED). Se elimina la restricción de una sola anulación por orden.

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
AS $function$
DECLARE
  v_validation record;
  v_order_id uuid;
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

  RETURN NEXT;
END;
$function$;

NOTIFY pgrst, 'reload schema';
