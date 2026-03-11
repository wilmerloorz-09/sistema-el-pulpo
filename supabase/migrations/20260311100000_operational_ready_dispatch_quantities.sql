-- Operational quantities for READY and DISPATCH with partial traceability

ALTER TABLE public.order_item_cancellations
ADD COLUMN IF NOT EXISTS source_stage text NOT NULL DEFAULT 'PENDING'
CHECK (source_stage IN ('PENDING', 'READY'));

CREATE INDEX IF NOT EXISTS idx_order_item_cancellations_source_stage
  ON public.order_item_cancellations(order_item_id, source_stage);

CREATE TABLE IF NOT EXISTS public.order_ready_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('total', 'partial')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  source_module text NOT NULL CHECK (source_module IN ('kitchen', 'dispatch', 'orders', 'admin')),
  notes text,
  status text NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'VOIDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_item_ready_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ready_event_id uuid NOT NULL REFERENCES public.order_ready_events(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity_ready integer NOT NULL CHECK (quantity_ready > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_dispatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('total', 'partial')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  source_module text NOT NULL CHECK (source_module IN ('kitchen', 'dispatch', 'orders', 'admin')),
  notes text,
  status text NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'VOIDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_item_dispatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_dispatch_event_id uuid NOT NULL REFERENCES public.order_dispatch_events(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity_dispatched integer NOT NULL CHECK (quantity_dispatched > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_ready_events_order_id ON public.order_ready_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_ready_events_order_id ON public.order_item_ready_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_ready_events_order_item_id ON public.order_item_ready_events(order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_dispatch_events_order_id ON public.order_dispatch_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_dispatch_events_order_id ON public.order_item_dispatch_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_dispatch_events_order_item_id ON public.order_item_dispatch_events(order_item_id);

ALTER TABLE public.order_ready_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_ready_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_dispatch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_dispatch_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view ready events" ON public.order_ready_events;
CREATE POLICY "Authenticated can view ready events"
ON public.order_ready_events FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert ready events" ON public.order_ready_events;
CREATE POLICY "Staff can insert ready events"
ON public.order_ready_events FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view ready event lines" ON public.order_item_ready_events;
CREATE POLICY "Authenticated can view ready event lines"
ON public.order_item_ready_events FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert ready event lines" ON public.order_item_ready_events;
CREATE POLICY "Staff can insert ready event lines"
ON public.order_item_ready_events FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view dispatch events" ON public.order_dispatch_events;
CREATE POLICY "Authenticated can view dispatch events"
ON public.order_dispatch_events FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert dispatch events" ON public.order_dispatch_events;
CREATE POLICY "Staff can insert dispatch events"
ON public.order_dispatch_events FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view dispatch event lines" ON public.order_item_dispatch_events;
CREATE POLICY "Authenticated can view dispatch event lines"
ON public.order_item_dispatch_events FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert dispatch event lines" ON public.order_item_dispatch_events;
CREATE POLICY "Staff can insert dispatch event lines"
ON public.order_item_dispatch_events FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

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

REVOKE ALL ON FUNCTION public.get_order_operational_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;

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

REVOKE ALL ON FUNCTION public.recompute_order_operational_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;

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

REVOKE ALL ON FUNCTION public.mark_order_quantities_ready(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_quantities_ready(uuid, uuid, jsonb, text, text, text) TO authenticated;

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

REVOKE ALL ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) TO authenticated;

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
