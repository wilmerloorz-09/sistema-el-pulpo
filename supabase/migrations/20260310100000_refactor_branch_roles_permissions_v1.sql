-- Refactor V1: branch role assignments + permission levels
-- Additive migration with temporary compatibility over the current access model.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'access_level'
  ) THEN
    CREATE TYPE public.access_level AS ENUM ('NONE', 'VIEW', 'OPERATE', 'MANAGE');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'role_scope'
  ) THEN
    CREATE TYPE public.role_scope AS ENUM ('GLOBAL', 'BRANCH');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  scope public.role_scope NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  access_level public.access_level NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, module_id)
);

CREATE TABLE IF NOT EXISTS public.user_branch_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, branch_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.user_global_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

INSERT INTO public.modules (code, name, description, is_active)
VALUES
  ('mesas', 'Mesas', 'Vista y operacion de mesas', true),
  ('ordenes', 'Ordenes', 'Vista y operacion de ordenes', true),
  ('despacho_mesa', 'Despacho Mesa', 'Despacho de ordenes en mesa', true),
  ('despacho_para_llevar', 'Despacho Para Llevar', 'Despacho de ordenes para llevar', true),
  ('despacho_total', 'Despacho Total', 'Vista consolidada de despacho', true),
  ('caja', 'Caja', 'Operacion de caja', true),
  ('admin_sucursal', 'Administracion Sucursal', 'Administracion operativa de la sucursal', true),
  ('admin_global', 'Administracion Global', 'Administracion global del sistema', true),
  ('reportes_sucursal', 'Reportes Sucursal', 'Consulta de reportes de sucursal', true),
  ('reportes_globales', 'Reportes Globales', 'Consulta de reportes globales', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

INSERT INTO public.roles (code, name, scope)
VALUES
  ('administrador', 'Administrador', 'GLOBAL'),
  ('supervisor', 'Supervisor', 'BRANCH'),
  ('mesero', 'Mesero', 'BRANCH'),
  ('despachador', 'Despachador', 'BRANCH'),
  ('despachador_mesas', 'Despachador Mesas', 'BRANCH'),
  ('despachador_para_llevar', 'Despachador Para Llevar', 'BRANCH'),
  ('cajero', 'Cajero', 'BRANCH')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    scope = EXCLUDED.scope,
    is_system = true,
    is_active = true,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.access_level_rank(p_level public.access_level)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'NONE'::public.access_level THEN 0
    WHEN 'VIEW'::public.access_level THEN 1
    WHEN 'OPERATE'::public.access_level THEN 2
    WHEN 'MANAGE'::public.access_level THEN 3
  END;
$$;

CREATE OR REPLACE FUNCTION public.max_access_level(p_left public.access_level, p_right public.access_level)
RETURNS public.access_level
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.access_level_rank(COALESCE(p_left, 'NONE'::public.access_level)) >= public.access_level_rank(COALESCE(p_right, 'NONE'::public.access_level))
      THEN COALESCE(p_left, 'NONE'::public.access_level)
    ELSE COALESCE(p_right, 'NONE'::public.access_level)
  END;
$$;

DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.code IN ('administrador','supervisor','mesero','despachador','despachador_mesas','despachador_para_llevar','cajero');

WITH matrix(role_code, module_code, access_level) AS (
  VALUES
    ('administrador', 'mesas', 'MANAGE'),
    ('administrador', 'ordenes', 'MANAGE'),
    ('administrador', 'despacho_mesa', 'MANAGE'),
    ('administrador', 'despacho_para_llevar', 'MANAGE'),
    ('administrador', 'caja', 'MANAGE'),
    ('administrador', 'admin_sucursal', 'MANAGE'),
    ('administrador', 'admin_global', 'MANAGE'),
    ('administrador', 'reportes_sucursal', 'MANAGE'),
    ('administrador', 'reportes_globales', 'MANAGE'),
    ('supervisor', 'mesas', 'OPERATE'),
    ('supervisor', 'ordenes', 'OPERATE'),
    ('supervisor', 'despacho_mesa', 'OPERATE'),
    ('supervisor', 'despacho_para_llevar', 'OPERATE'),
    ('supervisor', 'caja', 'VIEW'),
    ('supervisor', 'admin_sucursal', 'MANAGE'),
    ('supervisor', 'reportes_sucursal', 'VIEW'),
    ('mesero', 'mesas', 'OPERATE'),
    ('mesero', 'ordenes', 'OPERATE'),
    ('mesero', 'despacho_mesa', 'VIEW'),
    ('mesero', 'despacho_para_llevar', 'VIEW'),
    ('despachador', 'mesas', 'VIEW'),
    ('despachador', 'ordenes', 'VIEW'),
    ('despachador', 'despacho_mesa', 'OPERATE'),
    ('despachador', 'despacho_para_llevar', 'OPERATE'),
    ('despachador_mesas', 'mesas', 'VIEW'),
    ('despachador_mesas', 'ordenes', 'VIEW'),
    ('despachador_mesas', 'despacho_mesa', 'OPERATE'),
    ('despachador_mesas', 'despacho_para_llevar', 'VIEW'),
    ('despachador_para_llevar', 'mesas', 'VIEW'),
    ('despachador_para_llevar', 'ordenes', 'VIEW'),
    ('despachador_para_llevar', 'despacho_mesa', 'VIEW'),
    ('despachador_para_llevar', 'despacho_para_llevar', 'OPERATE'),
    ('cajero', 'mesas', 'VIEW'),
    ('cajero', 'ordenes', 'VIEW'),
    ('cajero', 'despacho_mesa', 'VIEW'),
    ('cajero', 'despacho_para_llevar', 'VIEW'),
    ('cajero', 'caja', 'OPERATE'),
    ('cajero', 'reportes_sucursal', 'VIEW')
)
INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT r.id, m.id, matrix.access_level::public.access_level
FROM matrix
JOIN public.roles r ON r.code = matrix.role_code
JOIN public.modules m ON m.code = matrix.module_code
ON CONFLICT (role_id, module_id)
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now();

CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_global_roles ugr
    JOIN public.roles r ON r.id = ugr.role_id
    WHERE ugr.user_id = _user_id
      AND ugr.is_active = true
      AND r.code = 'administrador'
      AND r.is_active = true
  )
  OR public.has_role(_user_id, 'admin'::public.app_role)
  OR public.has_role(_user_id, 'superadmin'::public.app_role);
