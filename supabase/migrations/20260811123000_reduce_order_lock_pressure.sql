-- =============================================================================
-- Reducir presión de locks en orders (Disk IO / blocked queries)
-- =============================================================================
-- 1) get_order_operational_snapshot: filtrar CTEs a ítems de la orden (como el batch).
--    Antes agregaba TODA la historia de payment_items/ready/dispatch/cancel y luego
--    filtraba en base → N scans globales bajo FOR UPDATE en cobro/despacho/sync.
-- 2) register_payment_with_items: una sola sync al final (GUC) en lugar de
--    sync por INSERT payments + sync por INSERT payment_items dentro del mismo lock.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Snapshot unitario acotado a la orden
-- ---------------------------------------------------------------------------
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target_items AS (
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ),
  paid AS (
    SELECT
      pi.order_item_id,
      COALESCE(SUM(pi.quantity_paid), 0)::int AS quantity_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id IN (SELECT id FROM target_items)
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
    GROUP BY pi.order_item_id
  ),
  ready AS (
    SELECT
      oire.order_item_id,
      COALESCE(SUM(oire.quantity_ready), 0)::int AS quantity_ready_total
    FROM public.order_item_ready_events oire
    JOIN public.order_ready_events ore ON ore.id = oire.order_ready_event_id
    WHERE oire.order_item_id IN (SELECT id FROM target_items)
      AND ore.status = 'APPLIED'
    GROUP BY oire.order_item_id
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'PENDING'), 0)::int AS quantity_dispatched_from_pending,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'READY'), 0)::int AS quantity_dispatched_from_ready
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode ON ode.id = oide.order_dispatch_event_id
    WHERE oide.order_item_id IN (SELECT id FROM target_items)
      AND ode.status = 'APPLIED'
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
    WHERE oic.order_item_id IN (SELECT id FROM target_items)
      AND oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  base AS (
    SELECT
      oi.order_id,
      oi.id AS order_item_id,
      oi.description_snapshot,
      COALESCE(oi.status, 'SENT') AS item_status,
      oi.unit_price,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
      COALESCE(d.quantity_dispatched_from_pending, 0)::int AS quantity_dispatched_from_pending,
      COALESCE(d.quantity_dispatched_from_ready, 0)::int AS quantity_dispatched_from_ready,
      COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
      COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
      COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
      COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    FROM target_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
  ),
  computed AS (
    SELECT
      base.*,
      GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)::int AS quantity_ready_total_effective,
      GREATEST(
        0,
        base.quantity_ordered
        - GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)
        - base.quantity_cancelled_pending
      )::int AS quantity_pending_prepare,
      GREATEST(
        0,
        GREATEST(base.quantity_ready_total, base.quantity_dispatched_total)
        - base.quantity_dispatched_total
        - base.quantity_cancelled_ready
      )::int AS quantity_ready_available
    FROM base
  )
  SELECT
    computed.order_id,
    computed.order_item_id,
    computed.description_snapshot,
    computed.item_status,
    computed.unit_price,
    computed.quantity_ordered,
    computed.quantity_paid,
    computed.quantity_ready_total,
    computed.quantity_ready_available,
    computed.quantity_dispatched_total,
    GREATEST(0, computed.quantity_pending_prepare + computed.quantity_ready_available)::int AS quantity_dispatched_available,
    computed.quantity_cancelled_pending,
    computed.quantity_cancelled_ready,
    computed.quantity_cancelled_dispatched,
    computed.quantity_cancelled_total,
    computed.quantity_pending_prepare
  FROM computed;
$$;

REVOKE ALL ON FUNCTION public.get_order_operational_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Helper: ¿suprimir sync en triggers de payments / payment_items?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_state_sync_suppressed()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.skip_payment_state_sync', true), ''), '0') = '1';
$$;

REVOKE ALL ON FUNCTION public.payment_state_sync_suppressed() FROM PUBLIC;

-- payments stmt triggers
CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM inserted_rows
    WHERE order_id IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM deleted_rows
    WHERE order_id IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM (
      SELECT order_id FROM old_rows
      UNION
      SELECT order_id FROM new_rows
    ) s
    WHERE order_id IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

