-- Objetivo: evitar el error RLS "new row violates row-level security policy
-- (USING expression) for table payment_void_requests" que aparecia al anular un
-- pago cuando el frontend escribia directo en la tabla payment_void_requests.
--
-- El flujo seguro (SECURITY DEFINER) es la RPC request_void_payment. Se amplia
-- para aceptar y persistir p_refund_method (CASH/TRANSFER), de modo que el
-- cliente deje de hacer el upsert directo (sujeto a RLS) y llame a esta RPC.
--
-- Se conserva toda la logica de resolucion de items, calculo de devolucion y
-- validacion de efectivo de la version vigente (20260610010000), agregando solo
-- el manejo de refund_method.

DROP FUNCTION IF EXISTS public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.request_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_reason text,
  p_terminal_id text DEFAULT NULL,
  p_payment_item_selections jsonb DEFAULT NULL,
  p_cash_refund_detail jsonb DEFAULT NULL,
  p_refund_method text DEFAULT NULL
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
  v_refund_method text := NULLIF(upper(btrim(COALESCE(p_refund_method, ''))), '');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Debes indicar un motivo para anular el pago';
  END IF;

  IF v_refund_method IS NOT NULL AND v_refund_method NOT IN ('CASH', 'TRANSFER') THEN
    RAISE EXCEPTION 'Forma de devolucion invalida';
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

  -- Una devolucion por transferencia no descuenta efectivo de caja, por lo que
  -- se ignora cualquier detalle de denominaciones que llegue del cliente.
  IF v_refund_method = 'TRANSFER' THEN
    v_resolved_cash_detail := '[]'::jsonb;
  ELSIF COALESCE(jsonb_array_length(COALESCE(p_cash_refund_detail, '[]'::jsonb)), 0) > 0 THEN
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
    cash_refund_detail,
    refund_method
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
    END,
    v_refund_method
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
    refund_method = EXCLUDED.refund_method,
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
      'refund_method', v_refund_method,
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

REVOKE ALL ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
