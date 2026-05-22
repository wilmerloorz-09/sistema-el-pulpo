-- Supervisores con permiso turno MANAGE pueden leer plantillas de caja al configurar cajas secundarias.

DROP POLICY IF EXISTS "Users can view cash register templates by branch permission" ON public.cash_register_templates;
CREATE POLICY "Users can view cash register templates by branch permission"
ON public.cash_register_templates
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
  OR public.can_manage_shift_admin(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Users can view cash register template denoms by branch permission" ON public.cash_register_template_denoms;
CREATE POLICY "Users can view cash register template denoms by branch permission"
ON public.cash_register_template_denoms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND (
        public.can_operate_cash_branch(auth.uid(), crt.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), crt.branch_id)
        OR public.can_manage_shift_admin(auth.uid(), crt.branch_id)
      )
  )
);