-- payment_items stmt triggers
CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM inserted_rows AS ir
    INNER JOIN public.payments p ON p.id = ir.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM deleted_rows AS dr
    INNER JOIN public.payments p ON p.id = dr.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF public.payment_state_sync_suppressed() THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM (
      SELECT payment_id FROM old_rows
      UNION
      SELECT payment_id FROM new_rows
    ) s
    INNER JOIN public.payments p ON p.id = s.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Cobro atómico: sync una sola vez al final
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments jsonb,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_count int;
  v_existing_count int;
  v_payment_count int;
  v_item record;
  v_qty_item numeric;
  v_qty_already_paid numeric;
  v_qty_cancelled numeric;
  v_available numeric;
BEGIN
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'payments es obligatorio';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items es obligatorio';
  END IF;

  SELECT count(DISTINCT (p->>'order_id')::uuid)
  INTO v_order_count
  FROM jsonb_array_elements(p_payments) AS p;

  IF v_order_count <> 1 THEN
    RAISE EXCEPTION 'Todos los pagos deben pertenecer a la misma orden';
  END IF;

  SELECT (p->>'order_id')::uuid
  INTO v_order_id
  FROM jsonb_array_elements(p_payments) AS p
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio en payments';
  END IF;

  PERFORM 1
  FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  PERFORM 1
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id
    AND oi.id IN (
      SELECT DISTINCT (i->>'order_item_id')::uuid
      FROM jsonb_array_elements(p_items) AS i
    )
  FOR UPDATE;

  SELECT count(*)::int
  INTO v_payment_count
  FROM jsonb_array_elements(p_payments) AS p;

  SELECT count(*)::int
  INTO v_existing_count
  FROM jsonb_array_elements(p_payments) AS p
  WHERE EXISTS (
    SELECT 1
    FROM public.payments pay
    WHERE pay.id = (p->>'id')::uuid
  );

  IF v_existing_count = v_payment_count THEN
    RETURN;
  END IF;

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Pago parcial ya registrado; reintenta el cobro completo';
  END IF;

  FOR v_item IN
    SELECT
      (i->>'order_item_id')::uuid AS order_item_id,
      SUM(COALESCE((i->>'quantity_paid')::numeric, 0)) AS qty_requested
    FROM jsonb_array_elements(p_items) AS i
    GROUP BY 1
  LOOP
    IF v_item.order_item_id IS NULL THEN
      RAISE EXCEPTION 'order_item_id es obligatorio en items';
    END IF;

    IF v_item.qty_requested IS NULL OR v_item.qty_requested <= 0 THEN
      RAISE EXCEPTION 'Cantidad a cobrar invalida';
    END IF;

    SELECT oi.quantity::numeric
    INTO v_qty_item
    FROM public.order_items oi
    WHERE oi.id = v_item.order_item_id
      AND oi.order_id = v_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la orden', v_item.order_item_id;
    END IF;

    SELECT COALESCE(SUM(pi.quantity_paid), 0)
    INTO v_qty_already_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id = v_item.order_item_id
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed');

    SELECT COALESCE(SUM(oic.quantity_cancelled), 0)
    INTO v_qty_cancelled
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id = v_item.order_item_id
      AND oc.status = 'APPLIED';

    v_available := GREATEST(0, COALESCE(v_qty_item, 0) - COALESCE(v_qty_cancelled, 0) - COALESCE(v_qty_already_paid, 0));

    IF v_item.qty_requested > v_available + 0.0001 THEN
      RAISE EXCEPTION
        'No se puede cobrar % unidades del item; solo hay % pendientes',
        v_item.qty_requested,
        v_available;
    END IF;
  END LOOP;

  -- Evitar doble sync (payments + payment_items) bajo el mismo FOR UPDATE.
  PERFORM set_config('app.skip_payment_state_sync', '1', true);

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    banco_id,
    numero_transferencia,
    created_by,
    created_at
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    NULLIF(p->>'change_amount', '')::numeric,
    p->>'notes',
    NULLIF(p->>'banco_id', '')::uuid,
    NULLIF(TRIM(p->>'numero_transferencia'), ''),
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p;

  INSERT INTO public.payment_items (
    id,
    payment_id,
    order_item_id,
    quantity_paid,
    unit_price,
    total_amount
  )
  SELECT
    (i->>'id')::uuid,
    (i->>'payment_id')::uuid,
    (i->>'order_item_id')::uuid,
    (i->>'quantity_paid')::numeric,
    (i->>'unit_price')::numeric,
    (i->>'total_amount')::numeric
  FROM jsonb_array_elements(p_items) AS i;

  PERFORM set_config('app.skip_payment_state_sync', '0', true);
  PERFORM public.sync_order_payment_state_internal(v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