$$;

WITH admin_users AS (
  SELECT DISTINCT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin'::public.app_role, 'superadmin'::public.app_role)
), admin_role AS (
  SELECT id FROM public.roles WHERE code = 'administrador'
)
INSERT INTO public.user_global_roles (user_id, role_id, is_active, assigned_by)
SELECT au.user_id, ar.id, true, NULL
FROM admin_users au
CROSS JOIN admin_role ar
ON CONFLICT (user_id, role_id) DO UPDATE SET is_active = true, updated_at = now();

WITH ranked_legacy_roles AS (
  SELECT ub.user_id, ub.branch_id,
    CASE
      WHEN public.has_role(ub.user_id, 'supervisor'::public.app_role) THEN 'supervisor'
      WHEN public.has_role(ub.user_id, 'cajero'::public.app_role) THEN 'cajero'
      WHEN public.has_role(ub.user_id, 'mesero'::public.app_role) THEN 'mesero'
      WHEN public.has_role(ub.user_id, 'despachador_mesas'::public.app_role) THEN 'despachador_mesas'
      WHEN public.has_role(ub.user_id, 'despachador_takeout'::public.app_role) THEN 'despachador_para_llevar'
      WHEN public.has_role(ub.user_id, 'cocina'::public.app_role) THEN 'despachador'
      ELSE NULL
    END AS role_code
  FROM public.user_branches ub
)
INSERT INTO public.user_branch_roles (user_id, branch_id, role_id, is_active, assigned_by)
SELECT x.user_id, x.branch_id, r.id, true, NULL
FROM ranked_legacy_roles x
JOIN public.roles r ON r.code = x.role_code
WHERE x.role_code IS NOT NULL
ON CONFLICT (user_id, branch_id)
DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true, updated_at = now();

