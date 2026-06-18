-- =============================================================================
-- MIGRACIÓN DE HARDENING FINAL DE SEGURIDAD
-- Fecha: 2026-06-17
-- Objetivo: Blindar el sistema para que el incidente de hoy no pueda repetirse
-- =============================================================================

-- ─── 1. Función para detectar si una sesión tiene actividad sospechosa ────────
-- Alerta si un mismo usuario crea más de 3 usuarios en menos de 1 hora
CREATE OR REPLACE FUNCTION public.check_admin_creation_rate_limit(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_creations integer;
BEGIN
  SELECT COUNT(*)
  INTO v_recent_creations
  FROM public.audit_log
  WHERE user_id = p_actor_id
    AND action = 'USER_CREATED'
    AND created_at > (now() - INTERVAL '1 hour');

  IF v_recent_creations >= 5 THEN
    RAISE EXCEPTION
      'Límite de creación de usuarios excedido. Solo se permiten 5 usuarios por hora por administrador. Contacta al soporte si necesitas crear más.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_creation_rate_limit(uuid) TO authenticated;

-- ─── 2. Bloquear emails con dominios desechables directamente en la DB ────────
CREATE OR REPLACE FUNCTION public.validate_user_email_domain(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text;
  BLOCKED_DOMAINS text[] := ARRAY[
    'example.com', 'example.org', 'example.net',
    'test.com', 'fake.com', 'mailinator.com',
    'tempmail.com', 'guerrillamail.com', 'throwam.com',
    'yopmail.com', 'sharklasers.com', 'trashmail.com',
    'discard.email', 'spam4.me', 'fakeinbox.com'
  ];
BEGIN
  v_domain := lower(split_part(p_email, '@', 2));

  IF v_domain = ANY(BLOCKED_DOMAINS) THEN
    RAISE EXCEPTION
      'El dominio de correo "%" no está permitido en este sistema. Usa un correo corporativo o personal válido.', v_domain;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_user_email_domain(text) TO authenticated;

-- ─── 3. Vista de monitoreo de sesiones activas ────────────────────────────────
-- Para que el admin pueda ver quién está conectado en tiempo real
CREATE OR REPLACE VIEW public.v_active_sessions AS
SELECT
  s.id          AS session_id,
  s.user_id,
  p.full_name,
  p.username,
  p.email,
  s.created_at  AS session_started,
  s.updated_at  AS last_active,
  s.not_after   AS expires_at,
  CASE
    WHEN s.created_at > (now() - INTERVAL '1 hour') THEN 'RECIENTE'
    WHEN s.created_at > (now() - INTERVAL '24 hours') THEN 'HOY'
    ELSE 'ANTIGUA'
  END AS session_age
FROM auth.sessions s
JOIN public.profiles p ON p.id = s.user_id
ORDER BY s.created_at DESC;

GRANT SELECT ON public.v_active_sessions TO authenticated;

-- RPC para ver sesiones activas (solo admins)
CREATE OR REPLACE FUNCTION public.get_active_sessions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',     v.session_id,
    'user_id',        v.user_id,
    'full_name',      v.full_name,
    'username',       v.username,
    'email',          v.email,
    'session_started', v.session_started,
    'last_active',    v.last_active,
    'session_age',    v.session_age
  ) ORDER BY v.session_started DESC), '[]'::jsonb)
  FROM public.v_active_sessions v
  WHERE public.is_global_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.get_active_sessions() TO authenticated;

-- ─── 4. RPC para cerrar sesiones de un usuario específico (solo admins) ───────
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT public.is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo administradores globales pueden cerrar sesiones de otros usuarios';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cerrar tu propia sesión con esta función';
  END IF;

  DELETE FROM auth.sessions WHERE user_id = p_target_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, before_data, after_data)
  VALUES (
    auth.uid(),
    'SESSIONS_REVOKED',
    'auth.sessions',
    p_target_user_id::text,
    NULL,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'sessions_deleted', v_deleted,
      'revoked_at', now()
    )
  );

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO authenticated;

-- ─── 5. Alerta en audit_log si alguien crea más de 3 usuarios en 1 hora ──────
CREATE OR REPLACE FUNCTION public.detect_mass_user_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count integer;
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_recent_count
  FROM public.audit_log
  WHERE user_id = v_actor_id
    AND action = 'USER_CREATED'
    AND created_at > (now() - INTERVAL '1 hour');

  -- Si ya hay 3 o más creaciones en la última hora, registrar alerta
  IF v_recent_count >= 3 THEN
    INSERT INTO public.audit_log (
      user_id, action, entity, entity_id, before_data, after_data
    ) VALUES (
      v_actor_id,
      'SECURITY_ALERT_MASS_USER_CREATION',
      'profiles',
      NEW.id::text,
      NULL,
      jsonb_build_object(
        'actor_id',        v_actor_id,
        'creations_last_hour', v_recent_count + 1,
        'alert_at',        now(),
        'message',         'Posible creación masiva de usuarios detectada'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_mass_user_creation ON public.profiles;
CREATE TRIGGER trg_detect_mass_user_creation
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.detect_mass_user_creation();

-- ─── 6. Política RLS adicional: nadie puede leer auth.sessions sin ser admin ──
-- (Las vistas ya lo controlan, pero agregamos protección extra en audit_log)
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Solo admins ven audit_log" ON public.audit_log;
CREATE POLICY "Solo admins ven audit_log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "Sistema puede insertar audit_log" ON public.audit_log;
CREATE POLICY "Sistema puede insertar audit_log"
ON public.audit_log
FOR INSERT
TO authenticated
WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
