-- Un mismo producto global no puede repetirse bajo el mismo padre (misma sucursal/scope).
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_nodes_parent_producto_global
  ON public.menu_nodes (branch_id, menu_scope, parent_id, producto_global_id)
  WHERE node_type = 'product'
    AND producto_global_id IS NOT NULL
    AND parent_id IS NOT NULL;
