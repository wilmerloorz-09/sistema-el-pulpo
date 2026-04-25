ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_number text,
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_alphanumeric,
  DROP CONSTRAINT IF EXISTS profiles_full_name_letters_only,
  DROP CONSTRAINT IF EXISTS profiles_email_valid_format,
  DROP CONSTRAINT IF EXISTS profiles_identity_number_10_digits,
  DROP CONSTRAINT IF EXISTS profiles_phone_10_digits;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_identity_number_10_digits
  CHECK (identity_number IS NULL OR identity_number ~ '^[0-9]{10}$') NOT VALID,
  ADD CONSTRAINT profiles_phone_10_digits
  CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$') NOT VALID,
  ADD CONSTRAINT profiles_username_alphanumeric
  CHECK (username ~ '^[A-Za-z0-9]+$') NOT VALID,
  ADD CONSTRAINT profiles_full_name_letters_only
  CHECK (full_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID,
  ADD CONSTRAINT profiles_email_valid_format
  CHECK (email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') NOT VALID;

COMMENT ON COLUMN public.profiles.identity_number IS 'Numero de cedula o identificacion del usuario.';
COMMENT ON COLUMN public.profiles.home_address IS 'Direccion domiciliaria del usuario.';
COMMENT ON COLUMN public.profiles.phone IS 'Telefono de contacto del usuario.';

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

GRANT EXECUTE ON FUNCTION public.admin_list_users_access() TO authenticated;
