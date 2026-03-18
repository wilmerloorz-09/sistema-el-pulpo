DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.order_item_cancellations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source_stage%'
  LOOP
    EXECUTE format('ALTER TABLE public.order_item_cancellations DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END
$$;

ALTER TABLE public.order_item_cancellations
  ADD CONSTRAINT order_item_cancellations_source_stage_check
  CHECK (source_stage IN ('PENDING', 'READY', 'DISPATCHED'));

DROP FUNCTION IF EXISTS public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.recompute_order_operational_state(uuid);
DROP FUNCTION IF EXISTS public.get_order_operational_snapshot(uuid);

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
  quantity_dispatched_total integer,
  quantity_dispatched_available integer,
  quantity_cancelled_pending integer,
  quantity_cancelled_ready integer,
  quantity_cancelled_dispatched integer,
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
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total
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
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'DISPATCHED'), 0)::int AS quantity_cancelled_dispatched,
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
      - COALESCE(d.quantity_dispatched_total, 0)
      - COALESCE(c.quantity_cancelled_ready, 0)
    )::int AS quantity_ready_available,
    COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
    GREATEST(
      0,
      COALESCE(d.quantity_dispatched_total, 0)
      - COALESCE(c.quantity_cancelled_dispatched, 0)
    )::int AS quantity_dispatched_available,
    COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
    COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
    COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
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
  v_dispatched_available integer := 0;
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
    COALESCE(SUM(quantity_dispatched_available), 0)::int,
    COALESCE(SUM(quantity_cancelled_total), 0)::int,
    COALESCE(SUM(quantity_ordered - quantity_cancelled_total), 0)::int
  INTO v_pending_prepare, v_ready_available, v_dispatched_available, v_cancelled_total, v_active_not_cancelled
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
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched_available > 0 THEN
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
    ready_at = CASE
      WHEN v_next_status IN ('READY', 'KITCHEN_DISPATCHED', 'PAID') THEN COALESCE(ready_at, v_last_ready_at, now())
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_next_status IN ('KITCHEN_DISPATCHED', 'PAID') THEN COALESCE(dispatched_at, v_last_dispatched_at, now())
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN v_next_status = 'CANCELLED' THEN COALESCE(cancelled_at, now())
      ELSE cancelled_at
    END,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

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
  v_dispatched_available integer;
  v_unit_price numeric;
  v_current_item_status text;
  v_cancel_pending integer;
  v_cancel_ready integer;
  v_cancel_dispatched integer;
  v_remaining integer;
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
      snapshot.order_item_id,
      snapshot.quantity_pending_prepare + snapshot.quantity_ready_available + snapshot.quantity_dispatched_available
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.quantity_pending_prepare + snapshot.quantity_ready_available + snapshot.quantity_dispatched_available > 0;
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
      snapshot.quantity_dispatched_available,
      snapshot.unit_price,
      snapshot.item_status
    INTO v_paid_qty, v_pending_prepare, v_ready_available, v_dispatched_available, v_unit_price, v_current_item_status
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_current_item_status IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > (v_pending_prepare + v_ready_available + v_dispatched_available) THEN
      RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    IF v_current_item_status = 'PAID' OR v_paid_qty > 0 AND (v_pending_prepare + v_ready_available + v_dispatched_available) <= 0 THEN
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
      snapshot.quantity_dispatched_available,
      snapshot.unit_price
    INTO v_pending_prepare, v_ready_available, v_dispatched_available, v_unit_price
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    v_cancel_pending := LEAST(v_target_qty, v_pending_prepare);
    v_remaining := GREATEST(0, v_target_qty - v_cancel_pending);
    v_cancel_ready := LEAST(v_remaining, v_ready_available);
    v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
    v_cancel_dispatched := LEAST(v_remaining, v_dispatched_available);

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
    updated_at = v_now,
    cancel_requested_by = NULL,
    cancel_requested_at = NULL
  WHERE id = p_order_id;

  RETURN v_cancellation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
