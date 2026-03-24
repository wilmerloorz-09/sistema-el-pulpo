DROP POLICY IF EXISTS "Users can insert pending order cancellations by branch permission" ON public.order_cancellations;
CREATE POLICY "Users can insert pending order cancellations by branch permission"
ON public.order_cancellations
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND status = 'VOIDED'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_cancellations.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
      )
  )
);

DROP POLICY IF EXISTS "Users can insert pending order item cancellations by branch permission" ON public.order_item_cancellations;
CREATE POLICY "Users can insert pending order item cancellations by branch permission"
ON public.order_item_cancellations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.order_cancellations oc
      ON oc.id = order_item_cancellations.order_cancellation_id
    WHERE o.id = order_item_cancellations.order_id
      AND oc.order_id = order_item_cancellations.order_id
      AND oc.created_by = auth.uid()
      AND oc.status = 'VOIDED'
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
      )
  )
);
