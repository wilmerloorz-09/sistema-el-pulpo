ALTER TABLE public.menu_nodes
  ADD COLUMN IF NOT EXISTS menu_scope text NOT NULL DEFAULT 'TABLE',
  ADD COLUMN IF NOT EXISTS legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'menu_nodes_menu_scope_check'
      AND conrelid = 'public.menu_nodes'::regclass
  ) THEN
    ALTER TABLE public.menu_nodes
      ADD CONSTRAINT menu_nodes_menu_scope_check
      CHECK (menu_scope IN ('TABLE', 'TAKEOUT'));
  END IF;
END$$;

UPDATE public.menu_nodes
SET legacy_product_id = id
WHERE node_type = 'product'
  AND legacy_product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_menu_nodes_branch_scope_parent_order
  ON public.menu_nodes(branch_id, menu_scope, parent_id, display_order, name);

CREATE INDEX IF NOT EXISTS idx_menu_nodes_legacy_product_id
  ON public.menu_nodes(legacy_product_id)
  WHERE legacy_product_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS menu_scope text NOT NULL DEFAULT 'TABLE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_menu_scope_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_menu_scope_check
      CHECK (menu_scope IN ('TABLE', 'TAKEOUT'));
  END IF;
END$$;

UPDATE public.orders
SET menu_scope = CASE
  WHEN order_type = 'TAKEOUT' THEN 'TAKEOUT'
  ELSE 'TABLE'
END
WHERE menu_scope IS DISTINCT FROM CASE
  WHEN order_type = 'TAKEOUT' THEN 'TAKEOUT'
  ELSE 'TABLE'
END;

CREATE OR REPLACE FUNCTION public.copy_menu_scope_tree(
  p_branch_id uuid,
  p_source_scope text DEFAULT 'TABLE',
  p_target_scope text DEFAULT 'TAKEOUT'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target_ids uuid[];
  v_copied_count integer := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF p_source_scope NOT IN ('TABLE', 'TAKEOUT') OR p_target_scope NOT IN ('TABLE', 'TAKEOUT') THEN
    RAISE EXCEPTION 'menu_scope invalido';
  END IF;

  IF p_source_scope = p_target_scope THEN
    RAISE EXCEPTION 'El origen y el destino deben ser diferentes';
  END IF;

  IF v_actor_id IS NULL OR NOT public.can_manage_branch_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para copiar este arbol';
  END IF;

  SELECT array_agg(id)
  INTO v_target_ids
  FROM public.menu_nodes
  WHERE branch_id = p_branch_id
    AND menu_scope = p_target_scope;

  IF COALESCE(array_length(v_target_ids, 1), 0) > 0 THEN
    DELETE FROM public.menu_nodes
    WHERE id = ANY(v_target_ids);
  END IF;

  CREATE TEMP TABLE tmp_menu_scope_source ON COMMIT DROP AS
  SELECT *
  FROM public.menu_nodes
  WHERE branch_id = p_branch_id
    AND menu_scope = p_source_scope
  ORDER BY depth ASC, display_order ASC, created_at ASC, id ASC;

  IF NOT EXISTS (SELECT 1 FROM tmp_menu_scope_source) THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE tmp_menu_scope_map (
    source_id uuid PRIMARY KEY,
    new_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_menu_scope_map (source_id, new_id)
  SELECT id, gen_random_uuid()
  FROM tmp_menu_scope_source;

  INSERT INTO public.menu_nodes (
    id,
    branch_id,
    parent_id,
    name,
    node_type,
    depth,
    display_order,
    is_active,
    icon,
    price,
    description,
    image_url,
    menu_scope,
    legacy_product_id,
    created_at,
    updated_at
  )
  SELECT
    map.new_id,
    src.branch_id,
    parent_map.new_id,
    src.name,
    src.node_type,
    src.depth,
    src.display_order,
    src.is_active,
    src.icon,
    src.price,
    src.description,
    src.image_url,
    p_target_scope,
    CASE
      WHEN src.node_type = 'product' THEN COALESCE(src.legacy_product_id, src.id)
      ELSE NULL
    END,
    now(),
    now()
  FROM tmp_menu_scope_source src
  JOIN tmp_menu_scope_map map
    ON map.source_id = src.id
  LEFT JOIN tmp_menu_scope_map parent_map
    ON parent_map.source_id = src.parent_id;

  INSERT INTO public.menu_node_modifiers (
    id,
    node_id,
    modifier_id,
    is_active,
    display_order,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    map.new_id,
    mnm.modifier_id,
    mnm.is_active,
    mnm.display_order,
    now(),
    now()
  FROM public.menu_node_modifiers mnm
  JOIN tmp_menu_scope_map map
    ON map.source_id = mnm.node_id;

  GET DIAGNOSTICS v_copied_count = ROW_COUNT;

  RETURN (SELECT COUNT(*)::integer FROM tmp_menu_scope_source);
END;
$$;

REVOKE ALL ON FUNCTION public.copy_menu_scope_tree(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_menu_scope_tree(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
