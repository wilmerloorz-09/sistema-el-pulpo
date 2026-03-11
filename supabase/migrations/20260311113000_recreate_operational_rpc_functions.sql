-- Recreate operational RPC functions and force PostgREST schema reload

CREATE OR REPLACE FUNCTION public.get_order_operational_snapshot(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_item_id uuid,
  description_snapshot text,
  item_status text,
  unit_price numeric,
  quantity_ordered integer,
  quantity_paid integer,
  quantity_ready_total integer,
  quantity_ready_available integer,
  quantity_dispatched integer,
  quantity_cancelled_pending integer,
  quantity_cancelled_ready integer,
  quantity_cancelled_total integer,
  quantity_pending_prepare integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH paid AS (
    SELECT
      pi.order_item_id,
      COALESCE(SUM(pi.quantity_paid), 0)::int AS quantity_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    GROUP BY pi.order_item_id
  ),
  ready AS (
    SELECT
      oire.order_item_id,
      COALESCE(SUM(oire.quantity_ready), 0)::int AS quantity_ready_total
    FROM public.order_item_ready_events oire
    JOIN public.order_ready_events ore ON ore.id = oire.order_ready_event_id
    WHERE ore.status = 'APPLIED'
    GROUP BY oire.order_item_id
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode ON ode.id = oide.order_dispatch_event_id
    WHERE ode.status = 'APPLIED'
    GROUP BY oide.order_item_id
  ),
  cancelled AS (
    SELECT
      oic.order_item_id,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'PENDING'), 0)::int AS quantity_cancelled_pending,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'READY'), 0)::int AS quantity_cancelled_ready,
      COALESCE(SUM(oic.quantity_cancelled), 0)::int AS quantity_cancelled_total
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  )
  SELECT
    oi.order_id,
    oi.id AS order_item_id,
    oi.description_snapshot,
    COALESCE(oi.status, 'SENT') AS item_status,
    oi.unit_price,
    COALESCE(oi.quantity, 0)::int AS quantity_ordered,
    COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
    COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
    GREATEST(
      0,
      COALESCE(r.quantity_ready_total, 0)
      - COALESCE(d.quantity_dispatched, 0)
      - COALESCE(c.quantity_cancelled_ready, 0)
    )::int AS quantity_ready_available,
    COALESCE(d.quantity_dispatched, 0)::int AS quantity_dispatched,
    COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
    COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
    COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
    GREATEST(
      0,
      COALESCE(oi.quantity, 0)
      - COALESCE(r.quantity_ready_total, 0)
      - COALESCE(c.quantity_cancelled_pending, 0)
    )::int AS quantity_pending_prepare
  FROM public.order_items oi
  LEFT JOIN paid p ON p.order_item_id = oi.id
  LEFT JOIN ready r ON r.order_item_id = oi.id
  LEFT JOIN dispatched d ON d.order_item_id = oi.id
  LEFT JOIN cancelled c ON c.order_item_id = oi.id
  WHERE oi.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.recompute_order_operational_state(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_status public.order_status;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched integer := 0;
  v_cancelled_total integer := 0;
  v_active_not_cancelled integer := 0;
  v_next_status public.order_status;
  v_last_ready_at timestamptz;
  v_last_dispatched_at timestamptz;
BEGIN
  SELECT status INTO v_order_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order_status = 'PAID' THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(quantity_pending_prepare), 0)::int,
    COALESCE(SUM(quantity_ready_available), 0)::int,
    COALESCE(SUM(quantity_dispatched), 0)::int,
    COALESCE(SUM(quantity_cancelled_total), 0)::int,
    COALESCE(SUM(quantity_ordered - quantity_cancelled_total), 0)::int
  INTO v_pending_prepare, v_ready_available, v_dispatched, v_cancelled_total, v_active_not_cancelled
  FROM public.get_order_operational_snapshot(p_order_id);

  SELECT MAX(ore.created_at)
  INTO v_last_ready_at
  FROM public.order_ready_events ore
  WHERE ore.order_id = p_order_id
    AND ore.status = 'APPLIED';

  SELECT MAX(ode.created_at)
  INTO v_last_dispatched_at
  FROM public.order_dispatch_events ode
  WHERE ode.order_id = p_order_id
    AND ode.status = 'APPLIED';

  IF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_next_status := 'CANCELLED';
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched > 0 THEN
    v_next_status := 'KITCHEN_DISPATCHED';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_next_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_next_status := 'SENT_TO_KITCHEN';
  ELSE
    v_next_status := v_order_status;
  END IF;

  UPDATE public.orders
  SET
    status = v_next_status,
    ready_at = COALESCE(v_last_ready_at, ready_at),
    dispatched_at = COALESCE(v_last_dispatched_at, dispatched_at),
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_quantities_ready(
  p_order_id uuid,
  p_ready_by uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_operation_type text DEFAULT 'partial',
  p_source_module text DEFAULT 'kitchen',
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
  v_prev_status public.order_status;
  v_new_status public.order_status;
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

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'La orden no permite marcar cantidades como listas';
  END IF;

  v_prev_status := v_order.status;

  CREATE TEMP TABLE tmp_ready_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_ready integer NOT NULL
  ) ON COMMIT DROP;

  IF p_operation_type = 'total' THEN
    INSERT INTO tmp_ready_targets (order_item_id, quantity_ready)
    SELECT order_item_id, quantity_pending_prepare
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE quantity_pending_prepare > 0;
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para listo parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_ready')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en listo';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad invalida para listo en item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_ready_targets (order_item_id, quantity_ready)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_ready = tmp_ready_targets.quantity_ready + EXCLUDED.quantity_ready;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_ready_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para marcar listas';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_ready FROM tmp_ready_targets
  LOOP
    SELECT quantity_pending_prepare
    INTO v_pending_prepare
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE order_item_id = v_target_order_item_id;

    IF v_pending_prepare IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > v_pending_prepare THEN
      RAISE EXCEPTION 'No puedes marcar listo mas cantidad de la pendiente para item %', v_target_order_item_id;
    END IF;
  END LOOP;

  INSERT INTO public.order_ready_events (
    order_id,
    event_type,
    created_by,
    source_module,
    notes,
    created_at
  ) VALUES (
    p_order_id,
    p_operation_type,
    p_ready_by,
    p_source_module,
    p_notes,
    v_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.order_item_ready_events (
    order_ready_event_id,
    order_id,
    order_item_id,
    quantity_ready,
    created_at
  )
  SELECT v_event_id, p_order_id, order_item_id, quantity_ready, v_now
  FROM tmp_ready_targets;

  UPDATE public.order_items oi
  SET
    ready_at = v_now,
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_order.sent_to_kitchen_at, v_now)
  WHERE oi.id IN (SELECT order_item_id FROM tmp_ready_targets);

  PERFORM public.recompute_order_operational_state(p_order_id);

  SELECT status INTO v_new_status
  FROM public.orders
  WHERE id = p_order_id;

  IF v_prev_status IS DISTINCT FROM 'READY' AND v_new_status = 'READY' THEN
    BEGIN
      INSERT INTO public.order_ready_notifications (order_id, created_at)
      VALUES (p_order_id, v_now);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;

  RETURN v_event_id;
