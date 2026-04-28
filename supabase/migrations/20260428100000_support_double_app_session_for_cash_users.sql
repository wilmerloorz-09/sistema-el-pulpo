BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_app_secondary_session_id text,
  ADD COLUMN IF NOT EXISTS current_app_secondary_session_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_app_secondary_session_device text;

CREATE OR REPLACE FUNCTION public.user_has_double_app_session_permission(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    JOIN public.cash_shifts cs
      ON cs.id = csu.shift_id
    WHERE csu.user_id = p_user_id
      AND csu.is_enabled = true
      AND csu.can_use_caja = true
      AND csu.can_double_session = true
      AND cs.status = 'OPEN'
  );
$$;

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
  v_session_id text := btrim(coalesce(p_session_id, ''));
  v_device_label text := NULLIF(btrim(coalesce(p_device_label, '')), '');
  v_primary_session_id text;
  v_secondary_session_id text;
  v_can_double_session boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF v_session_id = '' THEN
    RAISE EXCEPTION 'Session id requerido';
  END IF;

  SELECT
    current_app_session_id,
    current_app_secondary_session_id
  INTO
    v_primary_session_id,
    v_secondary_session_id
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  v_can_double_session := public.user_has_double_app_session_permission(v_user_id);

  IF v_primary_session_id = v_session_id THEN
    UPDATE public.profiles
    SET current_app_session_started_at = now(),
        current_app_session_device = v_device_label,
        updated_at = now()
    WHERE id = v_user_id;
    RETURN;
  END IF;

  IF v_secondary_session_id = v_session_id THEN
    UPDATE public.profiles
    SET current_app_secondary_session_started_at = now(),
        current_app_secondary_session_device = v_device_label,
        updated_at = now()
    WHERE id = v_user_id;
    RETURN;
  END IF;

  IF NULLIF(btrim(coalesce(v_primary_session_id, '')), '') IS NULL THEN
    UPDATE public.profiles
    SET current_app_session_id = v_session_id,
        current_app_session_started_at = now(),
        current_app_session_device = v_device_label,
        updated_at = now()
    WHERE id = v_user_id;
    RETURN;
  END IF;

  IF v_can_double_session THEN
    IF NULLIF(btrim(coalesce(v_secondary_session_id, '')), '') IS NULL THEN
      UPDATE public.profiles
      SET current_app_secondary_session_id = v_session_id,
          current_app_secondary_session_started_at = now(),
          current_app_secondary_session_device = v_device_label,
          updated_at = now()
      WHERE id = v_user_id;
    ELSE
      UPDATE public.profiles
      SET current_app_secondary_session_id = v_session_id,
          current_app_secondary_session_started_at = now(),
          current_app_secondary_session_device = v_device_label,
          updated_at = now()
      WHERE id = v_user_id;
    END IF;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET current_app_session_id = v_session_id,
      current_app_session_started_at = now(),
      current_app_session_device = v_device_label,
      current_app_secondary_session_id = NULL,
      current_app_secondary_session_started_at = NULL,
      current_app_secondary_session_device = NULL,
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
  v_session_id text := NULLIF(btrim(coalesce(p_session_id, '')), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.profiles
  SET current_app_session_id = CASE
        WHEN v_session_id IS NULL OR current_app_session_id = v_session_id THEN NULL
        ELSE current_app_session_id
      END,
      current_app_session_started_at = CASE
        WHEN v_session_id IS NULL OR current_app_session_id = v_session_id THEN NULL
        ELSE current_app_session_started_at
      END,
      current_app_session_device = CASE
        WHEN v_session_id IS NULL OR current_app_session_id = v_session_id THEN NULL
        ELSE current_app_session_device
      END,
      current_app_secondary_session_id = CASE
        WHEN v_session_id IS NULL OR current_app_secondary_session_id = v_session_id THEN NULL
        ELSE current_app_secondary_session_id
      END,
      current_app_secondary_session_started_at = CASE
        WHEN v_session_id IS NULL OR current_app_secondary_session_id = v_session_id THEN NULL
        ELSE current_app_secondary_session_started_at
      END,
      current_app_secondary_session_device = CASE
        WHEN v_session_id IS NULL OR current_app_secondary_session_id = v_session_id THEN NULL
        ELSE current_app_secondary_session_device
      END,
      updated_at = now()
  WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_my_single_session(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_single_session(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
