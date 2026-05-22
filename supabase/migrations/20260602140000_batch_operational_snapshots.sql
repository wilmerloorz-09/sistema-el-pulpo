-- Un solo viaje de red para snapshots operativos de varias ordenes (modulo Despacho).
-- Columnas alineadas con get_order_operational_snapshot (20260407170000).

CREATE OR REPLACE FUNCTION public.get_orders_operational_snapshots(p_order_ids uuid[])
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
  SELECT
    snap.order_id,
    snap.order_item_id,
    snap.description_snapshot,
    snap.item_status,
    snap.unit_price,
    snap.quantity_ordered,
    snap.quantity_paid,
    snap.quantity_ready_total,
    snap.quantity_ready_available,
    snap.quantity_dispatched_total,
    snap.quantity_dispatched_available,
    snap.quantity_cancelled_pending,
    snap.quantity_cancelled_ready,
    snap.quantity_cancelled_dispatched,
    snap.quantity_cancelled_total,
    snap.quantity_pending_prepare
  FROM unnest(COALESCE(p_order_ids, ARRAY[]::uuid[])) AS input(order_id)
  CROSS JOIN LATERAL public.get_order_operational_snapshot(input.order_id) snap;
$$;

REVOKE ALL ON FUNCTION public.get_orders_operational_snapshots(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_operational_snapshots(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
