-- Usuario operativo habilitado en el turno (cash_shift_users) pero sin user_branches
-- no cumple can_operate_cash_branch y no puede leer cash_shifts en el cliente.
--
-- IMPORTANTE: el EXISTS directo contra cash_shift_users dentro de esta politica causa
-- recursividad infinita RLS porque "Shift users can be managed..." en cash_shift_users
-- consulta cash_shifts de nuevo. Se usa funcion SECURITY DEFINER para cortar el ciclo.

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
