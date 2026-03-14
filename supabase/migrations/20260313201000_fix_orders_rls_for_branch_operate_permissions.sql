-- Align operational order RLS with the branch/module permission model.
-- This unblocks mesero/supervisor users that can operate Mesas/Ordenes in their
-- active branch but were still blocked by stale orders policies in the remote DB.

CREATE POLICY "Users can insert orders by branch operate permission"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
);

CREATE POLICY "Users can update orders by branch operate permission"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
)
WITH CHECK (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
);

CREATE POLICY "Users can delete orders by branch operate permission"
ON public.orders
FOR DELETE
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR public.has_branch_permission(auth.uid(), branch_id, 'mesas', 'OPERATE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), branch_id, 'ordenes', 'OPERATE'::public.access_level)
);

CREATE POLICY "Users can insert order items by branch operate permission"
ON public.order_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can update order items by branch operate permission"
ON public.order_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can delete order items by branch operate permission"
ON public.order_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can insert order item modifiers by branch operate permission"
ON public.order_item_modifiers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can update order item modifiers by branch operate permission"
ON public.order_item_modifiers
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can delete order item modifiers by branch operate permission"
ON public.order_item_modifiers
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can insert table splits by branch operate permission"
ON public.table_splits
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.restaurant_tables rt
    WHERE rt.id = table_id
      AND (
        public.can_manage_branch_admin(auth.uid(), rt.branch_id)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can update table splits by branch operate permission"
ON public.table_splits
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.restaurant_tables rt
    WHERE rt.id = table_splits.table_id
      AND (
        public.can_manage_branch_admin(auth.uid(), rt.branch_id)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.restaurant_tables rt
    WHERE rt.id = table_splits.table_id
      AND (
        public.can_manage_branch_admin(auth.uid(), rt.branch_id)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);

CREATE POLICY "Users can delete table splits by branch operate permission"
ON public.table_splits
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.restaurant_tables rt
    WHERE rt.id = table_splits.table_id
      AND (
        public.can_manage_branch_admin(auth.uid(), rt.branch_id)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'mesas', 'OPERATE'::public.access_level)
        OR public.has_branch_permission(auth.uid(), rt.branch_id, 'ordenes', 'OPERATE'::public.access_level)
      )
  )
);
