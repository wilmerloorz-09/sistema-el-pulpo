-- Un producto global solo una vez por menú (branch + scope).
-- Puede repetirse en otro scope (TABLE vs TAKEOUT, etc.).

DROP INDEX IF EXISTS public.uq_menu_nodes_parent_producto_global;

CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_nodes_scope_producto_global
  ON public.menu_nodes (branch_id, menu_scope, producto_global_id)
  WHERE node_type = 'product'
    AND producto_global_id IS NOT NULL;
