-- =============================================================================
-- Crear sucursales nuevas clonando SOLO configuración desde Local Principal
-- =============================================================================
-- Uso: pegar en Supabase → SQL Editor → Run
--
-- Origen: Local Principal (Chone)
-- Destinos (idempotente: si ya existen por nombre, reutiliza y reclona config):
--   1. El Pulpo 1 Mañana  (P1M)
--   2. El Pulpo 1 Tarde   (P1T)
--   3. El Pulpo 2         (EP2)
--   4. El Pulpo 3         (EP3)
--   5. El Pulpo 4         (EP4)
--
-- Copia:
--   - Campos de sucursal (workflow, impresora, mesas ref., address)
--   - Modificadores, categorías/subcategorías/productos legacy
--   - Árbol menu_nodes (TABLE/TAKEOUT/BULK/EXTRA) + menu_node_modifiers
--   - bulk_included_products + ranges
--   - extra_frequent_products
--   - branch_cancel_policy
--   - payment_methods (no duplica Efectivo del trigger)
--   - cash_register_templates + denoms
--   - dispatch_config (sin asignaciones de usuarios)
--   - Mesas vía reference_table_count / ensure_branch_table_capacity
--
-- NO copia:
--   - Órdenes, pagos, turnos, movimientos, historial
--   - user_branches / roles / tokens QR (generar QR aparte si hace falta)
-- =============================================================================

SET statement_timeout = '600s';

BEGIN;

CREATE TEMP TABLE tmp_new_branches (
  sort_order int PRIMARY KEY,
  name text NOT NULL,
  branch_code varchar(4) NOT NULL,
  target_id uuid
) ON COMMIT DROP;

INSERT INTO tmp_new_branches (sort_order, name, branch_code) VALUES
  (1, 'El Pulpo 1 Mañana', 'P1M'),
  (2, 'El Pulpo 1 Tarde',  'P1T'),
  (3, 'El Pulpo 2',        'EP2'),
  (4, 'El Pulpo 3',        'EP3'),
  (5, 'El Pulpo 4',        'EP4');

DO $$
DECLARE
  v_source_id uuid;
  v_source record;
  v_target_id uuid;
  v_branch record;
  v_depth int;
  v_max_depth int;
  v_stats text;
