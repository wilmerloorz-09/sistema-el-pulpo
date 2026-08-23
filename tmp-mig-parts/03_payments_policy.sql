DROP POLICY IF EXISTS "Users can view payments by cash permission" ON public.payments;
CREATE POLICY "Users can view payments by cash permission"
ON public.payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = payments.order_id
      AND (
        public.can_operate_cash_branch(auth.uid(), o.branch_id)
        OR public.can_view_branch_admin(auth.uid(), o.branch_id)
      )
  )
);
