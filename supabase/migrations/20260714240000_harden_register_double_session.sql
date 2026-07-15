-- Endurece registro de sesion doble:
-- 1) Reafirma permiso sin exigir can_use_caja
-- 2) Si ambos slots estan ocupados y llega una 3a sesion con permiso,
--    reemplaza la mas antigua (por started_at), no siempre la secundaria.
-- 3) Si no hay permiso doble, modo sesion unica (pisa primaria y limpia secundaria).

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
  v_primary_started_at timestamptz;
  v_secondary_started_at timestamptz;
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
    current_app_secondary_session_id,
    current_app_session_started_at,
    current_app_secondary_session_started_at
  INTO
    v_primary_session_id,
    v_secondary_session_id,
    v_primary_started_at,
    v_secondary_started_at
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
      RETURN;
    END IF;

    -- Ambos ocupados: reemplazar el slot mas antiguo
    IF COALESCE(v_secondary_started_at, 'epoch'::timestamptz)
         <= COALESCE(v_primary_started_at, 'epoch'::timestamptz) THEN
      UPDATE public.profiles
      SET current_app_secondary_session_id = v_session_id,
          current_app_secondary_session_started_at = now(),
          current_app_secondary_session_device = v_device_label,
          updated_at = now()
      WHERE id = v_user_id;
    ELSE
      UPDATE public.profiles
      SET current_app_session_id = v_session_id,
          current_app_session_started_at = now(),
          current_app_session_device = v_device_label,
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

GRANT EXECUTE ON FUNCTION public.register_my_single_session(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_double_app_session_permission(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
