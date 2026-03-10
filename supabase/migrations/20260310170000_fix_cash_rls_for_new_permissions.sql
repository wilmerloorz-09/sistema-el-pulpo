-- Align cash module RLS with the new permission model

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
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_global', 'MANAGE'::public.access_level);
$$;

DROP POLICY IF EXISTS "Cajeros can insert shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cajeros can update shifts" ON public.cash_shifts;

CREATE POLICY "Users can insert cash shifts by permission"
ON public.cash_shifts
FOR INSERT
TO authenticated
WITH CHECK (public.can_operate_cash_branch(auth.uid(), branch_id));

CREATE POLICY "Users can update cash shifts by permission"
ON public.cash_shifts
FOR UPDATE
TO authenticated
USING (public.can_operate_cash_branch(auth.uid(), branch_id))
WITH CHECK (public.can_operate_cash_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Cajeros can insert shift denoms" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Cajeros can update shift denoms" ON public.cash_shift_denoms;

CREATE POLICY "Users can insert cash shift denoms by permission"
ON public.cash_shift_denoms
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);

CREATE POLICY "Users can update cash shift denoms by permission"
ON public.cash_shift_denoms
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_denoms.shift_id
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);

DROP POLICY IF EXISTS "Cajeros can insert movements" ON public.cash_movements;

CREATE POLICY "Users can insert cash movements by permission"
ON public.cash_movements
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);
