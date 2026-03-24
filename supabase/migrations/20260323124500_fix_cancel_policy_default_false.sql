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
  )
  SELECT
    root.id AS policy_menu_node_id,
    root.name AS policy_menu_node_name,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(bcp.allow_direct_cancel, false) AS allow_direct_cancel
  FROM ancestors root
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

GRANT EXECUTE ON FUNCTION public.get_branch_cancel_policy_for_product(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
