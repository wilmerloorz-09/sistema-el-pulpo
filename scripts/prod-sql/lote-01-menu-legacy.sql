-- lote-01-menu-legacy
-- Ejecutar en Supabase SQL Editor (produccion)
-- Fecha: 2026-08-30

-- ===== 20260824150000_repair_orphan_menu_legacy_product.sql =====
-- Si legacy_product_id apunta a un product inexistente, re-sincroniza en lugar de devolver el UUID huÃ©rfano.
-- Preferir producto TABLE homÃ³nimo (o Pepsi/Tropical con nombre equivalente) antes de crear uno nuevo.
-- Backfill: Pepsi/Tropical TAKEOUT sin legacy.

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
  v_legacy_exists boolean := false;
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
    SELECT EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = v_node.legacy_product_id
    ) INTO v_legacy_exists;

    IF v_legacy_exists THEN
      RETURN v_node.legacy_product_id;
    END IF;

    -- Legacy huÃ©rfano: limpiar para recrear enlace vÃ¡lido.
    UPDATE public.menu_nodes
    SET legacy_product_id = NULL,
        updated_at = now()
    WHERE id = p_menu_node_id;

    v_node.legacy_product_id := NULL;
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
    -- 1) Mismo nombre exacto en menÃº de mesa.
    SELECT COALESCE(t.legacy_product_id, t.id)
    INTO v_legacy_product_id
    FROM public.menu_nodes t
    WHERE t.branch_id = v_node.branch_id
      AND t.menu_scope = 'TABLE'
      AND t.node_type = 'product'
      AND t.name = v_node.name
      AND (
        (t.legacy_product_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.products p WHERE p.id = t.legacy_product_id
        ))
        OR EXISTS (
          SELECT 1 FROM public.products p WHERE p.id = t.id
        )
      )
    ORDER BY t.updated_at DESC NULLS LAST
    LIMIT 1;

    -- 2) Pepsi / Tropical con nombres operativos distintos (TAKEOUT vs TABLE).
    IF v_legacy_product_id IS NULL THEN
      SELECT COALESCE(t.legacy_product_id, t.id)
      INTO v_legacy_product_id
      FROM public.menu_nodes t
      WHERE t.branch_id = v_node.branch_id
        AND t.menu_scope = 'TABLE'
        AND t.node_type = 'product'
        AND COALESCE(t.is_active, true)
        AND (
          (
            v_node.name ILIKE '%pepsi%'
            AND v_node.name ~* '1(\.|,)?\s*l'
            AND (v_node.name ILIKE '%past%' OR v_node.name ILIKE '%plast%')
            AND (t.name ILIKE '%pepsi%' OR t.name ILIKE '%pspsi%')
            AND t.name ~* '1'
            AND t.name ILIKE '%plast%'
          )
          OR (
            v_node.name ILIKE '%pepsi%'
            AND v_node.name ILIKE '%300%'
            AND (v_node.name ILIKE '%past%' OR v_node.name ILIKE '%plast%')
            AND t.name ILIKE '%pepsi%'
            AND t.name ILIKE '%300%'
            AND t.name ILIKE '%plast%'
          )
          OR (
            v_node.name ILIKE '%tropical%'
            AND v_node.name ~* '1(\.|,)?\s*l'
            AND t.name ILIKE '%tropical%'
            AND t.name ~* '1'
            AND t.name NOT ILIKE '%300%'
          )
          OR (
            v_node.name ILIKE '%tropical%'
            AND v_node.name ILIKE '%300%'
            AND t.name ILIKE '%tropical%'
            AND t.name ILIKE '%300%'
          )
        )
        AND (
          (t.legacy_product_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = t.legacy_product_id
          ))
          OR EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = t.id
          )
        )
      ORDER BY t.updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF v_legacy_product_id IS NOT NULL THEN
      UPDATE public.menu_nodes
      SET legacy_product_id = v_legacy_product_id,
          updated_at = now()
      WHERE id = p_menu_node_id;

      RETURN v_legacy_product_id;
    END IF;

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

GRANT EXECUTE ON FUNCTION public.sync_menu_node_to_legacy_product(uuid) TO authenticated;

