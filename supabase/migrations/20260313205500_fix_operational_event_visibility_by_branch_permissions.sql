-- Allow branch users to read operational order events with the new module/branch permission model.
-- Without this, users created under the new access model can dispatch via SECURITY DEFINER RPCs
-- but fail to read the event tables that power Enviadas/Listas/Despachadas in Ordenes.

CREATE POLICY "Users can view ready events by branch permission"
ON public.order_ready_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_ready_events.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);

CREATE POLICY "Users can view ready event lines by branch permission"
ON public.order_item_ready_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_item_ready_events.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);

CREATE POLICY "Users can view dispatch events by branch permission"
ON public.order_dispatch_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_dispatch_events.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);

CREATE POLICY "Users can view dispatch event lines by branch permission"
ON public.order_item_dispatch_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_item_dispatch_events.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);

CREATE POLICY "Users can view order cancellations by branch permission"
ON public.order_cancellations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_cancellations.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);

CREATE POLICY "Users can view order item cancellations by branch permission"
ON public.order_item_cancellations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_item_cancellations.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  )
);
