-- =============================================================================
-- MIGRACIÓN DE SEGURIDAD: Auditoría de turnos y hardening de acceso
-- Fecha: 2026-06-17
-- Objetivo: 
--   1. Registrar en audit_log cada vez que se abre o cierra un turno
--   2. Registrar en audit_log cada vez que se crea un usuario desde auth.users
--   3. Agregar vista de auditoría de turnos para el panel de administración
--   4. Purgar los usuarios sospechosos con emails @elpulpo.com que son de seed
-- =============================================================================

-- ─── 1. Trigger de auditoría de apertura/cierre de turno ────────────────────
CREATE OR REPLACE FUNCTION public.audit_cash_shift_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (
      user_id,
      action,
      entity,
      entity_id,
      before_data,
      after_data
    )
    VALUES (
      NEW.cashier_id,
      'SHIFT_OPENED',
      'cash_shifts',
      NEW.id::text,
      NULL,
      jsonb_build_object(
        'shift_id',       NEW.id,
        'branch_id',      NEW.branch_id,
        'cashier_id',     NEW.cashier_id,
        'opened_at',      NEW.opened_at,
        'tables_count',   NEW.active_tables_count,
        'actor_auth_uid', auth.uid()
      )
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    INSERT INTO public.audit_log (
      user_id,
      action,
      entity,
      entity_id,
      before_data,
      after_data
    )
    VALUES (
      COALESCE(NEW.closed_by, auth.uid()),
      'SHIFT_CLOSED',
      'cash_shifts',
      NEW.id::text,
      jsonb_build_object(
        'status',         OLD.status,
        'opened_at',      OLD.opened_at
      ),
      jsonb_build_object(
        'shift_id',       NEW.id,
        'branch_id',      NEW.branch_id,
        'closed_at',      NEW.closed_at,
        'closed_by',      NEW.closed_by,
        'actor_auth_uid', auth.uid()
      )
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_cash_shift_change ON public.cash_shifts;
CREATE TRIGGER trg_audit_cash_shift_change
AFTER INSERT OR UPDATE OF status ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.audit_cash_shift_change();

-- ─── 2. Vista de auditoría de turnos para el panel admin ────────────────────
CREATE OR REPLACE VIEW public.v_audit_shifts AS
SELECT
  al.id          AS audit_id,
  al.created_at  AS event_at,
  al.action,
  al.entity_id   AS shift_id,
  p.full_name    AS actor_name,
  p.username     AS actor_username,
  p.email        AS actor_email,
  b.name         AS branch_name,
  al.before_data,
  al.after_data
FROM public.audit_log al
LEFT JOIN public.profiles p ON p.id = al.user_id
LEFT JOIN public.branches b ON b.id = (al.after_data->>'branch_id')::uuid
WHERE al.entity = 'cash_shifts'
  AND al.action IN ('SHIFT_OPENED', 'SHIFT_CLOSED')
ORDER BY al.created_at DESC;

GRANT SELECT ON public.v_audit_shifts TO authenticated;

-- ─── 3. Vista de auditoría de usuarios creados ──────────────────────────────
CREATE OR REPLACE VIEW public.v_audit_user_creations AS
SELECT
  al.id          AS audit_id,
  al.created_at  AS event_at,
  al.action,
  al.entity_id   AS target_user_id,
  p_actor.full_name  AS created_by_name,
  p_actor.username   AS created_by_username,
  p_actor.email      AS created_by_email,
  p_target.full_name AS new_user_name,
  p_target.username  AS new_user_username,
  p_target.email     AS new_user_email,
  al.after_data
FROM public.audit_log al
LEFT JOIN public.profiles p_actor  ON p_actor.id  = al.user_id
LEFT JOIN public.profiles p_target ON p_target.id = al.entity_id::uuid
WHERE al.entity IN ('auth.users', 'profiles')
  AND al.action IN (
    'USER_CREATED',
    'RESET_USERS_AND_BOOTSTRAP_SUPERADMIN',
    'SEED_USERS_EXECUTED',
    'BOOTSTRAP_INITIAL_SUPERADMIN'
  )
ORDER BY al.created_at DESC;

GRANT SELECT ON public.v_audit_user_creations TO authenticated;

-- ─── 4. Función RPC para consultar auditoría de turnos (solo admins) ─────────
CREATE OR REPLACE FUNCTION public.get_shift_audit_log(
  p_branch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  audit_id       uuid,
  event_at       timestamptz,
  action         text,
  shift_id       text,
  actor_name     text,
  actor_username text,
  actor_email    text,
  branch_name    text,
  before_data    jsonb,
  after_data     jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo administradores globales pueden consultar el log de auditoría de turnos';
  END IF;

  RETURN QUERY
  SELECT
    v.audit_id,
    v.event_at,
    v.action,
    v.shift_id,
    v.actor_name,
    v.actor_username,
    v.actor_email,
    v.branch_name,
    v.before_data,
    v.after_data
  FROM public.v_audit_shifts v
  WHERE (p_branch_id IS NULL OR v.after_data->>'branch_id' = p_branch_id::text)
  ORDER BY v.event_at DESC
  LIMIT COALESCE(LEAST(p_limit, 200), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_audit_log(uuid, integer) TO authenticated;

-- ─── 5. Función RPC para consultar auditoría de usuarios (solo admins) ───────
CREATE OR REPLACE FUNCTION public.get_user_creation_audit_log(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  audit_id           uuid,
  event_at           timestamptz,
  action             text,
  created_by_name    text,
  created_by_email   text,
  new_user_name      text,
  new_user_username  text,
  new_user_email     text,
  after_data         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo administradores globales pueden consultar el log de auditoría de usuarios';
  END IF;

  RETURN QUERY
  SELECT
    v.audit_id,
    v.event_at,
    v.action,
    v.created_by_name,
    v.created_by_email,
    v.new_user_name,
    v.new_user_username,
    v.new_user_email,
    v.after_data
  FROM public.v_audit_user_creations v
  ORDER BY v.event_at DESC
  LIMIT COALESCE(LEAST(p_limit, 200), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_creation_audit_log(integer) TO authenticated;

-- ─── 6. Registrar en audit_log la creación de usuarios vía Edge Function ─────
-- (La Edge Function create-user ya registra esto con SECURITY DEFINER via RPC,
--  pero se añade un trigger en profiles para capturar cualquier inserción directa)

CREATE OR REPLACE FUNCTION public.audit_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo auditar si NO es resultado de un admin bootstrap o reset
  -- (esos se auto-registran en audit_log con su propio action)
  INSERT INTO public.audit_log (
    user_id,
    action,
    entity,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    auth.uid(),
    'USER_CREATED',
    'profiles',
    NEW.id::text,
    NULL,
    jsonb_build_object(
      'profile_id',     NEW.id,
      'username',       NEW.username,
      'email',          NEW.email,
      'full_name',      NEW.full_name,
      'actor_auth_uid', auth.uid(),
      'created_at',     now()
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_new_profile ON public.profiles;
CREATE TRIGGER trg_audit_new_profile
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.audit_new_profile();

-- ─── 7. Identificar y eliminar usuarios de seed (@elpulpo.com) creados sin autorización ─
-- NOTA: Ejecutar con precaución. Identifica primero, luego borra.

-- Vista de inspección: usuarios de seed sospechosos
CREATE OR REPLACE VIEW public.v_seed_suspicious_users AS
SELECT
  p.id,
  p.full_name,
  p.username,
  p.email,
  p.created_at,
  p.is_active,
  p.is_protected_superadmin
FROM public.profiles p
WHERE (
  p.email ILIKE '%@elpulpo.com'
  OR p.username ILIKE 'mesero%'
  OR p.username ILIKE 'cajero%'
  OR p.username ILIKE 'cocina%'
  OR p.username = 'superuser'
  OR p.full_name ILIKE 'workflow%'
  OR p.full_name ILIKE 'gas%'
  OR p.full_name ILIKE 'grader%'
  OR p.full_name ILIKE 'usuario de%'
  OR p.full_name ILIKE 'usuario%'
  OR p.username ILIKE 'workflow%'
)
AND p.is_protected_superadmin = false
ORDER BY p.created_at DESC;

GRANT SELECT ON public.v_seed_suspicious_users TO authenticated;

-- RPC para que el admin consulte los usuarios sospechosos
CREATE OR REPLACE FUNCTION public.list_suspicious_seed_users()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           v.id,
    'full_name',    v.full_name,
    'username',     v.username,
    'email',        v.email,
    'created_at',   v.created_at,
    'is_active',    v.is_active
  ) ORDER BY v.created_at DESC), '[]'::jsonb)
  FROM public.v_seed_suspicious_users v
  WHERE public.is_global_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.list_suspicious_seed_users() TO authenticated;

NOTIFY pgrst, 'reload schema';
