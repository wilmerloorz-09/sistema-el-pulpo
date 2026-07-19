-- Permite elegir cómo devolver un pago por transferencia:
-- CASH afecta denominaciones y caja; TRANSFER no genera salida de efectivo.

ALTER TABLE public.payment_void_requests
  ADD COLUMN IF NOT EXISTS refund_method text NULL;

ALTER TABLE public.payment_void_requests
  DROP CONSTRAINT IF EXISTS payment_void_requests_refund_method_check;

ALTER TABLE public.payment_void_requests
  ADD CONSTRAINT payment_void_requests_refund_method_check
  CHECK (refund_method IS NULL OR refund_method IN ('CASH', 'TRANSFER'));

COMMENT ON COLUMN public.payment_void_requests.refund_method IS
  'Forma de devolución: CASH descuenta caja; TRANSFER registra devolución bancaria sin afectar efectivo.';

-- Conservar la implementación operativa actual y envolverla con la nueva regla.
ALTER FUNCTION public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb
)
RENAME TO approve_and_void_payment_legacy_refund_method;

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
  v_refund_method text;
  v_payment_method_name text;
  v_payment_code text;
  v_refund_amount numeric(10,2);
  v_cash_detail jsonb;
  v_result record;
BEGIN
  SELECT
    COALESCE(
      pvr.refund_method,
      CASE
        WHEN lower(COALESCE(pm.name, '')) LIKE '%transfer%' THEN 'TRANSFER'
        ELSE 'CASH'
      END
    ),
    pm.name,
    p.payment_code,
    pvr.refund_amount,
    COALESCE(pvr.cash_refund_detail, p_cash_refund_detail, '[]'::jsonb)
  INTO
    v_refund_method,
    v_payment_method_name,
    v_payment_code,
    v_refund_amount,
    v_cash_detail
  FROM public.payment_void_requests pvr
  JOIN public.payments p ON p.id = pvr.payment_id
  LEFT JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE pvr.id = p_request_id
    AND pvr.payment_id = p_payment_id
  FOR UPDATE OF pvr;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud de anulacion no existe';
  END IF;

  v_refund_method := upper(COALESCE(v_refund_method, ''));

  IF v_refund_method NOT IN ('CASH', 'TRANSFER') THEN
    RAISE EXCEPTION 'La forma de devolucion no es valida';
  END IF;

  IF v_refund_method = 'TRANSFER'
     AND lower(COALESCE(v_payment_method_name, '')) NOT LIKE '%transfer%' THEN
    RAISE EXCEPTION 'La devolucion por transferencia solo aplica a pagos por transferencia';
  END IF;

  IF v_refund_method = 'TRANSFER'
     AND COALESCE(jsonb_array_length(v_cash_detail), 0) > 0 THEN
    RAISE EXCEPTION 'Una devolucion por transferencia no puede descontar denominaciones de caja';
  END IF;

  IF v_refund_method = 'CASH'
     AND COALESCE(jsonb_array_length(v_cash_detail), 0) = 0 THEN
    RAISE EXCEPTION 'Debes cuadrar las denominaciones para devolver el dinero en efectivo';
  END IF;

  UPDATE public.payment_void_requests
  SET refund_method = v_refund_method,
      cash_refund_detail = CASE
        WHEN v_refund_method = 'TRANSFER' THEN NULL
        ELSE cash_refund_detail
      END,
      updated_at = now()
  WHERE id = p_request_id;

  FOR v_result IN
    SELECT *
    FROM public.approve_and_void_payment_legacy_refund_method(
      p_payment_id,
      p_request_id,
      p_reason,
      p_current_shift_id,
      p_requested_by_user_id,
      p_supervisor_id,
      p_terminal_id,
      p_payment_item_selections,
      CASE WHEN v_refund_method = 'CASH' THEN v_cash_detail ELSE '[]'::jsonb END
    )
  LOOP
    payment_id := v_result.payment_id;
    order_id := v_result.order_id;
    shift_id := v_result.shift_id;
    request_id := v_result.request_id;
    payment_status := v_result.payment_status;
    RETURN NEXT;
  END LOOP;

  IF v_refund_method = 'TRANSFER' THEN
    -- La función histórica registra siempre una salida global aunque no haya
    -- denominaciones. Retirarla dentro de la misma transacción evita afectar caja.
    DELETE FROM public.cash_register_movements crm
    WHERE crm.shift_id = p_current_shift_id
      AND crm.recorded_by = p_supervisor_id
      AND crm.movement_type = 'salida'
      AND ROUND(crm.amount::numeric, 2) = ROUND(COALESCE(v_refund_amount, 0)::numeric, 2)
      AND crm.reason =
        'Anulacion de pago '
        || COALESCE(v_payment_code, substr(p_payment_id::text, 1, 8))
        || ': '
        || p_reason
      AND COALESCE(crm.movement_detail ->> 'kind', '') = 'cash_refund';

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
      'payment_refund_by_transfer',
      'payment',
      p_payment_id::text,
      NULL,
      jsonb_build_object(
        'payment_id', p_payment_id,
        'request_id', p_request_id,
        'shift_id', p_current_shift_id,
        'refund_method', 'TRANSFER',
        'refund_amount', v_refund_amount,
        'requested_by_user_id', p_requested_by_user_id,
        'approved_by_supervisor_id', p_supervisor_id,
        'reason', p_reason,
        'created_at', now()
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_void_payment_legacy_refund_method(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC, authenticated;

REVOKE ALL ON FUNCTION public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb
) TO authenticated;

NOTIFY pgrst, 'reload schema';
