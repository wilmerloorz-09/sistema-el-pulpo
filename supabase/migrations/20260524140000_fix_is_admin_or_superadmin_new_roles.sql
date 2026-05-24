-- Fix: is_admin_or_superadmin debe reconocer también administradores del nuevo sistema (user_global_roles)
-- La función antigua solo verificaba la tabla legacy user_roles / profiles.role
-- Los admins actuales usan user_global_roles con role code = 'administrador'

CREATE OR REPLACE FUNCTION public.is_admin_or_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Sistema legacy (profiles.role / user_roles)
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'superadmin'::public.app_role)
    -- Sistema nuevo (user_global_roles)
    OR public.is_global_admin(_user_id);
$$;

NOTIFY pgrst, 'reload schema';
