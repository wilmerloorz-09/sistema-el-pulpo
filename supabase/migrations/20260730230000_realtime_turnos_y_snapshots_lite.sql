-- =============================================================================
-- Egress / Realtime: publicar turnos + denormalizar sucursal en order_items
-- =============================================================================
-- 1) Publica cash_shifts / cash_shift_users / payments / order_dispatch_events
--    para invalidar el gate y Caja sin polling agresivo.
-- 2) Añade order_items.sucursal_id (español) sincronizado desde orders.branch_id
--    para filtrar Realtime por sucursal (antes el canal recibía todos los ítems).
-- 3) RPC ligera get_orders_operational_snapshots_lite: solo cantidades (sin
--    description/status/price) para listas Caja/Despacho/Cocina.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Publicación Realtime
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_shifts',
    'cash_shift_users',
    'payments',
    'order_dispatch_events',
    'order_items'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. order_items.sucursal_id (filtro Realtime por sucursal)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.branches(id);

COMMENT ON COLUMN public.order_items.sucursal_id IS
  'Denormalizado desde orders.branch_id para filtrar Realtime por sucursal.';

UPDATE public.order_items oi
SET sucursal_id = o.branch_id
FROM public.orders o
WHERE oi.order_id = o.id
  AND (oi.sucursal_id IS DISTINCT FROM o.branch_id);

CREATE INDEX IF NOT EXISTS idx_order_items_sucursal_id
  ON public.order_items (sucursal_id);

CREATE OR REPLACE FUNCTION public.order_items_set_sucursal_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT o.branch_id INTO NEW.sucursal_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_set_sucursal_id ON public.order_items;
CREATE TRIGGER trg_order_items_set_sucursal_id
  BEFORE INSERT OR UPDATE OF order_id ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.order_items_set_sucursal_id();

-- Si se mueve una orden de sucursal (raro), re-sincronizar ítems.
CREATE OR REPLACE FUNCTION public.orders_sync_items_sucursal_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    UPDATE public.order_items
    SET sucursal_id = NEW.branch_id
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_items_sucursal_id ON public.orders;
CREATE TRIGGER trg_orders_sync_items_sucursal_id
  AFTER UPDATE OF branch_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_sync_items_sucursal_id();

-- ---------------------------------------------------------------------------
-- 3. Snapshot operativo ligero (compatible; no reemplaza la RPC completa)
-- ---------------------------------------------------------------------------
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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    snap.order_id,
    snap.order_item_id,
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

REVOKE ALL ON FUNCTION public.get_orders_operational_snapshots_lite(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_operational_snapshots_lite(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
