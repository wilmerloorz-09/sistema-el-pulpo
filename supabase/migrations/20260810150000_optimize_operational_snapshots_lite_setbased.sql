-- =============================================================================
-- get_orders_operational_snapshots_lite: mismo plan set-based que el batch
-- completo (20260725140000), sin description/status/price.
-- =============================================================================
-- Antes: CROSS JOIN LATERAL get_order_operational_snapshot por cada order_id
-- → N planes SQL por lista (Cocina/Despacho/Caja).
-- Ahora: un solo plan agregado sobre order_items del array.
-- Firma y columnas de retorno: sin cambios (cliente no se toca).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_orders_operational_snapshots_lite(p_order_ids uuid[])
RETURNS TABLE (
  order_id uuid,
  order_item_id uuid,
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
    WHERE oi.order_id = ANY (COALESCE(p_order_ids, ARRAY[]::uuid[]))
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
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
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

REVOKE ALL ON FUNCTION public.get_orders_operational_snapshots_lite(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_operational_snapshots_lite(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
