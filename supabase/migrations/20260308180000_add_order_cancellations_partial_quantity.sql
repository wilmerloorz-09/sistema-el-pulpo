-- Cancellation by quantity (partial/total) with full traceability

CREATE TABLE IF NOT EXISTS public.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  cancellation_type text NOT NULL CHECK (cancellation_type IN ('total', 'partial')),
  reason text NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'VOIDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_item_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_cancellation_id uuid NOT NULL REFERENCES public.order_cancellations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity_cancelled integer NOT NULL CHECK (quantity_cancelled > 0),
  unit_price numeric(10,2) NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_cancellations_order_id ON public.order_cancellations(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_cancellations_order_id ON public.order_item_cancellations(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_cancellations_order_item_id ON public.order_item_cancellations(order_item_id);

ALTER TABLE public.order_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view order cancellations" ON public.order_cancellations;
CREATE POLICY "Authenticated can view order cancellations"
ON public.order_cancellations
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert order cancellations" ON public.order_cancellations;
CREATE POLICY "Staff can insert order cancellations"
ON public.order_cancellations
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view order item cancellations" ON public.order_item_cancellations;
CREATE POLICY "Authenticated can view order item cancellations"
ON public.order_item_cancellations
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert order item cancellations" ON public.order_item_cancellations;
CREATE POLICY "Staff can insert order item cancellations"
ON public.order_item_cancellations
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid()));

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
  v_paid_qty numeric;
  v_cancelled_qty numeric;
  v_pending_active numeric;
  v_unit_price numeric;
  v_current_item_status text;
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
      oi.id,
      GREATEST(
        0,
        oi.quantity
        - COALESCE((
          SELECT SUM(pi.quantity_paid)
          FROM public.payment_items pi
          JOIN public.payments p ON p.id = pi.payment_id
          WHERE pi.order_item_id = oi.id
            AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
            AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
        ), 0)
        - COALESCE((
          SELECT SUM(oic.quantity_cancelled)
          FROM public.order_item_cancellations oic
          JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
          WHERE oic.order_item_id = oi.id
            AND oc.status = 'APPLIED'
        ), 0)
      )::int AS pending_active
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status <> 'CANCELLED';

    DELETE FROM tmp_cancel_targets WHERE quantity_cancelled <= 0;
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
    PERFORM 1
    FROM public.order_items oi
    WHERE oi.id = v_target_order_item_id
      AND oi.order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    SELECT
      oi.unit_price,
      oi.status,
      COALESCE((
        SELECT SUM(pi.quantity_paid)
        FROM public.payment_items pi
        JOIN public.payments p ON p.id = pi.payment_id
        WHERE pi.order_item_id = oi.id
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      ), 0),
      COALESCE((
        SELECT SUM(oic.quantity_cancelled)
        FROM public.order_item_cancellations oic
        JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
        WHERE oic.order_item_id = oi.id
          AND oc.status = 'APPLIED'
      ), 0)
    INTO v_unit_price, v_current_item_status, v_paid_qty, v_cancelled_qty
    FROM public.order_items oi
    WHERE oi.id = v_target_order_item_id;

    v_pending_active := GREATEST(0, (
      (SELECT quantity FROM public.order_items WHERE id = v_target_order_item_id)
      - v_paid_qty
      - v_cancelled_qty
    ));

    IF v_target_qty > v_pending_active THEN
      RAISE EXCEPTION 'No puedes cancelar mas cantidad de la pendiente activa para item %', v_target_order_item_id;
    END IF;

    IF v_current_item_status = 'PAID' THEN
      RAISE EXCEPTION 'No puedes cancelar un item en estado PAID';
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

  INSERT INTO public.order_item_cancellations (
    order_cancellation_id,
    order_id,
    order_item_id,
    quantity_cancelled,
    unit_price,
    total_amount,
    created_at
  )
  SELECT
    v_cancellation_id,
    p_order_id,
    t.order_item_id,
    t.quantity_cancelled,
    oi.unit_price,
    ROUND((t.quantity_cancelled * oi.unit_price)::numeric, 2),
    v_now
  FROM tmp_cancel_targets t
  JOIN public.order_items oi ON oi.id = t.order_item_id;

  UPDATE public.order_items oi
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancelled_by = p_cancelled_by,
    cancellation_reason = btrim(p_reason),
    cancelled_from_status = COALESCE(oi.status, 'DRAFT')
  WHERE oi.id IN (
    SELECT t.order_item_id
    FROM tmp_cancel_targets t
    WHERE t.quantity_cancelled >= (
      oi.quantity
      - COALESCE((
        SELECT SUM(pi.quantity_paid)
        FROM public.payment_items pi
        JOIN public.payments p ON p.id = pi.payment_id
        WHERE pi.order_item_id = oi.id
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      ), 0)
    )
  );

  UPDATE public.orders o
  SET total = COALESCE((
    SELECT SUM(
      GREATEST(
        0,
        oi.quantity
        - COALESCE((
          SELECT SUM(oic.quantity_cancelled)
          FROM public.order_item_cancellations oic
          JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
          WHERE oic.order_item_id = oi.id
            AND oc.status = 'APPLIED'
        ), 0)
      ) * oi.unit_price
    )
    FROM public.order_items oi
    WHERE oi.order_id = o.id
  ), 0),
  updated_at = v_now
  WHERE o.id = p_order_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (
        oi.quantity
        - COALESCE((
          SELECT SUM(pi.quantity_paid)
          FROM public.payment_items pi
          JOIN public.payments p ON p.id = pi.payment_id
          WHERE pi.order_item_id = oi.id
            AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
            AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
        ), 0)
        - COALESCE((
          SELECT SUM(oic.quantity_cancelled)
          FROM public.order_item_cancellations oic
          JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
          WHERE oic.order_item_id = oi.id
            AND oc.status = 'APPLIED'
        ), 0)
      ) > 0
  ) THEN
    UPDATE public.orders
    SET
      status = 'CANCELLED',
      cancelled_at = v_now,
      cancelled_by = p_cancelled_by,
      cancellation_reason = btrim(p_reason),
      cancelled_from_status = v_order.status,
      paid_at = NULL,
      updated_at = v_now
    WHERE id = p_order_id;
  END IF;

  RETURN v_cancellation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) TO authenticated;
