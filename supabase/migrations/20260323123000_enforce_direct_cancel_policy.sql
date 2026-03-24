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
  v_dispatched_net integer;
  v_unit_price numeric;
  v_current_item_status text;
  v_cancel_pending integer;
  v_cancel_ready integer;
  v_cancel_dispatched integer;
  v_remaining integer;
  v_actor_id uuid := auth.uid();
  v_gate record;
  v_requires_authorization boolean := false;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de cancelacion';
  END IF;

  IF p_cancellation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de cancelacion invalido';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar al usuario autenticado';
  END IF;

  IF p_cancelled_by IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'El usuario autenticado no coincide con el usuario que intenta cancelar';
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
      snapshot.order_item_id,
      snapshot.quantity_pending_prepare
      + snapshot.quantity_ready_available
      + GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched)
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.quantity_pending_prepare
      + snapshot.quantity_ready_available
      + GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched) > 0;
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

  IF NOT public.can_manage_branch_admin(v_actor_id, v_order.branch_id) THEN
    SELECT *
    INTO v_gate
    FROM public.get_my_branch_shift_gate(v_order.branch_id)
    LIMIT 1;

    IF NOT COALESCE(v_gate.can_authorize_order_cancel, false) AND NOT COALESCE(v_gate.is_supervisor, false) THEN
      SELECT EXISTS (
        SELECT 1
        FROM tmp_cancel_targets target
        JOIN public.order_items oi
          ON oi.id = target.order_item_id
        LEFT JOIN LATERAL public.get_branch_cancel_policy_for_product(v_order.branch_id, oi.product_id) policy
          ON true
        WHERE oi.order_id = p_order_id
          AND NOT COALESCE(policy.allow_direct_cancel, false)
      )
      INTO v_requires_authorization;

      IF v_requires_authorization THEN
        RAISE EXCEPTION 'Esta anulacion requiere autorizacion';
      END IF;
    END IF;
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    SELECT
      snapshot.quantity_paid,
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched),
      snapshot.unit_price,
      snapshot.item_status
    INTO v_paid_qty, v_pending_prepare, v_ready_available, v_dispatched_net, v_unit_price, v_current_item_status
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_current_item_status IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > (v_pending_prepare + v_ready_available + v_dispatched_net) THEN
      RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    IF v_current_item_status = 'PAID' OR v_paid_qty > 0 AND (v_pending_prepare + v_ready_available + v_dispatched_net) <= 0 THEN
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
    SELECT
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched),
      snapshot.unit_price
    INTO v_pending_prepare, v_ready_available, v_dispatched_net, v_unit_price
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    v_cancel_pending := LEAST(v_target_qty, v_pending_prepare);
    v_remaining := GREATEST(0, v_target_qty - v_cancel_pending);
    v_cancel_ready := LEAST(v_remaining, v_ready_available);
    v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
    v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

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

    IF v_cancel_dispatched > 0 THEN
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
        v_cancel_dispatched,
        v_unit_price,
        ROUND((v_cancel_dispatched * v_unit_price)::numeric, 2),
        'DISPATCHED',
        v_now
      );
    END IF;
  END LOOP;

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);

  RETURN v_cancellation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) TO authenticated;

