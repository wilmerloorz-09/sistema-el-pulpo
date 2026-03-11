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

GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;
SELECT pg_notify('pgrst', 'reload schema');
