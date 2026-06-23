-- =============================================================================
-- Prerequisito para 20260623190000: columna orders.total
-- (proyecto producción clonado sin esta columna en el esquema base)
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.total IS 'Total activo de la orden; sincronizado desde order_items.';

UPDATE public.orders o
SET total = COALESCE((
  SELECT SUM(GREATEST(0, oi.quantity) * oi.unit_price)
  FROM public.order_items oi
  WHERE oi.order_id = o.id
    AND (oi.status IS NULL OR oi.status <> 'CANCELLED')
), 0),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
);

NOTIFY pgrst, 'reload schema';
