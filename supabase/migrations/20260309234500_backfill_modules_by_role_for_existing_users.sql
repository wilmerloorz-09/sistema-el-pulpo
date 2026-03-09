-- Backfill default module access by role per enabled user branch

INSERT INTO public.user_branch_modules (
  user_id,
  branch_id,
  module_id,
  is_active,
  assigned_by,
  created_at,
  updated_at
)
SELECT DISTINCT
  ur.user_id,
  ub.branch_id,
  m.id,
  true,
  NULL::uuid,
  now(),
  now()
FROM public.user_roles ur
JOIN public.user_branches ub
  ON ub.user_id = ur.user_id
JOIN public.modules m
  ON (
    (ur.role IN ('admin'::public.app_role, 'superadmin'::public.app_role) AND m.code IN ('mesas','ordenes','despacho','caja','pagos','reportes','usuarios','configuracion','sucursales'))
    OR (ur.role = 'supervisor'::public.app_role AND m.code IN ('mesas','ordenes','despacho','caja','pagos','reportes','usuarios'))
    OR (ur.role = 'mesero'::public.app_role AND m.code IN ('mesas','ordenes'))
    OR (ur.role = 'cajero'::public.app_role AND m.code IN ('caja','pagos'))
    OR (ur.role = 'cocina'::public.app_role AND m.code IN ('despacho'))
    OR (ur.role = 'despachador_mesas'::public.app_role AND m.code IN ('despacho'))
    OR (ur.role = 'despachador_takeout'::public.app_role AND m.code IN ('despacho'))
  )
WHERE m.is_active = true
ON CONFLICT (user_id, branch_id, module_id)
DO UPDATE SET
  is_active = true,
  updated_at = now();

