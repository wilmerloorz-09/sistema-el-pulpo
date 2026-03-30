CREATE OR REPLACE FUNCTION public.get_table_products_by_root_orders(
  p_branch_id uuid,
  p_root_orders integer[] DEFAULT ARRAY[1, 2]
)
RETURNS TABLE (
  node_id uuid,
  legacy_product_id uuid,
  name text,
  display_order integer,
  root_node_id uuid,
  root_display_order integer
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE product_paths AS (
    SELECT
      mn.id AS node_id,
      mn.name,
      mn.display_order,
      mn.legacy_product_id,
      mn.parent_id,
      mn.id AS current_id
    FROM public.menu_nodes mn
    WHERE mn.branch_id = p_branch_id
      AND mn.menu_scope = 'TABLE'
      AND mn.node_type = 'product'
      AND mn.is_active = true

    UNION ALL

    SELECT
      pp.node_id,
      pp.name,
      pp.display_order,
      pp.legacy_product_id,
      parent.parent_id,
      parent.id AS current_id
    FROM product_paths pp
    JOIN public.menu_nodes parent
      ON parent.id = pp.parent_id
    WHERE parent.branch_id = p_branch_id
      AND parent.menu_scope = 'TABLE'
      AND parent.is_active = true
  )
  SELECT
    pp.node_id,
    COALESCE(pp.legacy_product_id, pp.node_id) AS legacy_product_id,
    pp.name,
    pp.display_order,
    root.id AS root_node_id,
    root.display_order AS root_display_order
  FROM product_paths pp
  JOIN public.menu_nodes root
    ON root.id = pp.current_id
  WHERE pp.parent_id IS NULL
    AND root.parent_id IS NULL
    AND root.node_type = 'category'
    AND root.display_order = ANY (p_root_orders)
  ORDER BY pp.display_order, pp.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_table_products_by_root_orders(uuid, integer[]) TO authenticated;