-- Backfill inmediato: Pepsi / Tropical TAKEOUT sin legacy â†’ producto TABLE equivalente.
WITH matched AS (
  SELECT
    t.id AS takeout_id,
    (
      SELECT COALESCE(tn.legacy_product_id, tn.id)
      FROM public.menu_nodes tn
      WHERE tn.branch_id = t.branch_id
        AND tn.menu_scope = 'TABLE'
        AND tn.node_type = 'product'
        AND COALESCE(tn.is_active, true)
        AND (
          tn.name = t.name
          OR (
            t.name ILIKE '%pepsi%'
            AND t.name ~* '1(\.|,)?\s*l'
            AND (t.name ILIKE '%past%' OR t.name ILIKE '%plast%')
            AND (tn.name ILIKE '%pepsi%' OR tn.name ILIKE '%pspsi%')
            AND tn.name ~* '1'
            AND tn.name ILIKE '%plast%'
          )
          OR (
            t.name ILIKE '%pepsi%'
            AND t.name ILIKE '%300%'
            AND (t.name ILIKE '%past%' OR t.name ILIKE '%plast%')
            AND tn.name ILIKE '%pepsi%'
            AND tn.name ILIKE '%300%'
            AND tn.name ILIKE '%plast%'
          )
          OR (
            t.name ILIKE '%tropical%'
            AND t.name ~* '1(\.|,)?\s*l'
            AND tn.name ILIKE '%tropical%'
            AND tn.name ~* '1'
            AND tn.name NOT ILIKE '%300%'
          )
          OR (
            t.name ILIKE '%tropical%'
            AND t.name ILIKE '%300%'
            AND tn.name ILIKE '%tropical%'
            AND tn.name ILIKE '%300%'
          )
        )
        AND (
          (tn.legacy_product_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = tn.legacy_product_id
          ))
          OR EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = tn.id
          )
        )
      ORDER BY tn.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS legacy_id
  FROM public.menu_nodes t
  WHERE t.menu_scope = 'TAKEOUT'
    AND t.node_type = 'product'
    AND t.legacy_product_id IS NULL
    AND (t.name ILIKE '%pepsi%' OR t.name ILIKE '%tropical%')
)
UPDATE public.menu_nodes mn
SET legacy_product_id = matched.legacy_id,
    updated_at = now()
FROM matched
WHERE mn.id = matched.takeout_id
  AND matched.legacy_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';



-- ===== 20260824160000_enforce_menu_product_legacy_link.sql =====
-- Impide productos de menu_nodes sin enlace vÃ¡lido a public.products.
-- Si falta o estÃ¡ huÃ©rfano, intenta sync_menu_node_to_legacy_product;
-- si aÃºn asÃ­ queda invÃ¡lido, aborta la transacciÃ³n.

CREATE OR REPLACE FUNCTION public.menu_node_has_valid_legacy_product(
  p_legacy_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_legacy_product_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = p_legacy_product_id
    );
$$;

CREATE OR REPLACE FUNCTION public.trg_menu_nodes_ensure_product_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.node_type IS DISTINCT FROM 'product' THEN
    RETURN NEW;
  END IF;

  -- Ya vÃ¡lido: no tocar (evita recursiÃ³n al UPDATE de legacy desde sync).
  IF public.menu_node_has_valid_legacy_product(NEW.legacy_product_id) THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_menu_node_to_legacy_product(NEW.id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = NEW.id
      AND public.menu_node_has_valid_legacy_product(mn.legacy_product_id)
  ) THEN
    RAISE EXCEPTION
      'No se puede guardar el producto de menu "%" (%) sin enlace valido a products. Revisa categoria espejo / sync.',
      NEW.name,
      NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_nodes_ensure_product_legacy ON public.menu_nodes;

CREATE TRIGGER trg_menu_nodes_ensure_product_legacy
  AFTER INSERT OR UPDATE OF
    node_type,
    legacy_product_id,
    name,
    parent_id,
    price,
    is_active,
    menu_scope,
    branch_id
  ON public.menu_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_menu_nodes_ensure_product_legacy();

-- Sanea cualquier producto activo que haya quedado invÃ¡lido (defensa + backfill).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT mn.id
    FROM public.menu_nodes mn
    WHERE mn.node_type = 'product'
      AND NOT public.menu_node_has_valid_legacy_product(mn.legacy_product_id)
  LOOP
    BEGIN
      PERFORM public.sync_menu_node_to_legacy_product(r.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo auto-reparar menu_node %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';




