-- =============================================================================
-- Anulación con devolución del billete/moneda original + reingreso del vuelto
-- =============================================================================
-- Si el cliente pagó con $20 y recibió vuelto $10+$1, al anular (anulación total)
-- y si la caja aún tiene el $20:
--   1) PAYMENT_IN del vuelto ($10+$1) — el cliente lo regresa
--   2) CHANGE_OUT del tender original ($20) — se le entrega de nuevo
-- Neto caja = monto anulado.
-- =============================================================================

ALTER TABLE public.payment_void_requests
  ADD COLUMN IF NOT EXISTS cash_change_return_detail jsonb NULL;

COMMENT ON COLUMN public.payment_void_requests.cash_change_return_detail IS
  'Vuelto del cobro que regresa a caja (mismas denoms CHANGE_OUT del pago). Null en devolución greedy.';

CREATE OR REPLACE FUNCTION public.apply_payment_void_cash_denoms(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_payment_id uuid,
  p_cash_out jsonb,
  p_cash_in jsonb,
  p_expected_net numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out_total numeric(10,2) := 0;
  v_in_total numeric(10,2) := 0;
  v_row record;
BEGIN
  p_cash_out := COALESCE(p_cash_out, '[]'::jsonb);
  p_cash_in := COALESCE(p_cash_in, '[]'::jsonb);

  -- 1) Reingresar vuelto (el cliente lo entrega de vuelta)
  FOR v_row IN
    SELECT
      csd.id AS denom_row_id,
      csd.denomination_id,
      d.label,
      d.value,
      (selection ->> 'qty')::integer AS qty
    FROM jsonb_array_elements(p_cash_in) AS selection
    JOIN public.cash_shift_denoms csd
      ON csd.shift_id = p_shift_id
     AND csd.cashier_id = p_cashier_id
     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
    FOR UPDATE OF csd
  LOOP
    v_in_total := ROUND(v_in_total + (v_row.qty * v_row.value)::numeric, 2);

    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current + v_row.qty
    WHERE csd.id = v_row.denom_row_id;

    INSERT INTO public.cash_movements (
      id, shift_id, movement_type, denomination_id, qty_delta, payment_id, created_at
    ) VALUES (
      gen_random_uuid(),
      p_shift_id,
      'PAYMENT_IN',
      v_row.denomination_id,
      v_row.qty,
      p_payment_id,
      now()
    );
  END LOOP;

  -- 2) Entregar al cliente (billete/moneda original u otras denoms)
  FOR v_row IN
    SELECT
      csd.id AS denom_row_id,
      csd.denomination_id,
      csd.qty_current,
      d.label,
      d.value,
      (selection ->> 'qty')::integer AS qty
    FROM jsonb_array_elements(p_cash_out) AS selection
    JOIN public.cash_shift_denoms csd
      ON csd.shift_id = p_shift_id
     AND csd.cashier_id = p_cashier_id
     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
    FOR UPDATE OF csd
  LOOP
    v_out_total := ROUND(v_out_total + (v_row.qty * v_row.value)::numeric, 2);

    IF v_row.qty_current < v_row.qty THEN
      RAISE EXCEPTION 'La caja no tiene suficiente % para devolver este pago', v_row.label;
    END IF;

    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current - v_row.qty
    WHERE csd.id = v_row.denom_row_id;

    INSERT INTO public.cash_movements (
      id, shift_id, movement_type, denomination_id, qty_delta, payment_id, created_at
    ) VALUES (
      gen_random_uuid(),
      p_shift_id,
      'CHANGE_OUT',
      v_row.denomination_id,
      v_row.qty,
      p_payment_id,
      now()
    );
  END LOOP;

  IF COALESCE(jsonb_array_length(p_cash_out), 0) > 0
     AND ABS((v_out_total - v_in_total) - ROUND(COALESCE(p_expected_net, 0)::numeric, 2)) > 0.01
  THEN
    RAISE EXCEPTION
      'La devolucion en efectivo no cuadra (salidas % - entradas % != %)',
      v_out_total, v_in_total, ROUND(COALESCE(p_expected_net, 0)::numeric, 2);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_payment_void_cash_denoms(uuid, uuid, uuid, jsonb, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_payment_void_cash_denoms(uuid, uuid, uuid, jsonb, jsonb, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- request_void_payment: aceptar y validar cash_change_return_detail
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.request_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_reason text,
  p_terminal_id text DEFAULT NULL,
  p_payment_item_selections jsonb DEFAULT NULL,
  p_cash_refund_detail jsonb DEFAULT NULL,
  p_refund_method text DEFAULT NULL,
  p_cash_change_return_detail jsonb DEFAULT NULL
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
  v_refund_cash_out_total numeric(10,2) := 0;
  v_refund_cash_in_total numeric(10,2) := 0;
  v_payment_items_count integer := 0;
  v_resolved_item_selections jsonb := '[]'::jsonb;
  v_resolved_cash_out jsonb := '[]'::jsonb;
  v_resolved_cash_in jsonb := '[]'::jsonb;
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

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;

  SELECT COUNT(*) INTO v_payment_items_count
  FROM public.payment_items pi WHERE pi.payment_id = p_payment_id;

  IF v_payment_items_count > 0 THEN
    IF COALESCE(jsonb_array_length(COALESCE(p_payment_item_selections, '[]'::jsonb)), 0) = 0 THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('payment_item_id', pi.id, 'quantity', pi.quantity_paid)
          ORDER BY pi.created_at, pi.id
        ),
        '[]'::jsonb
      )
      INTO v_resolved_item_selections
      FROM public.payment_items pi
      WHERE pi.payment_id = p_payment_id;
    ELSE
      FOR v_item_row IN
        SELECT pi.id, pi.quantity_paid, pi.unit_price
        FROM public.payment_items pi
        JOIN jsonb_array_elements(p_payment_item_selections) AS selection
          ON (selection ->> 'payment_item_id')::uuid = pi.id
        WHERE pi.payment_id = p_payment_id
      LOOP
        SELECT COALESCE(SUM((selection ->> 'quantity')::numeric), 0)
        INTO v_requested_qty
        FROM jsonb_array_elements(p_payment_item_selections) AS selection
        WHERE (selection ->> 'payment_item_id')::uuid = v_item_row.id;

        IF v_requested_qty <= 0 THEN CONTINUE; END IF;
        IF v_requested_qty > v_item_row.quantity_paid THEN
          RAISE EXCEPTION 'No puedes anular una cantidad mayor a la pagada';
        END IF;

        v_refund_amount := ROUND(v_refund_amount + (v_requested_qty * v_item_row.unit_price)::numeric, 2);
        v_resolved_item_selections := v_resolved_item_selections || jsonb_build_array(
          jsonb_build_object('payment_item_id', v_item_row.id, 'quantity', v_requested_qty)
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

  IF v_refund_method = 'TRANSFER' THEN
    v_resolved_cash_out := '[]'::jsonb;
    v_resolved_cash_in := '[]'::jsonb;
  ELSE
    IF COALESCE(jsonb_array_length(COALESCE(p_cash_refund_detail, '[]'::jsonb)), 0) > 0 THEN
      FOR v_cash_row IN
        SELECT
          csd.denomination_id, d.label, d.value, d.image_url,
          (selection ->> 'qty')::integer AS qty
        FROM jsonb_array_elements(p_cash_refund_detail) AS selection
        JOIN public.cash_shift_denoms csd
          ON csd.shift_id = p_current_shift_id
         AND csd.cashier_id = v_actor_id
         AND csd.denomination_id = (selection ->> 'denomination_id')::uuid
        JOIN public.denominations d ON d.id = csd.denomination_id
        WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
      LOOP
        v_refund_cash_out_total := ROUND(v_refund_cash_out_total + (v_cash_row.qty * v_cash_row.value)::numeric, 2);
        v_resolved_cash_out := v_resolved_cash_out || jsonb_build_array(
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

    IF COALESCE(jsonb_array_length(COALESCE(p_cash_change_return_detail, '[]'::jsonb)), 0) > 0 THEN
      FOR v_cash_row IN
        SELECT
          d.id AS denomination_id, d.label, d.value, d.image_url,
          (selection ->> 'qty')::integer AS qty
        FROM jsonb_array_elements(p_cash_change_return_detail) AS selection
        JOIN public.denominations d
          ON d.id = (selection ->> 'denomination_id')::uuid
        WHERE COALESCE((selection ->> 'qty')::integer, 0) > 0
      LOOP
        v_refund_cash_in_total := ROUND(v_refund_cash_in_total + (v_cash_row.qty * v_cash_row.value)::numeric, 2);
        v_resolved_cash_in := v_resolved_cash_in || jsonb_build_array(
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
  END IF;

  IF COALESCE(jsonb_array_length(v_resolved_cash_out), 0) > 0
    AND ABS((v_refund_cash_out_total - v_refund_cash_in_total) - v_refund_amount) > 0.01
  THEN
    RAISE EXCEPTION 'La devolucion en efectivo no coincide con el valor a anular';
  END IF;

  INSERT INTO public.payment_void_requests (
    payment_id, order_id, shift_id, requested_by_user_id, reason, terminal_id, status,
    payment_item_selections, refund_amount, cash_refund_detail, cash_change_return_detail, refund_method
  )
  VALUES (
    v_payment.id, v_payment.order_id, p_current_shift_id, v_actor_id, v_reason,
    NULLIF(btrim(COALESCE(p_terminal_id, '')), ''), 'pending',
    v_resolved_item_selections, v_refund_amount,
    CASE WHEN COALESCE(jsonb_array_length(v_resolved_cash_out), 0) > 0 THEN v_resolved_cash_out ELSE NULL END,
    CASE WHEN COALESCE(jsonb_array_length(v_resolved_cash_in), 0) > 0 THEN v_resolved_cash_in ELSE NULL END,
    v_refund_method
  )
  ON CONFLICT (payment_id) WHERE status = 'pending'
  DO UPDATE SET
    requested_by_user_id = EXCLUDED.requested_by_user_id,
    reason = EXCLUDED.reason,
    terminal_id = EXCLUDED.terminal_id,
    payment_item_selections = EXCLUDED.payment_item_selections,
    refund_amount = EXCLUDED.refund_amount,
    cash_refund_detail = EXCLUDED.cash_refund_detail,
    cash_change_return_detail = EXCLUDED.cash_change_return_detail,
    refund_method = EXCLUDED.refund_method,
    updated_at = now()
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_void_payment(uuid, uuid, text, text, jsonb, jsonb, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- approve_and_void_payment: aplicar piernas in/out antes del legacy si aplica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_and_void_payment(
  p_payment_id uuid,
  p_request_id uuid,
  p_reason text,
  p_current_shift_id uuid,
  p_requested_by_user_id uuid,
  p_supervisor_id uuid,
  p_terminal_id text DEFAULT NULL,
  p_payment_item_selections jsonb DEFAULT NULL,
  p_cash_refund_detail jsonb DEFAULT NULL,
  p_cash_change_return_detail jsonb DEFAULT NULL
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
  v_cash_out jsonb;
  v_cash_in jsonb;
  v_has_change_return boolean := false;
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
    COALESCE(pvr.cash_refund_detail, p_cash_refund_detail, '[]'::jsonb),
    COALESCE(pvr.cash_change_return_detail, p_cash_change_return_detail, '[]'::jsonb)
  INTO
    v_refund_method,
    v_payment_method_name,
    v_payment_code,
    v_refund_amount,
    v_cash_out,
    v_cash_in
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
  v_has_change_return := COALESCE(jsonb_array_length(v_cash_in), 0) > 0;

  IF v_refund_method NOT IN ('CASH', 'TRANSFER') THEN
    RAISE EXCEPTION 'La forma de devolucion no es valida';
  END IF;

  IF v_refund_method = 'TRANSFER'
     AND lower(COALESCE(v_payment_method_name, '')) NOT LIKE '%transfer%' THEN
    RAISE EXCEPTION 'La devolucion por transferencia solo aplica a pagos por transferencia';
  END IF;

  IF v_refund_method = 'TRANSFER' THEN
    IF COALESCE(jsonb_array_length(v_cash_out), 0) > 0
       OR COALESCE(jsonb_array_length(v_cash_in), 0) > 0 THEN
      RAISE EXCEPTION 'Una devolucion por transferencia no puede descontar denominaciones de caja';
    END IF;
  END IF;

  IF v_refund_method = 'CASH'
     AND COALESCE(jsonb_array_length(v_cash_out), 0) = 0 THEN
    RAISE EXCEPTION 'Debes cuadrar las denominaciones para devolver el dinero en efectivo';
  END IF;

  UPDATE public.payment_void_requests
  SET refund_method = v_refund_method,
      cash_refund_detail = CASE
        WHEN v_refund_method = 'TRANSFER' THEN NULL
        ELSE COALESCE(cash_refund_detail, v_cash_out)
      END,
      cash_change_return_detail = CASE
        WHEN v_refund_method = 'TRANSFER' THEN NULL
        WHEN v_has_change_return THEN v_cash_in
        ELSE cash_change_return_detail
      END,
      updated_at = now()
  WHERE id = p_request_id;

  -- Camino exacto: aplicar in/out aquí y llamar al legacy SIN denoms (evita doble
  -- CHANGE_OUT y la validación antigua sum(out)=monto).
  IF v_refund_method = 'CASH' AND v_has_change_return THEN
    PERFORM public.apply_payment_void_cash_denoms(
      p_current_shift_id,
      p_requested_by_user_id,
      p_payment_id,
      v_cash_out,
      v_cash_in,
      v_refund_amount
    );

    -- Ocultar denoms al legacy para que no re-aplique ni valide sum(out)=monto.
    UPDATE public.payment_void_requests
    SET cash_refund_detail = NULL
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
        '[]'::jsonb
      )
    LOOP
      payment_id := v_result.payment_id;
      order_id := v_result.order_id;
      shift_id := v_result.shift_id;
      request_id := v_result.request_id;
      payment_status := v_result.payment_status;
      RETURN NEXT;
    END LOOP;

    -- Restaurar detalle para historial / UI y enriquecer el movimiento de caja.
    UPDATE public.payment_void_requests
    SET cash_refund_detail = v_cash_out,
        cash_change_return_detail = v_cash_in,
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE public.cash_register_movements crm
    SET movement_detail = jsonb_build_object(
      'kind', 'cash_refund_exact_tender',
      'refund_out', v_cash_out,
      'change_return', v_cash_in,
      'totals', jsonb_build_object('refund', ROUND(v_refund_amount::numeric, 2))
    )
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

    RETURN;
  END IF;

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
      CASE WHEN v_refund_method = 'CASH' THEN v_cash_out ELSE '[]'::jsonb END
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
      user_id, action, entity, entity_id, before_data, after_data
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

REVOKE ALL ON FUNCTION public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) TO authenticated;

-- Retirar overload de 9 args si existe (PostgREST debe resolver la de 10 con default).
DROP FUNCTION IF EXISTS public.approve_and_void_payment(
  uuid, uuid, text, uuid, uuid, uuid, text, jsonb, jsonb
);

NOTIFY pgrst, 'reload schema';
