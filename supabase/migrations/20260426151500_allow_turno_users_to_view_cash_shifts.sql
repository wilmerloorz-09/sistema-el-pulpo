DROP POLICY IF EXISTS "Users can view cash shifts by permission" ON public.cash_shifts;
CREATE POLICY "Users can view cash shifts by permission"
ON public.cash_shifts
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_shift_admin(auth.uid(), branch_id)
  OR cashier_id = auth.uid()
);

NOTIFY pgrst, 'reload schema';
