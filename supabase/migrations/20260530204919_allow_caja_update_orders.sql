DROP POLICY IF EXISTS "Users can insert orders by branch operate permission" ON public.orders;
DROP POLICY IF EXISTS "Users can update orders by branch operate permission" ON public.orders;
DROP POLICY IF EXISTS "Users can delete orders by branch operate permission" ON public.orders;

CREATE POLICY "Users can insert orders by branch operate permission"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'caja', 'OPERATE'::public.access_level)
  );

CREATE POLICY "Users can update orders by branch operate permission"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'caja', 'OPERATE'::public.access_level)
  )
  WITH CHECK (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'caja', 'OPERATE'::public.access_level)
  );

CREATE POLICY "Users can delete orders by branch operate permission"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), branch_id, 'caja', 'OPERATE'::public.access_level)
  );
