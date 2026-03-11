CREATE OR REPLACE FUNCTION public.cancel_order_quantities(
  p_order_id uuid,
  p_cancelled_by uuid,
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
  v_cancellation_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_target_order_item_id uuid;
  v_target_qty integer;
  v_paid_qty integer;
  v_pending_prepare integer;
  v_ready_available integer;
  v_cancelled_total integer;
  v_unit_price numeric;
  v_current_item_status text;
  v_cancel_pending integer;
  v_cancel_ready integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de cancelacion';
  END IF;

  IF p_cancellation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de cancelacion invalido';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.status = 'PAID' THEN
    RAISE EXCEPTION 'No se puede cancelar una orden pagada';
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden ya esta cancelada';
  END IF;

  CREATE TEMP TABLE tmp_cancel_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_cancelled integer NOT NULL
  ) ON COMMIT DROP;

  IF p_cancellation_type = 'total' THEN
    INSERT INTO tmp_cancel_targets (order_item_id, quantity_cancelled)
    SELECT
      order_item_id,
      quantity_pending_prepare + quantity_ready_available
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE quantity_pending_prepare + quantity_ready_available > 0;
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para cancelacion parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_cancelled')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en cancelacion';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad de cancelacion invalida para item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_cancel_targets (order_item_id, quantity_cancelled)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_cancelled = tmp_cancel_targets.quantity_cancelled + EXCLUDED.quantity_cancelled;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_cancel_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para cancelar';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    SELECT
      snapshot.quantity_paid,
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      snapshot.quantity_cancelled_total,
      snapshot.unit_price,
      snapshot.item_status
    INTO v_paid_qty, v_pending_prepare, v_ready_available, v_cancelled_total, v_unit_price, v_current_item_status
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_current_item_status IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > (v_pending_prepare + v_ready_available) THEN
      RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    IF v_current_item_status = 'PAID' OR v_paid_qty > 0 AND (v_pending_prepare + v_ready_available) <= 0 THEN
      RAISE EXCEPTION 'No puedes cancelar un item ya pagado';
    END IF;
  END LOOP;

  INSERT INTO public.order_cancellations (
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    p_order_id,
    p_cancellation_type,
    btrim(p_reason),
    p_notes,
    p_cancelled_by,
    'APPLIED',
    v_now
  )
  RETURNING id INTO v_cancellation_id;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    SELECT quantity_pending_prepare, quantity_ready_available, unit_price
    INTO v_pending_prepare, v_ready_available, v_unit_price
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE order_item_id = v_target_order_item_id;

    v_cancel_pending := LEAST(v_target_qty, v_pending_prepare);
    v_cancel_ready := GREATEST(0, v_target_qty - v_cancel_pending);

    IF v_cancel_pending > 0 THEN
      INSERT INTO public.order_item_cancellations (
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        v_cancellation_id,
        p_order_id,
        v_target_order_item_id,
        v_cancel_pending,
        v_unit_price,
        ROUND((v_cancel_pending * v_unit_price)::numeric, 2),
        'PENDING',
        v_now
      );
    END IF;

    IF v_cancel_ready > 0 THEN
      INSERT INTO public.order_item_cancellations (
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        v_cancellation_id,
        p_order_id,
        v_target_order_item_id,
        v_cancel_ready,
        v_unit_price,
        ROUND((v_cancel_ready * v_unit_price)::numeric, 2),
        'READY',
        v_now
      );
    END IF;
  END LOOP;

  UPDATE public.order_items oi
  SET
    cancelled_at = CASE
      WHEN snapshot.quantity_cancelled_total >= snapshot.quantity_ordered THEN v_now
      ELSE oi.cancelled_at
    END,
    cancelled_by = CASE
      WHEN snapshot.quantity_cancelled_total >= snapshot.quantity_ordered THEN p_cancelled_by
      ELSE oi.cancelled_by
    END,
    cancellation_reason = CASE
      WHEN snapshot.quantity_cancelled_total >= snapshot.quantity_ordered THEN btrim(p_reason)
      ELSE oi.cancellation_reason
    END,
    cancelled_from_status = CASE
      WHEN snapshot.quantity_cancelled_total >= snapshot.quantity_ordered THEN COALESCE(oi.status, 'DRAFT')
      ELSE oi.cancelled_from_status
    END,
    status = CASE
      WHEN snapshot.quantity_cancelled_total >= snapshot.quantity_ordered THEN 'CANCELLED'
      ELSE oi.status
    END
  FROM public.get_order_operational_snapshot(p_order_id) snapshot
  WHERE snapshot.order_item_id = oi.id;

  UPDATE public.orders o
  SET total = COALESCE((
    SELECT SUM((snapshot.quantity_ordered - snapshot.quantity_cancelled_total) * snapshot.unit_price)
    FROM public.get_order_operational_snapshot(o.id) snapshot
  ), 0),
  updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);

  UPDATE public.orders
  SET
    cancelled_at = CASE WHEN status = 'CANCELLED' THEN COALESCE(cancelled_at, v_now) ELSE cancelled_at END,
    cancelled_by = CASE WHEN status = 'CANCELLED' THEN COALESCE(cancelled_by, p_cancelled_by) ELSE cancelled_by END,
    cancellation_reason = CASE WHEN status = 'CANCELLED' THEN COALESCE(cancellation_reason, btrim(p_reason)) ELSE cancellation_reason END,
    cancelled_from_status = CASE WHEN status = 'CANCELLED' THEN COALESCE(cancelled_from_status, v_order.status::text) ELSE cancelled_from_status END,
    updated_at = v_now
  WHERE id = p_order_id;

  RETURN v_cancellation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) TO authenticated;
SELECT pg_notify('pgrst', 'reload schema');
