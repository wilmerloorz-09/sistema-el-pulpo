-- Access control by modules + active branch + history
-- Safe migration: additive, backward compatible

-- 0) Extend app_role for branch supervisor semantics
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor';

-- 1) Active branch in profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_branch_id uuid REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_profiles_active_branch_id ON public.profiles(active_branch_id);

-- Backfill active branch from existing assignments if empty
WITH first_branch AS (
  SELECT DISTINCT ON (ub.user_id)
    ub.user_id,
    ub.branch_id
  FROM public.user_branches ub
  ORDER BY ub.user_id, ub.id
)
UPDATE public.profiles p
SET active_branch_id = fb.branch_id
FROM first_branch fb
WHERE p.id = fb.user_id
  AND p.active_branch_id IS NULL;

-- 2) Modules catalog
CREATE TABLE IF NOT EXISTS public.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modules_is_active ON public.modules(is_active);

-- Standard modules seed
INSERT INTO public.modules (code, name, description)
VALUES
  ('mesas', 'Mesas', 'Gestion de mesas'),
  ('ordenes', 'Ordenes', 'Gestion de ordenes'),
  ('despacho', 'Despacho', 'Despacho y cocina'),
  ('caja', 'Caja', 'Operacion de caja'),
  ('pagos', 'Pagos', 'Aplicacion y gestion de pagos'),
  ('reportes', 'Reportes', 'Consulta de reportes'),
  ('usuarios', 'Usuarios', 'Gestion de usuarios y accesos'),
  ('configuracion', 'Configuracion', 'Configuracion del sistema')
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS update_modules_updated_at ON public.modules;
CREATE TRIGGER update_modules_updated_at
BEFORE UPDATE ON public.modules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 3) User access by branch + module
CREATE TABLE IF NOT EXISTS public.user_branch_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, branch_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branch_modules_user_branch
  ON public.user_branch_modules(user_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_modules_branch
  ON public.user_branch_modules(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_modules_module
  ON public.user_branch_modules(module_id);

DROP TRIGGER IF EXISTS update_user_branch_modules_updated_at ON public.user_branch_modules;
CREATE TRIGGER update_user_branch_modules_updated_at
BEFORE UPDATE ON public.user_branch_modules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Supervisor allowed modules (limits defined by admin/superadmin)
CREATE TABLE IF NOT EXISTS public.supervisor_branch_module_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  is_allowed boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supervisor_user_id, branch_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_limits_supervisor_branch
  ON public.supervisor_branch_module_limits(supervisor_user_id, branch_id);

DROP TRIGGER IF EXISTS update_supervisor_branch_module_limits_updated_at ON public.supervisor_branch_module_limits;
CREATE TRIGGER update_supervisor_branch_module_limits_updated_at
BEFORE UPDATE ON public.supervisor_branch_module_limits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Dedicated history tables
CREATE TABLE IF NOT EXISTS public.user_branch_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  previous_branch_id uuid REFERENCES public.branches(id),
  new_branch_id uuid REFERENCES public.branches(id),
  branch_id uuid REFERENCES public.branches(id),
  change_type text NOT NULL CHECK (
    change_type IN ('active_branch_changed', 'branch_enabled', 'branch_disabled')
  ),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_branch_change_history_user ON public.user_branch_change_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_change_history_branch ON public.user_branch_change_history(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_change_history_changed_at ON public.user_branch_change_history(changed_at DESC);

CREATE TABLE IF NOT EXISTS public.user_module_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (
    action_type IN ('assigned', 'removed', 'activated', 'deactivated')
  ),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_module_change_history_user ON public.user_module_change_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_module_change_history_branch ON public.user_module_change_history(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_module_change_history_module ON public.user_module_change_history(module_id);
CREATE INDEX IF NOT EXISTS idx_user_module_change_history_changed_at ON public.user_module_change_history(changed_at DESC);

-- 6) Helper functions
CREATE OR REPLACE FUNCTION public.is_admin_or_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'superadmin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.ensure_active_branch_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branches ub
    WHERE ub.user_id = NEW.id
      AND ub.branch_id = NEW.active_branch_id
  ) THEN
    RAISE EXCEPTION 'La sucursal activa debe estar habilitada para el usuario';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_validate_active_branch ON public.profiles;
CREATE TRIGGER trg_profiles_validate_active_branch
BEFORE INSERT OR UPDATE OF active_branch_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.ensure_active_branch_membership();

-- 7) Branch assignment and active branch functions (with history)
CREATE OR REPLACE FUNCTION public.set_user_active_branch(
  p_target_user_id uuid,
  p_new_branch_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_branch uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_target_user_id IS NULL OR p_new_branch_id IS NULL THEN
    RAISE EXCEPTION 'Parmetros incompletos';
  END IF;

  IF p_target_user_id <> v_actor AND NOT public.is_admin_or_superadmin(v_actor) THEN
    RAISE EXCEPTION 'No autorizado para cambiar sucursal activa de otro usuario';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branches ub
    WHERE ub.user_id = p_target_user_id
      AND ub.branch_id = p_new_branch_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no esta habilitada para el usuario';
  END IF;

  SELECT p.active_branch_id INTO v_previous_branch
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  FOR UPDATE;

  UPDATE public.profiles
  SET active_branch_id = p_new_branch_id,
      updated_at = now()
  WHERE id = p_target_user_id;

  IF v_previous_branch IS DISTINCT FROM p_new_branch_id THEN
    INSERT INTO public.user_branch_change_history (
      user_id,
      previous_branch_id,
      new_branch_id,
      branch_id,
      change_type,
      previous_value,
      new_value,
      reason,
      changed_by,
      changed_at
    ) VALUES (
      p_target_user_id,
      v_previous_branch,
      p_new_branch_id,
      p_new_branch_id,
      'active_branch_changed',
      jsonb_build_object('active_branch_id', v_previous_branch),
      jsonb_build_object('active_branch_id', p_new_branch_id),
      p_reason,
      v_actor,
      now()
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_branch(
  p_target_user_id uuid,
  p_branch_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_admin_or_superadmin(v_actor) THEN
    RAISE EXCEPTION 'Solo admin/superadmin puede habilitar sucursales';
  END IF;

  INSERT INTO public.user_branches (user_id, branch_id)
  VALUES (p_target_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count > 0 THEN
    INSERT INTO public.user_branch_change_history (
      user_id,
      previous_branch_id,
      new_branch_id,
      branch_id,
      change_type,
      previous_value,
      new_value,
      reason,
      changed_by,
      changed_at
    ) VALUES (
      p_target_user_id,
      NULL,
      p_branch_id,
      p_branch_id,
      'branch_enabled',
      jsonb_build_object('enabled', false),
      jsonb_build_object('enabled', true),
      p_reason,
      v_actor,
      now()
    );

    UPDATE public.profiles
    SET active_branch_id = COALESCE(active_branch_id, p_branch_id),
        updated_at = now()
    WHERE id = p_target_user_id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_branch(
  p_target_user_id uuid,
  p_branch_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_active_branch uuid;
  v_next_branch uuid;
  v_row_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_admin_or_superadmin(v_actor) THEN
    RAISE EXCEPTION 'Solo admin/superadmin puede deshabilitar sucursales';
  END IF;

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  DELETE FROM public.user_branches
  WHERE user_id = p_target_user_id
    AND branch_id = p_branch_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count > 0 THEN
    INSERT INTO public.user_branch_change_history (
      user_id,
      previous_branch_id,
      new_branch_id,
      branch_id,
      change_type,
      previous_value,
      new_value,
      reason,
      changed_by,
      changed_at
    ) VALUES (
      p_target_user_id,
      p_branch_id,
      NULL,
      p_branch_id,
      'branch_disabled',
      jsonb_build_object('enabled', true),
      jsonb_build_object('enabled', false),
      p_reason,
      v_actor,
      now()
    );

    IF v_active_branch = p_branch_id THEN
      SELECT ub.branch_id INTO v_next_branch
      FROM public.user_branches ub
      WHERE ub.user_id = p_target_user_id
      ORDER BY ub.id
      LIMIT 1;

      UPDATE public.profiles
      SET active_branch_id = v_next_branch,
          updated_at = now()
      WHERE id = p_target_user_id;

      INSERT INTO public.user_branch_change_history (
        user_id,
        previous_branch_id,
        new_branch_id,
        branch_id,
        change_type,
        previous_value,
        new_value,
        reason,
        changed_by,
        changed_at
      ) VALUES (
        p_target_user_id,
        p_branch_id,
        v_next_branch,
        COALESCE(v_next_branch, p_branch_id),
        'active_branch_changed',
        jsonb_build_object('active_branch_id', p_branch_id),
        jsonb_build_object('active_branch_id', v_next_branch),
        COALESCE(p_reason, 'Sucursal activa ajustada por deshabilitacion'),
        v_actor,
        now()
      );
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- 8) Module assignment function with supervisor limits
CREATE OR REPLACE FUNCTION public.upsert_user_branch_module(
  p_target_user_id uuid,
  p_branch_id uuid,
  p_module_code text,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_module_id uuid;
  v_old_value boolean;
  v_actor_is_admin boolean;
  v_actor_is_supervisor boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT m.id INTO v_module_id
  FROM public.modules m
  WHERE m.code = p_module_code
    AND m.is_active = true;

  IF v_module_id IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido o inactivo';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branches ub
    WHERE ub.user_id = p_target_user_id
      AND ub.branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'El usuario objetivo no tiene habilitada esa sucursal';
  END IF;

  v_actor_is_admin := public.is_admin_or_superadmin(v_actor);
  v_actor_is_supervisor := public.has_role(v_actor, 'supervisor'::public.app_role);

  IF NOT v_actor_is_admin THEN
    IF NOT v_actor_is_supervisor THEN
      RAISE EXCEPTION 'No autorizado para asignar modulos';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.user_branches ub
      WHERE ub.user_id = v_actor
        AND ub.branch_id = p_branch_id
    ) THEN
      RAISE EXCEPTION 'Supervisor no pertenece a la sucursal';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.supervisor_branch_module_limits l
      WHERE l.supervisor_user_id = v_actor
        AND l.branch_id = p_branch_id
        AND l.module_id = v_module_id
        AND l.is_allowed = true
    ) THEN
      RAISE EXCEPTION 'Supervisor fuera de limites para este modulo';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.user_branch_modules ubm
      WHERE ubm.user_id = v_actor
        AND ubm.branch_id = p_branch_id
        AND ubm.module_id = v_module_id
        AND ubm.is_active = true
    ) THEN
      RAISE EXCEPTION 'Supervisor no puede asignar modulos superiores a los suyos';
    END IF;
  END IF;

  SELECT ubm.is_active
  INTO v_old_value
  FROM public.user_branch_modules ubm
  WHERE ubm.user_id = p_target_user_id
    AND ubm.branch_id = p_branch_id
    AND ubm.module_id = v_module_id;

  INSERT INTO public.user_branch_modules (
    user_id,
    branch_id,
    module_id,
    is_active,
    assigned_by,
    created_at,
    updated_at
  ) VALUES (
    p_target_user_id,
    p_branch_id,
    v_module_id,
    p_is_active,
    v_actor,
    now(),
    now()
  )
  ON CONFLICT (user_id, branch_id, module_id)
  DO UPDATE SET
    is_active = EXCLUDED.is_active,
    assigned_by = v_actor,
    updated_at = now();

  IF v_old_value IS DISTINCT FROM p_is_active THEN
    INSERT INTO public.user_module_change_history (
      user_id,
      branch_id,
      module_id,
      action_type,
      previous_value,
      new_value,
      reason,
      changed_by,
      changed_at
    ) VALUES (
      p_target_user_id,
      p_branch_id,
      v_module_id,
      CASE
        WHEN v_old_value IS NULL AND p_is_active THEN 'assigned'
        WHEN v_old_value IS NULL AND NOT p_is_active THEN 'deactivated'
        WHEN v_old_value = true AND NOT p_is_active THEN 'deactivated'
        WHEN v_old_value = false AND p_is_active THEN 'activated'
        ELSE 'activated'
      END,
      jsonb_build_object('is_active', v_old_value),
      jsonb_build_object('is_active', p_is_active),
      p_reason,
      v_actor,
      now()
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_supervisor_module_limit(
  p_supervisor_user_id uuid,
  p_branch_id uuid,
  p_module_code text,
  p_is_allowed boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_module_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_admin_or_superadmin(v_actor) THEN
    RAISE EXCEPTION 'Solo admin/superadmin puede definir limites de supervisor';
  END IF;

  IF NOT public.has_role(p_supervisor_user_id, 'supervisor'::public.app_role) THEN
    RAISE EXCEPTION 'El usuario objetivo no tiene rol supervisor';
  END IF;

  SELECT m.id INTO v_module_id
  FROM public.modules m
  WHERE m.code = p_module_code;

  IF v_module_id IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido';
  END IF;

  INSERT INTO public.supervisor_branch_module_limits (
    supervisor_user_id,
    branch_id,
    module_id,
    is_allowed,
    assigned_by,
    created_at,
    updated_at
  ) VALUES (
    p_supervisor_user_id,
    p_branch_id,
    v_module_id,
    p_is_allowed,
    v_actor,
    now(),
    now()
  )
  ON CONFLICT (supervisor_user_id, branch_id, module_id)
  DO UPDATE SET
    is_allowed = EXCLUDED.is_allowed,
    assigned_by = v_actor,
    updated_at = now();

  RETURN true;
END;
$$;

-- 9) RLS for new tables
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branch_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_branch_module_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branch_change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view modules" ON public.modules;
CREATE POLICY "Authenticated can view modules"
ON public.modules
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can view own and branch module access" ON public.user_branch_modules;
CREATE POLICY "Users can view own and branch module access"
ON public.user_branch_modules
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin_or_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'supervisor'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.user_branches ub
      WHERE ub.user_id = auth.uid()
        AND ub.branch_id = user_branch_modules.branch_id
    )
  )
);

DROP POLICY IF EXISTS "Admins can view supervisor limits" ON public.supervisor_branch_module_limits;
CREATE POLICY "Admins can view supervisor limits"
ON public.supervisor_branch_module_limits
FOR SELECT
TO authenticated
USING (
  public.is_admin_or_superadmin(auth.uid())
  OR supervisor_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Admins can view branch history" ON public.user_branch_change_history;
CREATE POLICY "Admins can view branch history"
ON public.user_branch_change_history
FOR SELECT
TO authenticated
USING (
  public.is_admin_or_superadmin(auth.uid())
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "Admins can view module history" ON public.user_module_change_history;
CREATE POLICY "Admins can view module history"
ON public.user_module_change_history
FOR SELECT
TO authenticated
USING (
  public.is_admin_or_superadmin(auth.uid())
  OR user_id = auth.uid()
);

-- 10) Execute grants
GRANT EXECUTE ON FUNCTION public.set_user_active_branch(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_branch(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_branch(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_branch_module(uuid, uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_supervisor_module_limit(uuid, uuid, text, boolean) TO authenticated;

-- 11) Initial migration from role-based access to module-based access
INSERT INTO public.user_branch_modules (user_id, branch_id, module_id, is_active, assigned_by)
SELECT
  ur.user_id,
  ub.branch_id,
  m.id,
  true,
  NULL
FROM public.user_roles ur
JOIN public.user_branches ub
  ON ub.user_id = ur.user_id
JOIN public.modules m
  ON (
    (ur.role IN ('admin'::public.app_role, 'superadmin'::public.app_role) AND m.code IN ('mesas','ordenes','despacho','caja','pagos','reportes','usuarios','configuracion'))
    OR (ur.role = 'supervisor'::public.app_role AND m.code IN ('mesas','ordenes','despacho','caja','pagos','reportes','usuarios'))
    OR (ur.role = 'mesero'::public.app_role AND m.code IN ('mesas','ordenes'))
    OR (ur.role = 'cajero'::public.app_role AND m.code IN ('caja','pagos'))
    OR (ur.role = 'cocina'::public.app_role AND m.code IN ('despacho'))
    OR (ur.role = 'despachador_mesas'::public.app_role AND m.code IN ('despacho'))
    OR (ur.role = 'despachador_takeout'::public.app_role AND m.code IN ('despacho'))
  )
ON CONFLICT (user_id, branch_id, module_id) DO NOTHING;

-- Default supervisor limits based on seeded mapping
INSERT INTO public.supervisor_branch_module_limits (supervisor_user_id, branch_id, module_id, is_allowed, assigned_by)
SELECT
  ur.user_id,
  ub.branch_id,
  ubm.module_id,
  true,
  NULL
FROM public.user_roles ur
JOIN public.user_branches ub
  ON ub.user_id = ur.user_id
JOIN public.user_branch_modules ubm
  ON ubm.user_id = ur.user_id
 AND ubm.branch_id = ub.branch_id
 AND ubm.is_active = true
WHERE ur.role = 'supervisor'::public.app_role
ON CONFLICT (supervisor_user_id, branch_id, module_id) DO NOTHING;

