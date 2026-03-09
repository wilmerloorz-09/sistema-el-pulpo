-- Protect initial superadmin + support login by username/email mapping via profiles.email

-- 1) Profiles extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS is_protected_superadmin boolean NOT NULL DEFAULT false;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND (p.email IS NULL OR p.email <> u.email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique_ci
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- Keep module catalog aligned for admin global control
INSERT INTO public.modules (code, name, description, is_active)
VALUES ('sucursales', 'Sucursales', 'Gestion de sucursales del sistema', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

-- 2) Keep profile email synced on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario'),
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      username = COALESCE(public.profiles.username, EXCLUDED.username),
      updated_at = now();

  RETURN NEW;
END;
$$;

-- 3) Bypass detector for exceptional service operations
CREATE OR REPLACE FUNCTION public.is_system_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
      OR current_user IN ('postgres', 'supabase_auth_admin', 'supabase_admin');
$$;

-- 4) Protected superadmin rules
CREATE OR REPLACE FUNCTION public.protect_superadmin_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_system_bypass() THEN
    RETURN NEW;
  END IF;

  IF OLD.is_protected_superadmin THEN
    IF NEW.is_protected_superadmin IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'No se puede remover proteccion del superadmin inicial en operacion normal';
    END IF;

    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'No se puede desactivar el superadmin inicial';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_superadmin_profile_changes ON public.profiles;
CREATE TRIGGER trg_protect_superadmin_profile_changes
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_profile_changes();

CREATE OR REPLACE FUNCTION public.protect_superadmin_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_system_bypass() THEN
    RETURN OLD;
  END IF;

  IF OLD.is_protected_superadmin THEN
    RAISE EXCEPTION 'No se puede eliminar el superadmin inicial en operacion normal';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_superadmin_profile_delete ON public.profiles;
CREATE TRIGGER trg_protect_superadmin_profile_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_profile_delete();

CREATE OR REPLACE FUNCTION public.protect_superadmin_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_protected boolean := false;
BEGIN
  IF public.is_system_bypass() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT p.is_protected_superadmin INTO v_is_protected
    FROM public.profiles p
    WHERE p.id = OLD.user_id;

    IF v_is_protected AND OLD.role = 'superadmin'::public.app_role THEN
      RAISE EXCEPTION 'No se puede remover el rol superadmin del superadmin inicial';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT p.is_protected_superadmin INTO v_is_protected
    FROM public.profiles p
    WHERE p.id = OLD.user_id;

    IF v_is_protected AND OLD.role = 'superadmin'::public.app_role AND NEW.role <> 'superadmin'::public.app_role THEN
      RAISE EXCEPTION 'No se puede degradar el superadmin inicial';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_superadmin_role_delete ON public.user_roles;
CREATE TRIGGER trg_protect_superadmin_role_delete
BEFORE DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_role_changes();

DROP TRIGGER IF EXISTS trg_protect_superadmin_role_update ON public.user_roles;
CREATE TRIGGER trg_protect_superadmin_role_update
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_role_changes();

CREATE OR REPLACE FUNCTION public.protect_superadmin_critical_modules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_protected boolean := false;
  v_module_code text;
BEGIN
  IF public.is_system_bypass() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT p.is_protected_superadmin, m.code
      INTO v_is_protected, v_module_code
    FROM public.profiles p
    JOIN public.modules m ON m.id = OLD.module_id
    WHERE p.id = OLD.user_id;

    IF v_is_protected AND v_module_code IN ('sucursales', 'usuarios', 'configuracion') AND OLD.is_active THEN
      RAISE EXCEPTION 'No se puede remover modulo critico al superadmin inicial';
    END IF;

    RETURN OLD;
  END IF;

  SELECT p.is_protected_superadmin, m.code
    INTO v_is_protected, v_module_code
  FROM public.profiles p
  JOIN public.modules m ON m.id = NEW.module_id
  WHERE p.id = NEW.user_id;

  IF v_is_protected
     AND v_module_code IN ('sucursales', 'usuarios', 'configuracion')
     AND OLD.is_active = true
     AND NEW.is_active = false THEN
    RAISE EXCEPTION 'No se puede desactivar modulo critico al superadmin inicial';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_superadmin_modules_update ON public.user_branch_modules;
CREATE TRIGGER trg_protect_superadmin_modules_update
BEFORE UPDATE ON public.user_branch_modules
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_critical_modules();

DROP TRIGGER IF EXISTS trg_protect_superadmin_modules_delete ON public.user_branch_modules;
CREATE TRIGGER trg_protect_superadmin_modules_delete
BEFORE DELETE ON public.user_branch_modules
FOR EACH ROW
EXECUTE FUNCTION public.protect_superadmin_critical_modules();

-- 5) Helper to bootstrap a protected initial superadmin
CREATE OR REPLACE FUNCTION public.bootstrap_initial_superadmin(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_admin_or_superadmin(v_actor) THEN
    RAISE EXCEPTION 'Solo admin/superadmin puede ejecutar bootstrap de superadmin inicial';
  END IF;

  UPDATE public.profiles
  SET is_protected_superadmin = false
  WHERE is_protected_superadmin = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_target_user_id, 'superadmin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET is_active = true,
      is_protected_superadmin = true,
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, before_data, after_data)
  VALUES (
    v_actor,
    'BOOTSTRAP_INITIAL_SUPERADMIN',
    'profiles',
    p_target_user_id::text,
    NULL,
    jsonb_build_object('is_protected_superadmin', true, 'reason', p_reason)
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_initial_superadmin(uuid, text) TO authenticated;

-- 6) Assign critical admin modules to protected superadmin if already defined
INSERT INTO public.user_branch_modules (
  user_id,
  branch_id,
  module_id,
  is_active,
  assigned_by,
  created_at,
  updated_at
)
SELECT
  p.id,
  ub.branch_id,
  m.id,
  true,
  NULL,
  now(),
  now()
FROM public.profiles p
JOIN public.user_branches ub ON ub.user_id = p.id
JOIN public.modules m ON m.code IN ('sucursales', 'usuarios', 'configuracion')
WHERE p.is_protected_superadmin = true
ON CONFLICT (user_id, branch_id, module_id)
DO UPDATE SET is_active = true, updated_at = now();

-- Auto-protect one existing superadmin if none is currently protected
DO $$
DECLARE
  v_target uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_protected_superadmin = true) THEN
    SELECT ur.user_id INTO v_target
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'superadmin'::public.app_role
    ORDER BY p.created_at
    LIMIT 1;

    IF v_target IS NOT NULL THEN
      UPDATE public.profiles
      SET is_active = true,
          is_protected_superadmin = true,
          updated_at = now()
      WHERE id = v_target;
    END IF;
  END IF;
END $$;
