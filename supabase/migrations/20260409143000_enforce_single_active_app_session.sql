BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_app_session_id text,
  ADD COLUMN IF NOT EXISTS current_app_session_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_app_session_device text;

CREATE OR REPLACE FUNCTION public.register_my_single_session(
  p_session_id text,
  p_device_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Session id requerido';
  END IF;

  UPDATE public.profiles
  SET current_app_session_id = btrim(p_session_id),
      current_app_session_started_at = now(),
      current_app_session_device = NULLIF(btrim(coalesce(p_device_label, '')), ''),
      updated_at = now()
  WHERE id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_my_single_session(
  p_session_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.profiles
  SET current_app_session_id = NULL,
      current_app_session_started_at = NULL,
      current_app_session_device = NULL,
      updated_at = now()
  WHERE id = v_user_id
    AND (
      p_session_id IS NULL
      OR current_app_session_id = btrim(p_session_id)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_my_single_session(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_single_session(text) TO authenticated;

COMMIT;
