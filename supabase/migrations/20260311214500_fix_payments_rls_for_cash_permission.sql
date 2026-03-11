-- Align payments and payment_items RLS with branch permission model for Caja

DROP POLICY IF EXISTS "Authenticated can view payments" ON public.payments;
DROP POLICY IF EXISTS "Cajeros can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Cajeros can update payments" ON public.payments;
DROP POLICY IF EXISTS "Users can view payments by cash permission" ON public.payments;
DROP POLICY IF EXISTS "Users can insert payments by cash permission" ON public.payments;
DROP POLICY IF EXISTS "Users can update payments by cash permission" ON public.payments;

CREATE POLICY "Users can view payments by cash permission"
ON public.payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = payments.order_id
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

CREATE POLICY "Users can insert payments by cash permission"
ON public.payments
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.payment_methods pm ON pm.id = payment_method_id
    WHERE o.id = order_id
      AND pm.id = payment_method_id
      AND pm.branch_id = o.branch_id
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

CREATE POLICY "Users can update payments by cash permission"
ON public.payments
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = payments.order_id
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
)
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.payment_methods pm ON pm.id = payment_method_id
    WHERE o.id = order_id
      AND pm.id = payment_method_id
      AND pm.branch_id = o.branch_id
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

DROP POLICY IF EXISTS "Authenticated can view payment items" ON public.payment_items;
DROP POLICY IF EXISTS "Cajeros can insert payment items" ON public.payment_items;
DROP POLICY IF EXISTS "Cajeros can update payment items" ON public.payment_items;
DROP POLICY IF EXISTS "Users can view payment items by cash permission" ON public.payment_items;
DROP POLICY IF EXISTS "Users can insert payment items by cash permission" ON public.payment_items;
DROP POLICY IF EXISTS "Users can update payment items by cash permission" ON public.payment_items;

CREATE POLICY "Users can view payment items by cash permission"
ON public.payment_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE p.id = payment_items.payment_id
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

CREATE POLICY "Users can insert payment items by cash permission"
ON public.payment_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    JOIN public.order_items oi ON oi.id = order_item_id
    WHERE p.id = payment_id
      AND oi.id = order_item_id
      AND oi.order_id = o.id
      AND p.created_by = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

CREATE POLICY "Users can update payment items by cash permission"
ON public.payment_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE p.id = payment_items.payment_id
      AND p.created_by = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    JOIN public.order_items oi ON oi.id = order_item_id
    WHERE p.id = payment_id
      AND oi.id = order_item_id
      AND oi.order_id = o.id
      AND p.created_by = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), o.branch_id)
  )
);

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
