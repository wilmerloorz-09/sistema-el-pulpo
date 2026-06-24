-- Sincroniza menu_nodes (producto) sin legacy_product_id hacia public.products.

CREATE OR REPLACE FUNCTION public.ensure_legacy_subcategory_mirror(
  p_branch_id uuid,
  p_category_node_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node public.menu_nodes%ROWTYPE;
  v_root_id uuid;
BEGIN
  SELECT *
  INTO v_node
  FROM public.menu_nodes
  WHERE id = p_category_node_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria no encontrada: %', p_category_node_id;
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id
    FROM public.menu_nodes
    WHERE id = p_category_node_id
    UNION ALL
    SELECT p.id, p.parent_id
    FROM public.menu_nodes p
    JOIN ancestors a ON a.parent_id = p.id
  )
  SELECT id
  INTO v_root_id
  FROM ancestors
  WHERE parent_id IS NULL
  LIMIT 1;

  IF v_node.parent_id IS NULL THEN
    INSERT INTO public.categories (id, branch_id, description, display_order, is_active)
    VALUES (
      v_node.id,
      p_branch_id,
      v_node.name,
      COALESCE(v_node.display_order, 1),
      COALESCE(v_node.is_active, true)
    )
    ON CONFLICT (id) DO UPDATE
    SET
      description = EXCLUDED.description,
      display_order = EXCLUDED.display_order,
      is_active = EXCLUDED.is_active,
      branch_id = EXCLUDED.branch_id;
  END IF;

  INSERT INTO public.subcategories (id, category_id, description, display_order, is_active)
  VALUES (
    v_node.id,
    v_root_id,
    v_node.name,
    COALESCE(v_node.display_order, 1),
    COALESCE(v_node.is_active, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active;

  RETURN v_node.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_table_menu_category_for_takeout(
  p_branch_id uuid,
  p_takeout_category_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_takeout_path text;
  v_table_id uuid;
  v_table_path text;
BEGIN
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, lower(trim(name)) AS nm, 1 AS depth
    FROM public.menu_nodes
    WHERE id = p_takeout_category_id
    UNION ALL
    SELECT p.id, p.parent_id, lower(trim(p.name)), c.depth + 1
    FROM public.menu_nodes p
    JOIN chain c ON c.parent_id = p.id
    WHERE p.branch_id = p_branch_id
      AND p.menu_scope IN ('TAKEOUT', 'BULK')
  )
  SELECT string_agg(nm, '>' ORDER BY depth DESC)
  INTO v_takeout_path
  FROM chain;

  FOR v_table_id IN
    SELECT leaf.id
    FROM public.menu_nodes leaf
    WHERE leaf.branch_id = p_branch_id
      AND leaf.menu_scope = 'TABLE'
      AND leaf.node_type = 'category'
      AND NOT EXISTS (
        SELECT 1
        FROM public.menu_nodes ch
        WHERE ch.parent_id = leaf.id
          AND ch.node_type = 'category'
          AND ch.menu_scope = 'TABLE'
          AND ch.branch_id = p_branch_id
      )
  LOOP
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, lower(trim(name)) AS nm, 1 AS depth
      FROM public.menu_nodes
      WHERE id = v_table_id
      UNION ALL
      SELECT p.id, p.parent_id, lower(trim(p.name)), c.depth + 1
      FROM public.menu_nodes p
      JOIN chain c ON c.parent_id = p.id
      WHERE p.branch_id = p_branch_id
        AND p.menu_scope = 'TABLE'
    )
    SELECT string_agg(nm, '>' ORDER BY depth DESC)
    INTO v_table_path
    FROM chain;

    IF v_table_path = v_takeout_path THEN
      RETURN v_table_id;
    END IF;
  END LOOP;

  SELECT tc.id
  INTO v_table_id
  FROM public.menu_nodes tc
  WHERE tc.branch_id = p_branch_id
    AND tc.menu_scope = 'TABLE'
    AND tc.node_type = 'category'
    AND lower(trim(tc.name)) = (
      SELECT lower(trim(name))
      FROM public.menu_nodes
      WHERE id = p_takeout_category_id
    )
  ORDER BY tc.display_order NULLS LAST, tc.name
  LIMIT 1;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Sin categoria equivalente en Menu Mesas para %', p_takeout_category_id;
  END IF;

  RETURN v_table_id;
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
  WHILE v_category_id IS NOT NULL LOOP
    IF EXISTS (
      SELECT 1
      FROM public.menu_nodes c
      WHERE c.id = v_category_id
        AND c.node_type = 'category'
    ) THEN
      EXIT;
    END IF;
    SELECT parent_id INTO v_category_id FROM public.menu_nodes WHERE id = v_category_id;
  END LOOP;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'El producto % no tiene categoria ancestro valida', p_menu_node_id;
  END IF;

  IF v_node.menu_scope = 'TABLE' THEN
    v_subcategory_id := public.ensure_legacy_subcategory_mirror(v_node.branch_id, v_category_id);
    v_legacy_product_id := p_menu_node_id;
  ELSE
    v_table_category_id := public.resolve_table_menu_category_for_takeout(v_node.branch_id, v_category_id);
    v_subcategory_id := public.ensure_legacy_subcategory_mirror(v_node.branch_id, v_table_category_id);
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

REVOKE ALL ON FUNCTION public.ensure_legacy_subcategory_mirror(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_legacy_subcategory_mirror(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_table_menu_category_for_takeout(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_table_menu_category_for_takeout(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_menu_node_to_legacy_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_menu_node_to_legacy_product(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
