-- Evita duplicar categories al sincronizar Con envase: reutiliza la raiz de Menu Mesas por nombre.

CREATE OR REPLACE FUNCTION public.ensure_takeout_subcategory_legacy_mirror(
  p_branch_id uuid,
  p_takeout_category_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node public.menu_nodes%ROWTYPE;
  v_root public.menu_nodes%ROWTYPE;
  v_root_category_id uuid;
BEGIN
  SELECT *
  INTO v_node
  FROM public.menu_nodes
  WHERE id = p_takeout_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria Con envase no encontrada: %', p_takeout_category_id;
  END IF;

  WITH RECURSIVE chain AS (
    SELECT id, parent_id
    FROM public.menu_nodes
    WHERE id = p_takeout_category_id
    UNION ALL
    SELECT p.id, p.parent_id
    FROM public.menu_nodes p
    JOIN chain c ON c.parent_id = p.id
  )
  SELECT mn.*
  INTO v_root
  FROM public.menu_nodes mn
  JOIN chain ON chain.id = mn.id
  WHERE mn.parent_id IS NULL
  LIMIT 1;

  SELECT c.id
  INTO v_root_category_id
  FROM public.categories c
  WHERE c.branch_id = p_branch_id
    AND lower(trim(c.description)) = lower(trim(v_root.name))
  ORDER BY c.display_order NULLS LAST, c.id
  LIMIT 1;

  IF v_root_category_id IS NULL THEN
    SELECT mn.id
    INTO v_root_category_id
    FROM public.menu_nodes mn
    WHERE mn.branch_id = p_branch_id
      AND mn.menu_scope = 'TABLE'
      AND mn.node_type = 'category'
      AND mn.parent_id IS NULL
      AND lower(trim(mn.name)) = lower(trim(v_root.name))
    ORDER BY mn.display_order NULLS LAST, mn.id
    LIMIT 1;
  END IF;

  IF v_root_category_id IS NULL THEN
    RAISE EXCEPTION 'No hay categoria raiz equivalente en Menu Mesas para %', v_root.name;
  END IF;

  IF v_node.parent_id IS NULL THEN
    INSERT INTO public.categories (id, branch_id, description, display_order, is_active)
    SELECT
      v_node.id,
      p_branch_id,
      v_node.name,
      COALESCE(v_node.display_order, 1),
      COALESCE(v_node.is_active, true)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.subcategories (id, category_id, description, display_order, is_active)
  VALUES (
    v_node.id,
    v_root_category_id,
    v_node.name,
    COALESCE(
      (SELECT s.display_order FROM public.subcategories s WHERE s.id = v_node.id),
      (
        SELECT COALESCE(MAX(s.display_order), 0) + 1
        FROM public.subcategories s
        WHERE s.category_id = v_root_category_id
          AND s.id IS DISTINCT FROM v_node.id
      ),
      COALESCE(v_node.display_order, 1)
    ),
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
        v_subcategory_id := public.ensure_takeout_subcategory_legacy_mirror(v_node.branch_id, v_category_id);
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
    WHERE id IN (
      '9a73ab1c-7a98-49d8-a314-37d848bb76b0',
      '7da83dd8-0ac8-4a66-bad7-496e94daa1f9',
      '5975ef9e-af01-40d6-b804-a600b62e1553'
    )
    AND (legacy_product_id IS NULL OR btrim(legacy_product_id::text) = '')
  LOOP
    PERFORM public.sync_menu_node_to_legacy_product(r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_takeout_subcategory_legacy_mirror(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_takeout_subcategory_legacy_mirror(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
