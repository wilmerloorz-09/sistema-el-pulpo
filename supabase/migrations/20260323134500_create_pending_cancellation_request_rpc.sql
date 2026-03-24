CREATE OR REPLACE FUNCTION public.create_pending_order_cancellation_request(
  p_order_id uuid,
  p_user_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_cancellation_type text DEFAULT 'partial'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_now timestamptz := now();
  v_request_id uuid := gen_random_uuid();
  v_existing_ids uuid[];
  v_item jsonb;
  v_order_item_id uuid;
  v_qty integer;
  v_unit_price numeric;
  v_snapshot record;
  v_pending_qty integer;
  v_ready_qty integer;
  v_dispatched_qty integer;
  v_request_payload jsonb := jsonb_build_object(
    'notes', COALESCE(NULLIF(btrim(p_notes), ''), NULL),
    'items', COALESCE(p_items, '[]'::jsonb)
  );
BEGIN
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'order_id y user_id son obligatorios';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de cancelacion';
  END IF;

  IF p_cancellation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de cancelacion invalido';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El usuario autenticado no coincide con el solicitante';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.status = 'PAID' THEN
    RAISE EXCEPTION 'No se puede solicitar cancelacion de una orden pagada';
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden ya esta cancelada';
  END IF;

  PERFORM public.request_order_cancellation(p_order_id, p_user_id);

  SELECT array_agg(id)
  INTO v_existing_ids
  FROM public.order_cancellations
  WHERE order_id = p_order_id
    AND status = 'VOIDED'
    AND notes ILIKE '[PENDING_REQUEST]%';

  IF COALESCE(array_length(v_existing_ids, 1), 0) > 0 THEN
    DELETE FROM public.order_item_cancellations
    WHERE order_cancellation_id = ANY(v_existing_ids);

    DELETE FROM public.order_cancellations
    WHERE id = ANY(v_existing_ids);
  END IF;

  INSERT INTO public.order_cancellations (
    id,
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    v_request_id,
    p_order_id,
    p_cancellation_type,
    btrim(p_reason),
    CONCAT('[PENDING_REQUEST] ', v_request_payload::text),
    p_user_id,
    'VOIDED',
    v_now
  );

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_request_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_order_item_id := (v_item ->> 'order_item_id')::uuid;
    v_qty := GREATEST(0, COALESCE((v_item ->> 'quantity_cancelled')::integer, 0));

    IF v_order_item_id IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT snapshot.*
    INTO v_snapshot
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_order_item_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_unit_price := COALESCE(v_snapshot.unit_price, 0);
    v_pending_qty := LEAST(v_qty, COALESCE(v_snapshot.quantity_pending_prepare, 0));
    v_qty := GREATEST(0, v_qty - v_pending_qty);
    v_ready_qty := LEAST(v_qty, COALESCE(v_snapshot.quantity_ready_available, 0));
    v_qty := GREATEST(0, v_qty - v_ready_qty);
    v_dispatched_qty := LEAST(
      v_qty,
      GREATEST(0, COALESCE(v_snapshot.quantity_dispatched_total, 0) - COALESCE(v_snapshot.quantity_cancelled_dispatched, 0))
    );

    IF v_pending_qty > 0 THEN
      INSERT INTO public.order_item_cancellations (
        id,
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        gen_random_uuid(),
        v_request_id,
        p_order_id,
        v_order_item_id,
        v_pending_qty,
        v_unit_price,
        ROUND((v_pending_qty * v_unit_price)::numeric, 2),
        'PENDING',
        v_now
      );
    END IF;

    IF v_ready_qty > 0 THEN
      INSERT INTO public.order_item_cancellations (
        id,
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        gen_random_uuid(),
        v_request_id,
        p_order_id,
        v_order_item_id,
        v_ready_qty,
        v_unit_price,
        ROUND((v_ready_qty * v_unit_price)::numeric, 2),
        'READY',
        v_now
      );
    END IF;

    IF v_dispatched_qty > 0 THEN
      INSERT INTO public.order_item_cancellations (
        id,
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        gen_random_uuid(),
        v_request_id,
        p_order_id,
        v_order_item_id,
        v_dispatched_qty,
        v_unit_price,
        ROUND((v_dispatched_qty * v_unit_price)::numeric, 2),
        'DISPATCHED',
        v_now
      );
    END IF;
  END LOOP;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_order_cancellation_request(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_order_cancellation_request(uuid, uuid, text, text, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
