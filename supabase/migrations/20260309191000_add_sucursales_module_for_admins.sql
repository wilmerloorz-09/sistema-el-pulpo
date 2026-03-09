-- Ensure admin module 'sucursales' exists and is assigned to admin/superadmin users

INSERT INTO public.modules (code, name, description, is_active)
VALUES ('sucursales', 'Sucursales', 'Gestion de sucursales del sistema', true)
ON CONFLICT (code)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

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
  src.user_id,
  src.branch_id,
  src.module_id,
  true,
  NULL,
  now(),
  now()
FROM (
  SELECT DISTINCT
    ur.user_id,
    ub.branch_id,
    m.id AS module_id
  FROM public.user_roles ur
  JOIN public.user_branches ub
    ON ub.user_id = ur.user_id
  JOIN public.modules m
    ON m.code = 'sucursales'
  WHERE ur.role IN ('admin'::public.app_role, 'superadmin'::public.app_role)
) AS src
ON CONFLICT (user_id, branch_id, module_id)
DO UPDATE SET
  is_active = true,
  updated_at = now();