BEGIN
  -- ── Origen ────────────────────────────────────────────────────────────────
  SELECT b.*
  INTO v_source
  FROM public.branches b
  WHERE b.name ILIKE '%Local Principal%Chone%'
     OR b.name ILIKE 'Local Principal (Chone)'
     OR b.name ILIKE '%Local Principal%'
  ORDER BY
    CASE WHEN b.name ILIKE '%Chone%' THEN 0 ELSE 1 END,
    b.name
  LIMIT 1;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'No se encontró Local Principal (Chone).';
  END IF;

  v_source_id := v_source.id;
  RAISE NOTICE 'Origen: % (%)', v_source.name, v_source_id;

  -- Mapas de IDs (por cada destino se recrean)
  CREATE TEMP TABLE tmp_mod_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_cat_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_sub_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_prod_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_node_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_template_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_bulk_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;

  FOR v_branch IN
    SELECT * FROM tmp_new_branches ORDER BY sort_order
  LOOP
    -- ── Crear o reutilizar sucursal ─────────────────────────────────────────
    SELECT id INTO v_target_id
    FROM public.branches
    WHERE name = v_branch.name
    LIMIT 1;

    IF v_target_id IS NULL THEN
      -- Evitar choque de branch_code
      IF EXISTS (
        SELECT 1 FROM public.branches WHERE branch_code = v_branch.branch_code
      ) THEN
        RAISE EXCEPTION
          'branch_code % ya existe. Cambia el código de "%".',
          v_branch.branch_code, v_branch.name;
      END IF;

      INSERT INTO public.branches (
        id,
        name,
        branch_code,
        address,
        reference_table_count,
        workflow_mode,
        printer_ip,
        printer_port,
        is_active
      ) VALUES (
        gen_random_uuid(),
        v_branch.name,
        v_branch.branch_code,
        v_source.address,
        COALESCE(v_source.reference_table_count, 0),
        COALESCE(v_source.workflow_mode, 'DISPATCH_THEN_CASH'),
        v_source.printer_ip,
        v_source.printer_port,
        true
      )
      RETURNING id INTO v_target_id;

      RAISE NOTICE 'Creada sucursal: % (%)', v_branch.name, v_target_id;
    ELSE
      UPDATE public.branches
      SET
        address = v_source.address,
        reference_table_count = COALESCE(v_source.reference_table_count, 0),
        workflow_mode = COALESCE(v_source.workflow_mode, workflow_mode),
        printer_ip = v_source.printer_ip,
        printer_port = v_source.printer_port,
        is_active = true,
        updated_at = now()
      WHERE id = v_target_id;

      RAISE NOTICE 'Reutilizando sucursal existente: % (%)', v_branch.name, v_target_id;
    END IF;

    UPDATE tmp_new_branches
    SET target_id = v_target_id
    WHERE sort_order = v_branch.sort_order;

    -- Bloquear si el destino ya tiene operaciones
    IF EXISTS (SELECT 1 FROM public.orders WHERE branch_id = v_target_id LIMIT 1) THEN
      RAISE EXCEPTION
        'La sucursal "%" ya tiene órdenes. No se reclona para no mezclar datos.',
        v_branch.name;
    END IF;

    -- ── Limpiar config previa del destino (solo config; sin órdenes) ────────
    DELETE FROM public.branch_cancel_policy WHERE branch_id = v_target_id;
    DELETE FROM public.extra_frequent_products WHERE branch_id = v_target_id;

    DELETE FROM public.bulk_included_product_ranges r
    USING public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE r.bulk_included_product_id = bip.id
      AND mn.branch_id = v_target_id;

    DELETE FROM public.bulk_included_products bip
    USING public.menu_nodes mn
    WHERE bip.menu_node_id = mn.id
      AND mn.branch_id = v_target_id;

    DELETE FROM public.menu_node_modifiers mnm
    USING public.menu_nodes mn
    WHERE mnm.node_id = mn.id
      AND mn.branch_id = v_target_id;

    DELETE FROM public.menu_nodes WHERE branch_id = v_target_id;

    DELETE FROM public.subcategory_modifiers sm
    USING public.subcategories sc
    JOIN public.categories c ON c.id = sc.category_id
    WHERE sm.subcategory_id = sc.id
      AND c.branch_id = v_target_id;

    DELETE FROM public.products p
    USING public.subcategories sc
    JOIN public.categories c ON c.id = sc.category_id
    WHERE p.subcategory_id = sc.id
      AND c.branch_id = v_target_id;

    DELETE FROM public.subcategories sc
    USING public.categories c
    WHERE sc.category_id = c.id
      AND c.branch_id = v_target_id;

    DELETE FROM public.categories WHERE branch_id = v_target_id;
    DELETE FROM public.modifiers WHERE branch_id = v_target_id;

    DELETE FROM public.cash_register_template_denoms d
    USING public.cash_register_templates t
    WHERE d.template_id = t.id
      AND t.branch_id = v_target_id;

    DELETE FROM public.cash_register_templates WHERE branch_id = v_target_id;

    DELETE FROM public.payment_methods
    WHERE branch_id = v_target_id
      AND lower(trim(name)) <> 'efectivo';

    DELETE FROM public.dispatch_assignments da
    USING public.dispatch_config dc
    WHERE da.dispatch_config_id = dc.id
      AND dc.branch_id = v_target_id;

    DELETE FROM public.dispatch_config WHERE branch_id = v_target_id;

    TRUNCATE tmp_mod_map, tmp_cat_map, tmp_sub_map, tmp_prod_map,
             tmp_node_map, tmp_template_map, tmp_bulk_map;

    -- ── Modifiers ───────────────────────────────────────────────────────────
    INSERT INTO tmp_mod_map (old_id, new_id)
    SELECT m.id, gen_random_uuid()
    FROM public.modifiers m
    WHERE m.branch_id = v_source_id;

    INSERT INTO public.modifiers (id, branch_id, description, is_active, created_at)
    SELECT map.new_id, v_target_id, m.description, m.is_active, now()
    FROM public.modifiers m
    JOIN tmp_mod_map map ON map.old_id = m.id
    WHERE m.branch_id = v_source_id;

    -- ── Categories → subcategories → products ───────────────────────────────
    INSERT INTO tmp_cat_map (old_id, new_id)
    SELECT c.id, gen_random_uuid()
    FROM public.categories c
    WHERE c.branch_id = v_source_id;

    INSERT INTO public.categories (
      id, branch_id, description, display_order, is_active, created_at, updated_at
    )
    SELECT
      map.new_id, v_target_id, c.description, c.display_order, c.is_active, now(), now()
    FROM public.categories c
    JOIN tmp_cat_map map ON map.old_id = c.id
    WHERE c.branch_id = v_source_id;

    INSERT INTO tmp_sub_map (old_id, new_id)
    SELECT sc.id, gen_random_uuid()
    FROM public.subcategories sc
    JOIN tmp_cat_map cm ON cm.old_id = sc.category_id;

    INSERT INTO public.subcategories (
      id, category_id, description, display_order, is_active, created_at, updated_at
    )
    SELECT
      sm.new_id, cm.new_id, sc.description, sc.display_order, sc.is_active, now(), now()
    FROM public.subcategories sc
    JOIN tmp_sub_map sm ON sm.old_id = sc.id
    JOIN tmp_cat_map cm ON cm.old_id = sc.category_id;

    INSERT INTO tmp_prod_map (old_id, new_id)
    SELECT p.id, gen_random_uuid()
    FROM public.products p
    JOIN tmp_sub_map sm ON sm.old_id = p.subcategory_id;

    INSERT INTO public.products (
      id, subcategory_id, description, display_order, is_active,
      price_mode, unit_price, force_servir_module, created_at, updated_at
    )
    SELECT
      pm.new_id, sm.new_id, p.description, p.display_order, p.is_active,
      p.price_mode, p.unit_price, p.force_servir_module, now(), now()
    FROM public.products p
    JOIN tmp_prod_map pm ON pm.old_id = p.id
    JOIN tmp_sub_map sm ON sm.old_id = p.subcategory_id;

    INSERT INTO public.subcategory_modifiers (
      id, subcategory_id, modifier_id, display_order, is_active, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      sm.new_id,
      COALESCE(mm.new_id, scm.modifier_id),
      scm.display_order,
      scm.is_active,
      now(),
      now()
    FROM public.subcategory_modifiers scm
    JOIN tmp_sub_map sm ON sm.old_id = scm.subcategory_id
    LEFT JOIN tmp_mod_map mm ON mm.old_id = scm.modifier_id;

    -- ── Menu nodes (por depth) ──────────────────────────────────────────────
    INSERT INTO tmp_node_map (old_id, new_id)
    SELECT mn.id, gen_random_uuid()
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_source_id;

    SELECT COALESCE(MAX(depth), -1)
    INTO v_max_depth
    FROM public.menu_nodes
    WHERE branch_id = v_source_id;

    FOR v_depth IN 0..v_max_depth LOOP
      INSERT INTO public.menu_nodes (
        id, branch_id, parent_id, name, description, node_type, menu_scope,
        depth, display_order, price, is_active, icon, image_url,
        legacy_product_id, manual_price_enabled, is_tray_category,
        created_at, updated_at
      )
      SELECT
        nm.new_id,
        v_target_id,
        CASE WHEN mn.parent_id IS NULL THEN NULL ELSE pm.new_id END,
        mn.name,
        mn.description,
        mn.node_type,
        mn.menu_scope,
        mn.depth,
        mn.display_order,
        mn.price,
        mn.is_active,
        mn.icon,
        mn.image_url,
        pr.new_id,
        mn.manual_price_enabled,
        mn.is_tray_category,
        now(),
        now()
      FROM public.menu_nodes mn
      JOIN tmp_node_map nm ON nm.old_id = mn.id
      LEFT JOIN tmp_node_map pm ON pm.old_id = mn.parent_id
      LEFT JOIN tmp_prod_map pr ON pr.old_id = mn.legacy_product_id
      WHERE mn.branch_id = v_source_id
        AND mn.depth = v_depth;
    END LOOP;

    INSERT INTO public.menu_node_modifiers (
      id, node_id, modifier_id, display_order, is_active, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      nm.new_id,
      COALESCE(mm.new_id, mnm.modifier_id),
      mnm.display_order,
      mnm.is_active,
      now(),
      now()
    FROM public.menu_node_modifiers mnm
    JOIN tmp_node_map nm ON nm.old_id = mnm.node_id
    LEFT JOIN tmp_mod_map mm ON mm.old_id = mnm.modifier_id;

    -- ── Bulk included products + ranges ─────────────────────────────────────
    INSERT INTO tmp_bulk_map (old_id, new_id)
    SELECT bip.id, gen_random_uuid()
    FROM public.bulk_included_products bip
    JOIN tmp_node_map nm ON nm.old_id = bip.menu_node_id;

    INSERT INTO public.bulk_included_products (
      id, menu_node_id, included_node_id, is_active, display_order, created_at, updated_at
    )
    SELECT
      bm.new_id,
      nm_src.new_id,
      nm_inc.new_id,
      bip.is_active,
      bip.display_order,
      now(),
      now()
    FROM public.bulk_included_products bip
    JOIN tmp_bulk_map bm ON bm.old_id = bip.id
    JOIN tmp_node_map nm_src ON nm_src.old_id = bip.menu_node_id
    JOIN tmp_node_map nm_inc ON nm_inc.old_id = bip.included_node_id;

    INSERT INTO public.bulk_included_product_ranges (
      id, bulk_included_product_id, amount_from, amount_to,
      included_quantity, display_order, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      bm.new_id,
      r.amount_from,
      r.amount_to,
      r.included_quantity,
      r.display_order,
      now(),
      now()
    FROM public.bulk_included_product_ranges r
    JOIN tmp_bulk_map bm ON bm.old_id = r.bulk_included_product_id;

    -- ── Extra frequent products ─────────────────────────────────────────────
    INSERT INTO public.extra_frequent_products (
      id, branch_id, menu_node_id, display_order, context, created_at
    )
    SELECT
      gen_random_uuid(),
      v_target_id,
      nm.new_id,
      efp.display_order,
      efp.context,
      now()
    FROM public.extra_frequent_products efp
    JOIN tmp_node_map nm ON nm.old_id = efp.menu_node_id
    WHERE efp.branch_id = v_source_id;

    -- ── Cancel policy ───────────────────────────────────────────────────────
    INSERT INTO public.branch_cancel_policy (
      id, branch_id, menu_node_id, allow_direct_cancel, is_kitchen_plate,
      created_at, updated_at, updated_by
    )
    SELECT
      gen_random_uuid(),
      v_target_id,
      nm.new_id,
      bcp.allow_direct_cancel,
      bcp.is_kitchen_plate,
      now(),
      now(),
      NULL
    FROM public.branch_cancel_policy bcp
    JOIN tmp_node_map nm ON nm.old_id = bcp.menu_node_id
    WHERE bcp.branch_id = v_source_id;

    -- ── Payment methods (excepto Efectivo, ya lo crea el trigger) ───────────
    INSERT INTO public.payment_methods (id, branch_id, name, is_active, created_at)
    SELECT
      gen_random_uuid(),
      v_target_id,
      pm.name,
      pm.is_active,
      now()
    FROM public.payment_methods pm
    WHERE pm.branch_id = v_source_id
      AND lower(trim(pm.name)) <> 'efectivo'
      AND NOT EXISTS (
        SELECT 1
        FROM public.payment_methods existing
        WHERE existing.branch_id = v_target_id
          AND lower(trim(existing.name)) = lower(trim(pm.name))
      );

    -- Sincronizar is_active de Efectivo con el origen
    UPDATE public.payment_methods tgt
    SET is_active = src.is_active
    FROM public.payment_methods src
    WHERE tgt.branch_id = v_target_id
      AND src.branch_id = v_source_id
      AND lower(trim(tgt.name)) = 'efectivo'
      AND lower(trim(src.name)) = 'efectivo';

    -- ── Cash register templates ─────────────────────────────────────────────
    INSERT INTO tmp_template_map (old_id, new_id)
    SELECT t.id, gen_random_uuid()
    FROM public.cash_register_templates t
    WHERE t.branch_id = v_source_id;

    INSERT INTO public.cash_register_templates (
      id, branch_id, name, is_active, created_by, created_at, updated_at
    )
    SELECT
      tm.new_id,
      v_target_id,
      t.name,
      t.is_active,
      NULL,
      now(),
      now()
    FROM public.cash_register_templates t
    JOIN tmp_template_map tm ON tm.old_id = t.id
    WHERE t.branch_id = v_source_id;

    INSERT INTO public.cash_register_template_denoms (
      id, template_id, denomination_id, qty, created_at
    )
    SELECT
      gen_random_uuid(),
      tm.new_id,
      d.denomination_id,
      d.qty,
      now()
    FROM public.cash_register_template_denoms d
    JOIN tmp_template_map tm ON tm.old_id = d.template_id;

    -- ── Dispatch config ─────────────────────────────────────────────────────
    INSERT INTO public.dispatch_config (
      id, branch_id, dispatch_mode, table_enabled, takeout_enabled, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      v_target_id,
      dc.dispatch_mode,
      dc.table_enabled,
      dc.takeout_enabled,
      now(),
      now()
    FROM public.dispatch_config dc
    WHERE dc.branch_id = v_source_id
    ON CONFLICT (branch_id) DO UPDATE
    SET
      dispatch_mode = EXCLUDED.dispatch_mode,
      table_enabled = EXCLUDED.table_enabled,
      takeout_enabled = EXCLUDED.takeout_enabled,
      updated_at = now();

    -- ── Mesas (capacidad) ───────────────────────────────────────────────────
    PERFORM public.ensure_branch_table_capacity(
      v_target_id,
      COALESCE(v_source.reference_table_count, 0)
    );

    SELECT format(
      '%s | mods=%s cats=%s nodes=%s templates=%s',
      v_branch.name,
      (SELECT count(*) FROM tmp_mod_map),
      (SELECT count(*) FROM tmp_cat_map),
      (SELECT count(*) FROM tmp_node_map),
      (SELECT count(*) FROM tmp_template_map)
    )
    INTO v_stats;

    RAISE NOTICE '%', v_stats;
  END LOOP;

  RAISE NOTICE 'Clonación completada desde %', v_source.name;
END;
$$;

COMMIT;

-- Verificación
SELECT
  b.id,
  b.name,
  b.branch_code,
  b.display_code,
  b.workflow_mode,
  b.reference_table_count,
  (SELECT count(*) FROM public.menu_nodes mn WHERE mn.branch_id = b.id) AS menu_nodes,
  (SELECT count(*) FROM public.modifiers m WHERE m.branch_id = b.id) AS modifiers,
  (SELECT count(*) FROM public.cash_register_templates t WHERE t.branch_id = b.id) AS caja_templates,
  (SELECT count(*) FROM public.payment_methods pm WHERE pm.branch_id = b.id) AS payment_methods,
  (SELECT count(*) FROM public.restaurant_tables rt WHERE rt.branch_id = b.id) AS mesas
FROM public.branches b
ORDER BY
  CASE
    WHEN b.name ILIKE '%Local Principal%' THEN 0
    ELSE 1
  END,
  b.name;
