-- =============================================================================
-- Snapshot SQL alineado con orderOperational.ts (frontend)
-- =============================================================================
-- El frontend usa effectiveReadyTotal = max(readyTotal, dispatchedTotal) para
-- calcular pending. El SQL solo restaba ready_total real, dejando pending > 0
-- cuando hubo despacho sin eventos de "listo" (caso habitual en mesa pagada).
-- Resultado: UI mostraba todo despachado pero order_is_fully_dispatched = false
-- y las órdenes quedaban atascadas en PAID con mesa ocupada.

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
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
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
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'PENDING'), 0)::int AS quantity_dispatched_from_pending,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'READY'), 0)::int AS quantity_dispatched_from_ready
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
    FROM public.order_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
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
        - base.quantity_dispatched_from_pending
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

-- Solo ítems operativos (no borrador) cuentan para cierre.
CREATE OR REPLACE FUNCTION public.order_is_fully_dispatched(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH operational_items AS (
    SELECT oi.id AS order_item_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status <> 'DRAFT'
      AND COALESCE(oi.quantity, 0) > 0
  ),
  snap AS (
    SELECT s.*
    FROM public.get_order_operational_snapshot(p_order_id) s
    JOIN operational_items oi ON oi.order_item_id = s.order_item_id
  ),
  item_state AS (
    SELECT
      GREATEST(0, s.quantity_ordered - s.quantity_cancelled_total)::int AS active_qty,
      GREATEST(0, s.quantity_dispatched_total - s.quantity_cancelled_dispatched)::int AS dispatched_net,
      s.quantity_pending_prepare,
      s.quantity_ready_available
    FROM snap s
  )
  SELECT
    EXISTS (SELECT 1 FROM operational_items)
    AND NOT EXISTS (
      SELECT 1
      FROM item_state st
      WHERE st.active_qty > 0
        AND (
          st.quantity_pending_prepare > 0
          OR st.quantity_ready_available > 0
          OR st.dispatched_net < st.active_qty
        )
    );
$$;

-- Backfill: PAID + despacho completo (con snapshot corregido) → KITCHEN_DISPATCHED
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.status = 'PAID'
      AND o.paid_at IS NOT NULL
      AND COALESCE(o.is_special, false) IS NOT TRUE
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
      AND public.order_is_fully_dispatched(o.id)
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_operational_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
