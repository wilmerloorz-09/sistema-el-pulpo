-- Re-cobro tras anulación: reabrir SIEMPRE la orden del pago anulado (mismo número).
-- Si existía sucesora legacy, libera su order_code y la saca del flujo activo.

CREATE OR REPLACE FUNCTION public.preparar_orden_para_recobro(
  p_order_id uuid,
  p_successor_hint uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_successor public.orders%ROWTYPE;
  v_successor_id uuid;
  v_open_shift_id uuid;
  v_match text[];
  v_recovered_code text;
  v_recovered_table_id uuid;
  v_recovered_split_id uuid;
  v_recovered_position integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  v_match := regexp_match(COALESCE(v_order.notes, ''), 'VOID_SUCCESSOR_ORDER:([a-f0-9-]{36})', 'i');
  v_successor_id := COALESCE(v_match[1]::uuid, p_successor_hint);

  IF v_successor_id IS NULL THEN
    SELECT o.id
    INTO v_successor_id
    FROM public.orders o
    WHERE o.branch_id = v_order.branch_id
      AND COALESCE(o.notes, '') ILIKE ('%SUCCESSOR_OF_VOIDED_ORDER:' || p_order_id::text || '%')
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;

  IF v_successor_id IS NOT NULL AND v_successor_id <> p_order_id THEN
    SELECT *
    INTO v_successor
    FROM public.orders
    WHERE id = v_successor_id
    FOR UPDATE;

    IF FOUND THEN
      v_recovered_code := v_successor.order_code;
      v_recovered_table_id := v_successor.table_id;
      v_recovered_split_id := v_successor.split_id;
      v_recovered_position := v_successor.table_order_position;

      -- Liberar código único antes de devolvérselo a la orden original.
      UPDATE public.orders
      SET
        order_code = NULL,
        table_id = NULL,
        split_id = NULL,
        table_order_position = NULL,
        status = 'CANCELLED',
        paid_at = NULL,
        cancelled_at = COALESCE(cancelled_at, now()),
        cancellation_reason = COALESCE(cancellation_reason, 'Sucesora cerrada: se reabre la orden original para re-cobro'),
        notes = public.append_payment_note_marker(
          COALESCE(notes, ''),
          'SUPERSEDED_BY_RECHARGE_OF:' || p_order_id::text
        ),
        updated_at = now()
      WHERE id = v_successor_id
        AND COALESCE(status::text, '') <> 'PAID';
    END IF;
  END IF;

  SELECT cs.id
  INTO v_open_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_open_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto en la sucursal';
  END IF;

  UPDATE public.orders
  SET
    status = 'SENT_TO_KITCHEN'::public.order_status,
    paid_at = NULL,
    token_promocion = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancellation_reason = NULL,
    cancelled_from_status = NULL,
    cash_shift_id = v_open_shift_id,
    order_code = COALESCE(order_code, v_recovered_code),
    table_id = COALESCE(table_id, v_recovered_table_id),
    split_id = COALESCE(split_id, v_recovered_split_id),
    table_order_position = COALESCE(table_order_position, v_recovered_position),
    notes = public.append_payment_note_marker(
      regexp_replace(
        COALESCE(notes, ''),
        'VOID_SUCCESSOR_ORDER:[a-f0-9-]{36}',
        'VOID_SUCCESSOR_CLEARED_FOR_RECHARGE',
        'gi'
      ),
      'REOPENED_FOR_RECHARGE:' || now()::text
    ),
    updated_at = now()
  WHERE id = p_order_id;

  UPDATE public.order_items
  SET paid_at = NULL
  WHERE order_id = p_order_id
    AND paid_at IS NOT NULL;

  PERFORM public.restore_voided_dine_in_order_to_table(p_order_id);

  RETURN p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_orden_para_recobro(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preparar_orden_para_recobro(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
