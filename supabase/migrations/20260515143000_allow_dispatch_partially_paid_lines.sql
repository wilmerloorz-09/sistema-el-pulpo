-- Permite despachar lineas ya cobradas aunque la orden siga en SENT_TO_KITCHEN / READY
-- (cobro parcial: una linea pagada, otras aun en caja).

CREATE OR REPLACE FUNCTION public.dispatch_order_quantities(
  p_order_id uuid,
  p_dispatched_by uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_operation_type text DEFAULT 'partial',
  p_source_module text DEFAULT 'dispatch',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_target_order_item_id uuid;
  v_target_qty integer;
  v_pending_prepare integer;
  v_ready_available integer;
  v_paid_qty_effective integer;
  v_already_dispatched integer;
  v_max_dispatchable integer;
  v_dispatch_from_ready integer;
  v_dispatch_from_pending integer;
BEGIN
  IF p_operation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de operacion invalido';
  END IF;

  IF p_source_module NOT IN ('kitchen', 'dispatch', 'orders', 'admin') THEN
    RAISE EXCEPTION 'Modulo origen invalido';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.status = 'CANCELLED'
    OR COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades';
  END IF;

  IF v_order.status NOT IN ('SENT_TO_KITCHEN', 'READY', 'PAID', 'KITCHEN_DISPATCHED') THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades en su estado actual';
  END IF;

  CREATE TEMP TABLE tmp_dispatch_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_dispatch_stages (
    order_item_id uuid NOT NULL,
    source_stage text NOT NULL,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  IF p_operation_type = 'total' THEN
    INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
    SELECT
      snapshot.order_item_id,
      LEAST(
        snapshot.quantity_dispatched_available,
        GREATEST(
          0,
          LEAST(
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
            COALESCE(snapshot.quantity_paid, 0)
          )
          - GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0)
              - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        )
      )::int
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    JOIN public.order_items oi ON oi.id = snapshot.order_item_id
    WHERE snapshot.quantity_dispatched_available > 0
      AND COALESCE(snapshot.quantity_paid, 0) > 0;
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para despacho parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_dispatched')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en despacho';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad invalida para despacho en item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_dispatched = tmp_dispatch_targets.quantity_dispatched + EXCLUDED.quantity_dispatched;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_dispatch_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para despachar';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_dispatched FROM tmp_dispatch_targets
  LOOP
    SELECT
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      LEAST(
        GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
        COALESCE(snapshot.quantity_paid, 0)
      )::int,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0)
        - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int
    INTO v_pending_prepare, v_ready_available, v_paid_qty_effective, v_already_dispatched
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    JOIN public.order_items oi ON oi.id = snapshot.order_item_id
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_pending_prepare IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_paid_qty_effective <= 0 THEN
      RAISE EXCEPTION 'El item % no tiene cantidad pagada para despachar', v_target_order_item_id;
    END IF;

    v_max_dispatchable := LEAST(
      v_pending_prepare + v_ready_available,
      GREATEST(0, v_paid_qty_effective - v_already_dispatched)
    );

    IF v_target_qty > v_max_dispatchable THEN
      RAISE EXCEPTION 'No puedes despachar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    v_dispatch_from_ready := LEAST(v_target_qty, v_ready_available);
    v_dispatch_from_pending := GREATEST(0, v_target_qty - v_dispatch_from_ready);

    IF v_dispatch_from_ready > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'READY', v_dispatch_from_ready);
    END IF;

    IF v_dispatch_from_pending > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'PENDING', v_dispatch_from_pending);
    END IF;
  END LOOP;

  INSERT INTO public.order_dispatch_events (
    order_id,
    event_type,
    created_by,
    source_module,
    notes,
    created_at
  ) VALUES (
    p_order_id,
    p_operation_type,
    p_dispatched_by,
    p_source_module,
    p_notes,
    v_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.order_item_dispatch_events (
    order_dispatch_event_id,
    order_id,
    order_item_id,
    quantity_dispatched,
    source_stage,
    created_at
  )
  SELECT v_event_id, p_order_id, order_item_id, quantity_dispatched, source_stage, v_now
  FROM tmp_dispatch_stages;

  UPDATE public.order_items oi
  SET dispatched_at = v_now
  WHERE oi.id IN (SELECT DISTINCT order_item_id FROM tmp_dispatch_stages);

  PERFORM public.recompute_order_operational_state(p_order_id);
  PERFORM public.sync_order_payment_state_internal(p_order_id);

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) TO authenticated;
