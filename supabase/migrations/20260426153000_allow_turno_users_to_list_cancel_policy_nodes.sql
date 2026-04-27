DROP FUNCTION IF EXISTS public.list_branch_cancel_policy_nodes(uuid);
CREATE OR REPLACE FUNCTION public.list_branch_cancel_policy_nodes(
  p_branch_id uuid
)
RETURNS TABLE (
  menu_node_id uuid,
  menu_node_name text,
  menu_scope text,
  parent_id uuid,
  depth integer,
  descendant_product_count integer,
  is_primary_root_category boolean,
  is_kitchen_plate boolean,
  allow_direct_cancel boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar anulaciones directas en esta sucursal';
  END IF;

  RETURN QUERY
  SELECT
    mn.id AS menu_node_id,
    mn.name AS menu_node_name,
    mn.menu_scope,
    mn.parent_id,
    mn.depth,
    children.descendant_product_count,
    mn.id = first_root.first_root_category_id AS is_primary_root_category,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(bcp.allow_direct_cancel, false) AS allow_direct_cancel
  FROM public.menu_nodes mn
  JOIN LATERAL (
    WITH RECURSIVE descendants AS (
      SELECT child.id, child.parent_id, child.node_type
      FROM public.menu_nodes child
      WHERE child.parent_id = mn.id

      UNION ALL

      SELECT next_child.id, next_child.parent_id, next_child.node_type
      FROM public.menu_nodes next_child
      JOIN descendants d ON d.id = next_child.parent_id
    )
    SELECT COUNT(*)::integer AS descendant_product_count
    FROM descendants
    WHERE node_type = 'product'
  ) children ON true
  CROSS JOIN LATERAL (
    SELECT root.id AS first_root_category_id
    FROM public.menu_nodes root
    WHERE root.branch_id = p_branch_id
      AND root.node_type = 'category'
      AND root.depth = 0
      AND root.parent_id IS NULL
      AND root.is_active = true
    ORDER BY root.menu_scope, root.display_order, root.name, root.id
    LIMIT 1
  ) first_root
  LEFT JOIN public.branch_cancel_policy bcp
    ON bcp.branch_id = p_branch_id
   AND bcp.menu_node_id = mn.id
  WHERE mn.branch_id = p_branch_id
    AND mn.node_type = 'category'
    AND mn.is_active = true
    AND mn.depth = 0
    AND mn.parent_id IS NULL
  ORDER BY mn.menu_scope, mn.depth, mn.display_order, mn.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_branch_cancel_policy_nodes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
