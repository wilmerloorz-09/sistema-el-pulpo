-- Fix Security Advisor findings:
-- 1) permission views should run as security invoker
-- 2) dispatch_config and dispatch_assignments must be protected by RLS

ALTER VIEW IF EXISTS public.v_user_effective_permissions
SET (security_invoker = true);

ALTER VIEW IF EXISTS public.v_user_accessible_branches
SET (security_invoker = true);

ALTER TABLE IF EXISTS public.dispatch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dispatch_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dispatch config can be viewed by branch dispatch users" ON public.dispatch_config;
DROP POLICY IF EXISTS "Dispatch config can be managed by branch admins" ON public.dispatch_config;

CREATE POLICY "Dispatch config can be viewed by branch dispatch users"
ON public.dispatch_config
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), branch_id, 'admin_sucursal', 'MANAGE')
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_total', 'VIEW')
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_mesa', 'VIEW')
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_para_llevar', 'VIEW')
);

CREATE POLICY "Dispatch config can be managed by branch admins"
ON public.dispatch_config
FOR ALL
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), branch_id, 'admin_sucursal', 'MANAGE')
)
WITH CHECK (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), branch_id, 'admin_sucursal', 'MANAGE')
);

DROP POLICY IF EXISTS "Dispatch assignments can be viewed by branch dispatch users" ON public.dispatch_assignments;
DROP POLICY IF EXISTS "Dispatch assignments can be managed by branch admins" ON public.dispatch_assignments;

CREATE POLICY "Dispatch assignments can be viewed by branch dispatch users"
ON public.dispatch_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND (
        public.is_global_admin(auth.uid())
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'admin_sucursal', 'MANAGE')
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_total', 'VIEW')
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_mesa', 'VIEW')
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_para_llevar', 'VIEW')
      )
  )
);

CREATE POLICY "Dispatch assignments can be managed by branch admins"
ON public.dispatch_assignments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND (
        public.is_global_admin(auth.uid())
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'admin_sucursal', 'MANAGE')
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND (
        public.is_global_admin(auth.uid())
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'admin_sucursal', 'MANAGE')
      )
  )
);

NOTIFY pgrst, 'reload schema';
