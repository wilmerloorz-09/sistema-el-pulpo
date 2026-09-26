-- Nevera: solo Administrador general o usuario con módulo inventario_movimientos
-- (asignación explícita; no heredar por admin de sucursal).

CREATE OR REPLACE FUNCTION public.can_operate_inventario_movimientos(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'MANAGE'::public.access_level)
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_modules ubm
      JOIN public.modules m ON m.id = ubm.module_id
      WHERE ubm.user_id = p_user_id
        AND ubm.branch_id = p_branch_id
        AND ubm.is_active = true
        AND m.code = 'inventario_movimientos'
        AND m.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_inventario_movimientos(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_operate_inventario_movimientos(p_user_id, p_branch_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'VIEW'::public.access_level);
$$;

UPDATE public.modules
SET
  name = 'Movimientos de nevera',
  description = 'Registrar ingresos, salidas y ajustes del inventario de nevera por sucursal',
  updated_at = now()
WHERE code = 'inventario_movimientos';

NOTIFY pgrst, 'reload schema';