END;
$$;

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
  v_ready_available integer;
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

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades';
  END IF;

  CREATE TEMP TABLE tmp_dispatch_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  IF p_operation_type = 'total' THEN
    INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
    SELECT order_item_id, quantity_ready_available
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE quantity_ready_available > 0;
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
    RAISE EXCEPTION 'No hay cantidades listas para despachar';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_dispatched FROM tmp_dispatch_targets
  LOOP
    SELECT quantity_ready_available
    INTO v_ready_available
    FROM public.get_order_operational_snapshot(p_order_id)
    WHERE order_item_id = v_target_order_item_id;

    IF v_ready_available IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > v_ready_available THEN
      RAISE EXCEPTION 'No puedes despachar mas cantidad de la lista para item %', v_target_order_item_id;
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
    created_at
  )
  SELECT v_event_id, p_order_id, order_item_id, quantity_dispatched, v_now
  FROM tmp_dispatch_targets;

  UPDATE public.order_items oi
  SET dispatched_at = v_now
  WHERE oi.id IN (SELECT order_item_id FROM tmp_dispatch_targets);

  PERFORM public.recompute_order_operational_state(p_order_id);

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_operational_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.recompute_order_operational_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_order_quantities_ready(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_quantities_ready(uuid, uuid, jsonb, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
