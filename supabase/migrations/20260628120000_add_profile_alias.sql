-- Identificador publico unico (alias) para usuarios

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alias text;

UPDATE public.profiles
SET alias = username
WHERE alias IS NULL OR btrim(alias) = '';

WITH ranked AS (
  SELECT
    id,
    username,
    row_number() OVER (PARTITION BY lower(username) ORDER BY created_at, id) AS rn
  FROM public.profiles
)
UPDATE public.profiles AS p
SET alias = CASE
  WHEN r.rn = 1 THEN r.username
  ELSE r.username || r.rn::text
END
FROM ranked AS r
WHERE p.id = r.id;

ALTER TABLE public.profiles
  ALTER COLUMN alias SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_alias_unique_ci
  ON public.profiles (lower(alias));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_alias_alphanumeric;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_alias_alphanumeric
  CHECK (alias ~ '^[A-Za-z0-9]+$') NOT VALID;

COMMENT ON COLUMN public.profiles.alias IS 'Identificador publico unico del usuario; visible en el sistema y usable para inicio de sesion.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name text := NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), '');
  v_last_name text := NULLIF(trim(NEW.raw_user_meta_data->>'last_name'), '');
  v_full_name text := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), 'Usuario');
  v_username text := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''), NEW.email);
  v_alias text := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'alias'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    NEW.email
  );
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, full_name, username, alias, email)
  VALUES (
    NEW.id,
    v_first_name,
    v_last_name,
    v_full_name,
    v_username,
    v_alias,
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      first_name = COALESCE(public.profiles.first_name, EXCLUDED.first_name),
      last_name = COALESCE(public.profiles.last_name, EXCLUDED.last_name),
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      username = COALESCE(public.profiles.username, EXCLUDED.username),
      alias = COALESCE(public.profiles.alias, EXCLUDED.alias),
      updated_at = now();

  RETURN NEW;
END;
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
    'first_name', p.first_name,
    'last_name', p.last_name,
    'full_name', p.full_name,
    'username', p.username,
    'alias', p.alias,
    'email', p.email,
    'identity_number', p.identity_number,
    'home_address', p.home_address,
    'phone', p.phone,
    'is_active', p.is_active,
    'active_branch_id', p.active_branch_id,
    'avatar_url', p.avatar_url,
    'is_protected_superadmin', COALESCE(p.is_protected_superadmin, false),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p.id AND ugr.is_active = true
    ),
    'branch_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', x.branch_id, 'branch_name', x.branch_name, 'role_code', x.role_code, 'role_name', x.role_name) ORDER BY x.branch_name), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (ubr.user_id)
          ubr.branch_id,
          b.name AS branch_name,
          r.code AS role_code,
          r.name AS role_name
        FROM public.user_branch_roles ubr
        JOIN public.roles r ON r.id = ubr.role_id
        JOIN public.branches b ON b.id = ubr.branch_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
        ORDER BY
          ubr.user_id,
          CASE WHEN p.active_branch_id = ubr.branch_id THEN 0 ELSE 1 END,
          CASE WHEN r.code = 'supervisor' THEN 0 ELSE 1 END,
          ubr.updated_at DESC,
          ubr.created_at DESC,
          ubr.id DESC
      ) AS x
    )
  ) ORDER BY p.last_name, p.first_name, p.alias), '[]'::jsonb)
  FROM public.profiles p
  WHERE public.is_global_admin(auth.uid())
     OR public.has_branch_permission(
       auth.uid(),
       (SELECT active_branch_id FROM public.profiles WHERE id = auth.uid()),
       'admin_sucursal',
       'MANAGE'::public.access_level
     );
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users_access() TO authenticated;

DROP FUNCTION IF EXISTS public.list_shift_users_for_branch(uuid);
CREATE OR REPLACE FUNCTION public.list_shift_users_for_branch(
  p_branch_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  alias text,
  is_profile_active boolean,
  is_enabled boolean,
  can_serve_tables boolean,
  can_access_orders boolean,
  can_edit_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  can_double_session boolean,
  is_supervisor boolean,
  can_pack_orders boolean,
  secondary_caja_takeout_enabled boolean,
  secondary_caja_express_enabled boolean,
  secondary_caja_template_id uuid,
  can_serve_plates boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH branch_members AS (
    SELECT ub.user_id
    FROM public.user_branches ub
    WHERE ub.branch_id = p_branch_id

    UNION

    SELECT ugr.user_id
    FROM public.user_global_roles ugr
    JOIN public.roles r
      ON r.id = ugr.role_id
    WHERE ugr.is_active = true
      AND r.is_active = true
      AND r.scope = 'GLOBAL'::public.role_scope
      AND r.code = 'administrador'

    UNION

    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.is_active = true
      AND NOT public.is_global_admin(p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
  )
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.alias,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_edit_orders, false) AS can_edit_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_manage_products, COALESCE(csu.can_dispatch_orders, false), false) AS can_manage_products,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.can_double_session, false) AS can_double_session,
    COALESCE(csu.is_supervisor, false) AS is_supervisor,
    COALESCE(csu.can_pack_orders, false) AS can_pack_orders,
    COALESCE(csu.secondary_caja_takeout_enabled, false) AS secondary_caja_takeout_enabled,
    COALESCE(csu.secondary_caja_express_enabled, false) AS secondary_caja_express_enabled,
    csu.secondary_caja_template_id,
    COALESCE(csu.can_serve_plates, false) AS can_serve_plates
  FROM branch_members bm
  JOIN public.profiles p
    ON p.id = bm.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = bm.user_id
  ORDER BY p.full_name, p.alias;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;