CREATE OR REPLACE VIEW public.v_user_effective_permissions AS
WITH raw_permissions AS (
  SELECT ubr.user_id, ubr.branch_id, m.code AS module_code, rp.access_level
  FROM public.user_branch_roles ubr
  JOIN public.roles r ON r.id = ubr.role_id AND r.is_active = true
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.modules m ON m.id = rp.module_id AND m.is_active = true
  JOIN public.branches b ON b.id = ubr.branch_id AND b.is_active = true
  WHERE ubr.is_active = true
  UNION ALL
  SELECT ugr.user_id, b.id AS branch_id, m.code AS module_code, rp.access_level
  FROM public.user_global_roles ugr
  JOIN public.roles r ON r.id = ugr.role_id AND r.is_active = true
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.modules m ON m.id = rp.module_id AND m.is_active = true
  JOIN public.branches b ON b.is_active = true
  WHERE ugr.is_active = true
), aggregated AS (
  SELECT user_id, branch_id, module_code,
    CASE max(public.access_level_rank(access_level))
      WHEN 3 THEN 'MANAGE'::public.access_level
      WHEN 2 THEN 'OPERATE'::public.access_level
      WHEN 1 THEN 'VIEW'::public.access_level
      ELSE 'NONE'::public.access_level
    END AS access_level
  FROM raw_permissions
  GROUP BY user_id, branch_id, module_code
), dispatch_total AS (
  SELECT user_id, branch_id, 'despacho_total'::text AS module_code,
    public.max_access_level(
      max(CASE WHEN module_code = 'despacho_mesa' THEN access_level END),
      max(CASE WHEN module_code = 'despacho_para_llevar' THEN access_level END)
    ) AS access_level
  FROM aggregated
  WHERE module_code IN ('despacho_mesa', 'despacho_para_llevar')
  GROUP BY user_id, branch_id
)
SELECT user_id, branch_id, module_code, access_level FROM aggregated
UNION
SELECT user_id, branch_id, module_code, access_level FROM dispatch_total;

CREATE OR REPLACE VIEW public.v_user_accessible_branches AS
SELECT DISTINCT user_id, branch_id
FROM public.v_user_effective_permissions;

