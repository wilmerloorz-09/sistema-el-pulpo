-- Allow users to update their own session control record in cash_shift_users
-- This is required for the "Take Control" mechanism in the Caja module.

DROP POLICY IF EXISTS "Users can update their own session control" ON public.cash_shift_users;
CREATE POLICY "Users can update their own session control"
ON public.cash_shift_users
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Ensure they can also select it (policy already exists, but re-asserting for clarity)
DROP POLICY IF EXISTS "Users can view own shift enablement" ON public.cash_shift_users;
CREATE POLICY "Users can view own shift enablement"
ON public.cash_shift_users
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
