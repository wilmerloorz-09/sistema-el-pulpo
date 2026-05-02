ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_full_name_letters_only;

WITH normalized AS (
  SELECT
    id,
    regexp_split_to_array(trim(regexp_replace(COALESCE(full_name, ''), '[[:space:]]+', ' ', 'g')), ' ') AS parts,
    trim(regexp_replace(COALESCE(full_name, ''), '[[:space:]]+', ' ', 'g')) AS clean_full_name
  FROM public.profiles
)
UPDATE public.profiles p
SET
  first_name = COALESCE(
    NULLIF(trim(p.first_name), ''),
    CASE
      WHEN array_length(n.parts, 1) > 1 THEN array_to_string(n.parts[1:(array_length(n.parts, 1) - 1)], ' ')
      ELSE NULLIF(n.clean_full_name, '')
    END,
    'Usuario'
  ),
  last_name = COALESCE(
    NULLIF(trim(p.last_name), ''),
    CASE
      WHEN array_length(n.parts, 1) > 1 THEN n.parts[array_length(n.parts, 1)]
      ELSE NULL
    END,
    'Sin Apellido'
  )
FROM normalized n
WHERE p.id = n.id;

UPDATE public.profiles
SET full_name = trim(CONCAT_WS(' ', first_name, last_name));

CREATE OR REPLACE FUNCTION public.sync_profile_full_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_clean_full_name text;
  v_parts text[];
BEGIN
  NEW.first_name := NULLIF(trim(regexp_replace(COALESCE(NEW.first_name, ''), '[[:space:]]+', ' ', 'g')), '');
  NEW.last_name := NULLIF(trim(regexp_replace(COALESCE(NEW.last_name, ''), '[[:space:]]+', ' ', 'g')), '');

  IF NEW.first_name IS NULL OR NEW.last_name IS NULL THEN
    v_clean_full_name := NULLIF(trim(regexp_replace(COALESCE(NEW.full_name, ''), '[[:space:]]+', ' ', 'g')), '');

    IF v_clean_full_name IS NOT NULL THEN
      v_parts := regexp_split_to_array(v_clean_full_name, ' ');

      IF NEW.first_name IS NULL THEN
        NEW.first_name :=
          CASE
            WHEN array_length(v_parts, 1) > 1 THEN array_to_string(v_parts[1:(array_length(v_parts, 1) - 1)], ' ')
            ELSE v_clean_full_name
          END;
      END IF;

      IF NEW.last_name IS NULL AND array_length(v_parts, 1) > 1 THEN
        NEW.last_name := v_parts[array_length(v_parts, 1)];
      END IF;
    END IF;
  END IF;

  NEW.first_name := COALESCE(NEW.first_name, 'Usuario');
  NEW.last_name := COALESCE(NEW.last_name, 'Sin Apellido');
  NEW.full_name := trim(CONCAT_WS(' ', NEW.first_name, NEW.last_name));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_full_name ON public.profiles;
CREATE TRIGGER trg_sync_profile_full_name
BEFORE INSERT OR UPDATE OF first_name, last_name, full_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_full_name();

ALTER TABLE public.profiles
  ALTER COLUMN first_name SET NOT NULL,
  ALTER COLUMN last_name SET NOT NULL,
  DROP CONSTRAINT IF EXISTS profiles_full_name_letters_only,
  DROP CONSTRAINT IF EXISTS profiles_first_name_letters_only,
  DROP CONSTRAINT IF EXISTS profiles_last_name_letters_only;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_letters_only
  CHECK (full_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID,
  ADD CONSTRAINT profiles_first_name_letters_only
  CHECK (first_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID,
  ADD CONSTRAINT profiles_last_name_letters_only
  CHECK (last_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID;

COMMENT ON COLUMN public.profiles.first_name IS 'Nombres del usuario.';
COMMENT ON COLUMN public.profiles.last_name IS 'Apellidos del usuario.';

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
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, full_name, username, email)
  VALUES (
    NEW.id,
    v_first_name,
    v_last_name,
    v_full_name,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      first_name = COALESCE(public.profiles.first_name, EXCLUDED.first_name),
      last_name = COALESCE(public.profiles.last_name, EXCLUDED.last_name),
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      username = COALESCE(public.profiles.username, EXCLUDED.username),
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
  ) ORDER BY p.last_name, p.first_name, p.username), '[]'::jsonb)
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
