-- Corrige recursividad infinita en politica "Users can view shift members"
-- (EXISTS sobre cash_shift_users dentro de politica ON cash_shift_users).

DROP POLICY IF EXISTS "Users can view shift members" ON public.cash_shift_users;

CREATE POLICY "Users can view shift members"
ON public.cash_shift_users
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR public.user_has_enabled_open_shift_membership(shift_id, auth.uid())
);

NOTIFY pgrst, 'reload schema';
