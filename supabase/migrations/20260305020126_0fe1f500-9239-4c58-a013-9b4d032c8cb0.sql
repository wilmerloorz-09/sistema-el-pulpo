
CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_name text DEFAULT 'Dispositivo',
  transports text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credentials" ON public.webauthn_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own credentials" ON public.webauthn_credentials
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Service role full access" ON public.webauthn_credentials
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  type text NOT NULL DEFAULT 'registration',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on challenges" ON public.webauthn_challenges
  FOR ALL USING (true) WITH CHECK (true);
