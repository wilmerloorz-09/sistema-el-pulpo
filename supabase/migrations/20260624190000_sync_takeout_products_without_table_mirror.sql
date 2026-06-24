-- Fallback: si no hay JUGOS (u otra subcategoria) en Menu Mesas, usar la categoria Con envase.

CREATE OR REPLACE FUNCTION public.mirror_menu_category_chain_to_legacy(
  p_branch_id uuid,
  p_category_node_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_id uuid;
BEGIN
  FOR v_cat_id IN
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 0 AS depth
      FROM public.menu_nodes
      WHERE id = p_category_node_id
      UNION ALL
      SELECT p.id, p.parent_id, c.depth + 1
      FROM public.menu_nodes p
      JOIN chain c ON c.parent_id = p.id
      WHERE p.branch_id = p_branch_id
    )
    SELECT id
    FROM chain
    ORDER BY depth DESC
  LOOP
    PERFORM public.ensure_legacy_subcategory_mirror(p_branch_id, v_cat_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_menu_node_to_legacy_product(p_menu_node_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node public.menu_nodes%ROWTYPE;
  v_category_id uuid;
  v_table_category_id uuid;
  v_subcategory_id uuid;
  v_legacy_product_id uuid;
  v_display_order integer;
  v_walk_id uuid;
BEGIN
  SELECT *
  INTO v_node
  FROM public.menu_nodes
  WHERE id = p_menu_node_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nodo de menu no encontrado';
  END IF;

  IF v_node.node_type <> 'product' THEN
    RAISE EXCEPTION 'El nodo % no es un producto', p_menu_node_id;
  END IF;

  IF v_node.legacy_product_id IS NOT NULL AND btrim(v_node.legacy_product_id::text) <> '' THEN
    RETURN v_node.legacy_product_id;
  END IF;

  v_category_id := v_node.parent_id;
  v_walk_id := v_category_id;
  WHILE v_walk_id IS NOT NULL LOOP
    IF EXISTS (
      SELECT 1 FROM public.menu_nodes c
      WHERE c.id = v_walk_id AND c.node_type = 'category'
    ) THEN
      v_category_id := v_walk_id;
      EXIT;
    END IF;
    SELECT parent_id INTO v_walk_id FROM public.menu_nodes WHERE id = v_walk_id;
  END LOOP;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'El producto % no tiene categoria ancestro valida', p_menu_node_id;
  END IF;

  IF v_node.menu_scope = 'TABLE' THEN
    PERFORM public.mirror_menu_category_chain_to_legacy(v_node.branch_id, v_category_id);
    v_subcategory_id := v_category_id;
    v_legacy_product_id := p_menu_node_id;
  ELSE
    BEGIN
      v_table_category_id := public.resolve_table_menu_category_for_takeout(v_node.branch_id, v_category_id);
      PERFORM public.mirror_menu_category_chain_to_legacy(v_node.branch_id, v_table_category_id);
      v_subcategory_id := v_table_category_id;
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM public.mirror_menu_category_chain_to_legacy(v_node.branch_id, v_category_id);
        v_subcategory_id := v_category_id;
    END;
    v_legacy_product_id := gen_random_uuid();
  END IF;

  SELECT COALESCE(MAX(display_order), 0) + 1
  INTO v_display_order
  FROM public.products
  WHERE subcategory_id = v_subcategory_id;

  INSERT INTO public.products (
    id,
    subcategory_id,
    description,
    unit_price,
    price_mode,
    display_order,
    is_active
  )
  VALUES (
    v_legacy_product_id,
    v_subcategory_id,
    v_node.name,
    COALESCE(v_node.price, 0),
    CASE WHEN v_node.menu_scope = 'BULK' THEN 'MANUAL'::public.price_mode ELSE 'FIXED'::public.price_mode END,
    v_display_order,
    COALESCE(v_node.is_active, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET
    subcategory_id = EXCLUDED.subcategory_id,
    description = EXCLUDED.description,
    unit_price = EXCLUDED.unit_price,
    price_mode = EXCLUDED.price_mode,
    is_active = EXCLUDED.is_active;

  UPDATE public.menu_nodes
  SET legacy_product_id = v_legacy_product_id,
      updated_at = now()
  WHERE id = p_menu_node_id;

  RETURN v_legacy_product_id;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.menu_nodes
    WHERE node_type = 'product'
      AND menu_scope IN ('TAKEOUT', 'BULK', 'TABLE')
      AND (legacy_product_id IS NULL OR btrim(legacy_product_id::text) = '')
      AND COALESCE(is_active, true)
  LOOP
    BEGIN
      PERFORM public.sync_menu_node_to_legacy_product(r.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'No se pudo sincronizar menu_node %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.mirror_menu_category_chain_to_legacy(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mirror_menu_category_chain_to_legacy(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
