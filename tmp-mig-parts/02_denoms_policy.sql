DROP POLICY IF EXISTS "Users can view cash shift denoms by permission" ON public.cash_shift_denoms;
CREATE POLICY "Users can view cash shift denoms by permission"
ON public.cash_shift_denoms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_denoms.shift_id
      AND (
        public.can_operate_cash_branch(auth.uid(), cs.branch_id)
        OR public.can_view_branch_admin(auth.uid(), cs.branch_id)
        OR cs.cashier_id = auth.uid()
      )
  )
);
