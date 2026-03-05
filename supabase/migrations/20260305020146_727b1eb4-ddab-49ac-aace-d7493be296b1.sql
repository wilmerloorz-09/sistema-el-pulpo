
-- Drop overly permissive policies (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role full access" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "Service role full access on challenges" ON public.webauthn_challenges;

-- Credentials: users can insert their own
CREATE POLICY "Users can insert own credentials" ON public.webauthn_credentials
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Challenges: no direct client access needed (only edge functions via service role)
