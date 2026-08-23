DROP POLICY IF EXISTS "Users can view cash register openings" ON public.cash_register_openings;
CREATE POLICY "Users can view cash register openings"
ON public.cash_register_openings
FOR SELECT
TO authenticated
USING (
  public.can_view_branch_admin(auth.uid(), branch_id)
  OR public.can_manage_shift_admin(auth.uid(), branch_id)
  OR cashier_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = cash_register_openings.shift_id
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
  )
);
