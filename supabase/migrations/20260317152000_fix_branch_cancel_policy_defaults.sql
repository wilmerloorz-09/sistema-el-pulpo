DROP FUNCTION IF EXISTS public.list_branch_cancel_policy_nodes(uuid);
CREATE OR REPLACE FUNCTION public.list_branch_cancel_policy_nodes(
  p_branch_id uuid
)
RETURNS TABLE (
  menu_node_id uuid,
  menu_node_name text,
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

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar anulaciones directas en esta sucursal';
  END IF;

  RETURN QUERY
  SELECT
    mn.id AS menu_node_id,
    mn.name AS menu_node_name,
    mn.parent_id,
    mn.depth,
    children.descendant_product_count,
    mn.id = first_root.first_root_category_id AS is_primary_root_category,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(
      bcp.allow_direct_cancel,
      CASE
        WHEN mn.id = first_root.first_root_category_id THEN false
        ELSE true
      END
    ) AS allow_direct_cancel
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
    ORDER BY root.display_order, root.name, root.id
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
  ORDER BY mn.depth, mn.display_order, mn.name;
END;
$$;

DROP FUNCTION IF EXISTS public.get_branch_cancel_policy_for_product(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_branch_cancel_policy_for_product(
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS TABLE (
  policy_menu_node_id uuid,
  policy_menu_node_name text,
  is_kitchen_plate boolean,
  allow_direct_cancel boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active_branch_id = p_branch_id
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para consultar esta politica de anulacion';
  END IF;

  RETURN QUERY
  WITH RECURSIVE ancestors AS (
    SELECT mn.id, mn.parent_id, mn.name, mn.depth, mn.node_type
    FROM public.menu_nodes mn
    WHERE mn.id = p_product_id
      AND mn.branch_id = p_branch_id
      AND mn.node_type = 'product'

    UNION ALL

    SELECT parent.id, parent.parent_id, parent.name, parent.depth, parent.node_type
    FROM public.menu_nodes parent
    JOIN ancestors child ON child.parent_id = parent.id
  ),
  first_root AS (
    SELECT root.id AS first_root_category_id
    FROM public.menu_nodes root
    WHERE root.branch_id = p_branch_id
      AND root.node_type = 'category'
      AND root.depth = 0
      AND root.parent_id IS NULL
      AND root.is_active = true
    ORDER BY root.display_order, root.name, root.id
    LIMIT 1
  )
  SELECT
    root.id AS policy_menu_node_id,
    root.name AS policy_menu_node_name,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(
      bcp.allow_direct_cancel,
      CASE
        WHEN root.id = first_root.first_root_category_id THEN false
        ELSE true
      END
    ) AS allow_direct_cancel
  FROM ancestors root
  CROSS JOIN first_root
  LEFT JOIN public.branch_cancel_policy bcp
    ON bcp.branch_id = p_branch_id
   AND bcp.menu_node_id = root.id
  WHERE root.node_type = 'category'
    AND root.depth = 0
    AND root.parent_id IS NULL
  ORDER BY root.depth, root.name
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_branch_cancel_policy_nodes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_cancel_policy_for_product(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