CREATE OR REPLACE FUNCTION public.has_branch_permission(p_user_id uuid, p_branch_id uuid, p_module_code text, p_required public.access_level)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT public.access_level_rank(v.access_level) >= public.access_level_rank(p_required)
    FROM public.v_user_effective_permissions v
    WHERE v.user_id = p_user_id
      AND v.branch_id = p_branch_id
      AND v.module_code = p_module_code
    LIMIT 1
  ), false);
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

  IF public.is_global_admin(NEW.id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = NEW.active_branch_id AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'La sucursal activa no es valida para el administrador global';
    END IF;
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
CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_branch uuid;
  v_branches jsonb := '[]'::jsonb;
  v_permissions jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'is_active', b.is_active) ORDER BY b.name), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  JOIN public.v_user_accessible_branches ub ON ub.branch_id = b.id AND ub.user_id = v_user_id
  WHERE b.is_active = true;

  IF v_active_branch IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.branches b ON b.id = ub.branch_id
    WHERE ub.user_id = v_user_id AND ub.branch_id = v_active_branch AND b.is_active = true
  ) THEN
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    JOIN public.v_user_accessible_branches ub ON ub.branch_id = b.id AND ub.user_id = v_user_id
    WHERE b.is_active = true
    ORDER BY b.name
    LIMIT 1;

    IF v_active_branch IS NOT NULL THEN
      UPDATE public.profiles
      SET active_branch_id = v_active_branch,
          updated_at = now()
      WHERE id = v_user_id;
    END IF;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(module_code, access_level::text), '{}'::jsonb)
    INTO v_permissions
    FROM public.v_user_effective_permissions
    WHERE user_id = v_user_id
      AND branch_id = v_active_branch;
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', public.is_global_admin(v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_active_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.branches b ON b.id = ub.branch_id
    WHERE ub.user_id = auth.uid()
      AND ub.branch_id = p_branch_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Sucursal no disponible para el usuario';
  END IF;

  UPDATE public.profiles
  SET active_branch_id = p_branch_id,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_access_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'branches', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.branches b
      WHERE b.is_active = true
    ),
    'branch_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.roles r
      WHERE r.scope = 'BRANCH'::public.role_scope
        AND r.is_active = true
    ),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.roles r
      WHERE r.scope = 'GLOBAL'::public.role_scope
        AND r.is_active = true
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'username', p.username,
    'email', p.email,
    'is_active', p.is_active,
    'active_branch_id', p.active_branch_id,
    'is_protected_superadmin', COALESCE(p.is_protected_superadmin, false),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p.id AND ugr.is_active = true
    ),
    'branch_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', ubr.branch_id, 'branch_name', b.name, 'role_code', r.code, 'role_name', r.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.user_branch_roles ubr
      JOIN public.roles r ON r.id = ubr.role_id
      JOIN public.branches b ON b.id = ubr.branch_id
      WHERE ubr.user_id = p.id AND ubr.is_active = true
    )
  ) ORDER BY p.full_name), '[]'::jsonb)
  FROM public.profiles p;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_branch_role(p_target_user_id uuid, p_branch_id uuid, p_role_code text, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede asignar roles por sucursal';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = p_role_code
    AND scope = 'BRANCH'::public.role_scope
    AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol de sucursal invalido';
  END IF;

  INSERT INTO public.user_branches (user_id, branch_id)
  VALUES (p_target_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  INSERT INTO public.user_branch_roles (user_id, branch_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, p_branch_id, v_role_id, true, v_actor)
  ON CONFLICT (user_id, branch_id)
  DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true, assigned_by = v_actor, updated_at = now();

  UPDATE public.profiles
  SET active_branch_id = COALESCE(active_branch_id, p_branch_id),
      updated_at = now()
  WHERE id = p_target_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_branch_role(p_target_user_id uuid, p_branch_id uuid, p_role_code text, p_reason text DEFAULT NULL)
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

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede remover roles por sucursal';
  END IF;

  DELETE FROM public.user_branch_roles
  WHERE user_id = p_target_user_id
    AND branch_id = p_branch_id;

  DELETE FROM public.user_branches
  WHERE user_id = p_target_user_id
    AND branch_id = p_branch_id;

  UPDATE public.profiles
  SET active_branch_id = (
    SELECT ubr.branch_id
    FROM public.user_branch_roles ubr
    WHERE ubr.user_id = p_target_user_id
      AND ubr.is_active = true
    ORDER BY ubr.created_at
    LIMIT 1
  ),
  updated_at = now()
  WHERE id = p_target_user_id
    AND active_branch_id = p_branch_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_global_role(p_target_user_id uuid, p_role_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede asignar roles globales';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = p_role_code
    AND scope = 'GLOBAL'::public.role_scope
    AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol global invalido';
  END IF;

  INSERT INTO public.user_global_roles (user_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, v_role_id, true, v_actor)
  ON CONFLICT (user_id, role_id)
  DO UPDATE SET is_active = true, assigned_by = v_actor, updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_global_role(p_target_user_id uuid, p_role_code text)
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

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede remover roles globales';
  END IF;

  DELETE FROM public.user_global_roles ugr
  USING public.roles r
  WHERE ugr.role_id = r.id
    AND ugr.user_id = p_target_user_id
    AND r.code = p_role_code
    AND r.scope = 'GLOBAL'::public.role_scope;

  RETURN true;
END;
$$;

GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.user_branch_roles TO authenticated;
GRANT SELECT ON public.user_global_roles TO authenticated;
GRANT SELECT ON public.v_user_effective_permissions TO authenticated;
GRANT SELECT ON public.v_user_accessible_branches TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_branch_permission(uuid, uuid, text, public.access_level) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_active_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_access_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_branch_role(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_branch_role(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_global_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_global_role(uuid, text) TO authenticated;



CREATE OR REPLACE FUNCTION public.admin_list_access_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'branches', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.branches b
      WHERE b.is_active = true
    ),
    'branch_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.roles r
      WHERE r.scope = 'BRANCH'::public.role_scope
        AND r.is_active = true
    ),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.roles r
      WHERE r.scope = 'GLOBAL'::public.role_scope
        AND r.is_active = true
    )
  )
  WHERE public.is_global_admin(auth.uid())
     OR public.has_branch_permission(
       auth.uid(),
       (SELECT active_branch_id FROM public.profiles WHERE id = auth.uid()),
       'admin_sucursal',
       'MANAGE'::public.access_level
     );
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'username', p.username,
    'email', p.email,
    'is_active', p.is_active,
    'active_branch_id', p.active_branch_id,
    'is_protected_superadmin', COALESCE(p.is_protected_superadmin, false),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p.id AND ugr.is_active = true
    ),
    'branch_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', ubr.branch_id, 'branch_name', b.name, 'role_code', r.code, 'role_name', r.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.user_branch_roles ubr
      JOIN public.roles r ON r.id = ubr.role_id
      JOIN public.branches b ON b.id = ubr.branch_id
      WHERE ubr.user_id = p.id AND ubr.is_active = true
    )
  ) ORDER BY p.full_name), '[]'::jsonb)
  FROM public.profiles p
  WHERE public.is_global_admin(auth.uid())
     OR public.has_branch_permission(
       auth.uid(),
       (SELECT active_branch_id FROM public.profiles WHERE id = auth.uid()),
       'admin_sucursal',
       'MANAGE'::public.access_level
     );
