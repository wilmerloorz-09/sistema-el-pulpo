-- Track paid quantity per order item per payment (partial quantity payments)
CREATE TABLE IF NOT EXISTS public.payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity_paid NUMERIC(10,3) NOT NULL CHECK (quantity_paid > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_items_payment_id ON public.payment_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_order_item_id ON public.payment_items(order_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_items_payment_order_item
  ON public.payment_items(payment_id, order_item_id);

ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view payment items" ON public.payment_items;
CREATE POLICY "Authenticated can view payment items"
  ON public.payment_items
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Cajeros can insert payment items" ON public.payment_items;
CREATE POLICY "Cajeros can insert payment items"
  ON public.payment_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'cajero'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

DROP POLICY IF EXISTS "Cajeros can update payment items" ON public.payment_items;
CREATE POLICY "Cajeros can update payment items"
  ON public.payment_items
  FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'cajero'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );
