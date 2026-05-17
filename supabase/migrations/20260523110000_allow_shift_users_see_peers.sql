-- Ampliar la politica SELECT de cash_shift_users para que cualquier
-- usuario habilitado en un turno pueda ver a TODOS los compañeros del turno.
-- Esto es necesario para que el dropdown "Pagos del turno" muestre todos los cajeros.

DROP POLICY IF EXISTS "Users can view own shift enablement" ON public.cash_shift_users;

CREATE POLICY "Users can view shift members"
ON public.cash_shift_users
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.cash_shift_users peer
    WHERE peer.shift_id = cash_shift_users.shift_id
      AND peer.user_id = auth.uid()
      AND peer.is_enabled = true
  )
);

NOTIFY pgrst, 'reload schema';
