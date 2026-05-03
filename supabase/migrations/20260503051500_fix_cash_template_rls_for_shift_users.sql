-- Fix RLS for cash register templates to include active shift cashier assignments
-- This ensures that users assigned as cashiers for a specific shift can see templates
-- even if they don't have the permanent branch-level 'cajero' role.

CREATE OR REPLACE FUNCTION public.can_operate_cash_branch(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'caja', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_sucursal', 'MANAGE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_global', 'MANAGE'::public.access_level)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
      WHERE cs.branch_id = p_branch_id
        AND cs.status = 'OPEN'
        AND csu.user_id = p_user_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    );
$$;
