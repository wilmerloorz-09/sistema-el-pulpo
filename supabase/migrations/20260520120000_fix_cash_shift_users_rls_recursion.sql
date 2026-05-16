-- La politica de cash_shifts (20260519100000) usa EXISTS sobre cash_shift_users.
-- La politica ALL "Shift users can be managed by branch admins" usa EXISTS sobre cash_shifts.
-- Postgres evalua ambas rutas y puede entrar en recursividad infinita al leer cash_shift_users.

CREATE OR REPLACE FUNCTION public.user_has_enabled_open_shift_membership(p_shift_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_user_id
      AND csu.is_enabled = true
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_enabled_open_shift_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_enabled_open_shift_membership(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view cash shifts by permission" ON public.cash_shifts;

CREATE POLICY "Users can view cash shifts by permission"
ON public.cash_shifts
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_shift_admin(auth.uid(), branch_id)
  OR cashier_id = auth.uid()
  OR (
    status = 'OPEN'
    AND public.user_has_enabled_open_shift_membership(id, auth.uid())
  )
);

NOTIFY pgrst, 'reload schema';