$$;


CREATE OR REPLACE FUNCTION public.assign_user_branch_role(p_target_user_id uuid, p_branch_id uuid, p_role_code text, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede asignar roles por sucursal';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = p_role_code
    AND scope = 'BRANCH'::public.role_scope
    AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol de sucursal invalido';
  END IF;

  INSERT INTO public.user_branches (user_id, branch_id)
  VALUES (p_target_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  INSERT INTO public.user_branch_roles (user_id, branch_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, p_branch_id, v_role_id, true, v_actor)
  ON CONFLICT (user_id, branch_id, role_id)
  DO UPDATE SET
    is_active = true,
    assigned_by = v_actor,
    updated_at = now();

  UPDATE public.profiles
  SET active_branch_id = COALESCE(active_branch_id, p_branch_id),
      updated_at = now()
  WHERE id = p_target_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_branch_role(p_target_user_id uuid, p_branch_id uuid, p_role_code text, p_reason text DEFAULT NULL)
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

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede remover roles por sucursal';
  END IF;

  DELETE FROM public.user_branch_roles ubr
  USING public.roles r
  WHERE ubr.user_id = p_target_user_id
    AND ubr.branch_id = p_branch_id
    AND ubr.role_id = r.id
    AND r.code = p_role_code;

  DELETE FROM public.user_branches
  WHERE user_id = p_target_user_id
    AND branch_id = p_branch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      WHERE ubr.user_id = p_target_user_id
        AND ubr.branch_id = p_branch_id
        AND ubr.is_active = true
    );

  UPDATE public.profiles
  SET active_branch_id = (
    SELECT ubr.branch_id
    FROM public.user_branch_roles ubr
    WHERE ubr.user_id = p_target_user_id
      AND ubr.is_active = true
    ORDER BY ubr.created_at
    LIMIT 1
  ),
  updated_at = now()
  WHERE id = p_target_user_id
    AND active_branch_id = p_branch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      WHERE ubr.user_id = p_target_user_id
        AND ubr.branch_id = p_branch_id
        AND ubr.is_active = true
    );

  RETURN true;
END;
$$;
