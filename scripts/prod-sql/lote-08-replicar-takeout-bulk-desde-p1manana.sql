-- lote-08-replicar-takeout-bulk-desde-p1manana
-- Ejecutar en Supabase SQL Editor (producción)
-- Fecha: 2026-08-31
--
-- Objetivo: replicar SOLO los menús Con envase (TAKEOUT) y A granel (BULK)
-- desde El Pulpo 1 - Mañana (P1M) hacia P1T, EP2, EP3, EP4.
-- No toca Menu Mesas (TABLE), Extra, etc.
--
-- IMPORTANTE:
--   - bulk_included (A granel) enlaza productos TABLE en destino por producto_global_id
--   - Ejecutar fuera de horario pico
--   - Primero sección 0) Prechequeo, luego 1) Migración

SET statement_timeout = '600s';

-- =============================================================================
-- 0) PRECHEQUEO
-- =============================================================================

SELECT id, name, branch_code, usa_catalogo_global
FROM public.branches
WHERE branch_code IN ('P1M', 'P1T', 'EP2', 'EP3', 'EP4')
ORDER BY branch_code;

-- Nodos por scope en origen (P1M) y destinos
SELECT
  b.branch_code,
  b.name,
  mn.menu_scope,
  count(*) AS nodos
FROM public.branches b
LEFT JOIN public.menu_nodes mn ON mn.branch_id = b.id
  AND mn.menu_scope IN ('TAKEOUT', 'BULK')
WHERE b.branch_code IN ('P1M', 'P1T', 'EP2', 'EP3', 'EP4')
GROUP BY b.branch_code, b.name, mn.menu_scope
ORDER BY b.branch_code, mn.menu_scope;

-- Reglas A granel (bulk_included) en P1M — included_node es TABLE en misma sucursal
SELECT count(*) AS reglas_bulk_p1m
FROM public.bulk_included_products bip
JOIN public.menu_nodes src ON src.id = bip.menu_node_id
JOIN public.branches b ON b.id = src.branch_id
WHERE b.branch_code = 'P1M'
  AND src.menu_scope = 'BULK';

-- =============================================================================
-- 1) MIGRACIÓN
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_source_id uuid;
  v_source_name text;
  v_source_code text := 'P1M';
  v_target_id uuid;
  v_target_name text;
  v_depth int;
  v_max_depth int;
  v_stats text;
  v_scopes text[] := ARRAY['TAKEOUT', 'BULK'];
BEGIN
  SELECT b.id, b.name
  INTO v_source_id, v_source_name
  FROM public.branches b
  WHERE b.branch_code = v_source_code
    AND b.is_active = true
  LIMIT 1;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró sucursal origen con branch_code = %', v_source_code;
  END IF;

  RAISE NOTICE 'Origen: % (%)', v_source_name, v_source_id;

  CREATE TEMP TABLE tmp_targets (
    sort_order int PRIMARY KEY,
    branch_code varchar(4) NOT NULL,
    label text NOT NULL,
    branch_id uuid
  ) ON COMMIT DROP;

  INSERT INTO tmp_targets (sort_order, branch_code, label) VALUES
    (1, 'P1T', 'El Pulpo 1 - Tarde'),
    (2, 'EP2', 'El Pulpo 2'),
    (3, 'EP3', 'El Pulpo 3'),
    (4, 'EP4', 'El Pulpo 4');

  UPDATE tmp_targets t
  SET branch_id = b.id
  FROM public.branches b
  WHERE b.branch_code = t.branch_code
    AND b.is_active = true;

  IF EXISTS (SELECT 1 FROM tmp_targets WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION
      'Falta sucursal destino. Revisa branch_code: %',
      (SELECT string_agg(branch_code, ', ') FROM tmp_targets WHERE branch_id IS NULL);
  END IF;

  CREATE TEMP TABLE tmp_mod_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_node_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_bulk_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;

  FOR v_target_name, v_target_id IN
    SELECT COALESCE(b.name, t.label), t.branch_id
    FROM tmp_targets t
    LEFT JOIN public.branches b ON b.id = t.branch_id
    ORDER BY t.sort_order
  LOOP
    IF v_target_id = v_source_id THEN
      RAISE NOTICE 'Omitiendo origen: %', v_target_name;
      CONTINUE;
    END IF;

    RAISE NOTICE '── Destino: % (%)', v_target_name, v_target_id;

    -- ── Limpiar solo TAKEOUT + BULK en destino ──────────────────────────────
    DELETE FROM public.branch_cancel_policy bcp
    USING public.menu_nodes mn
    WHERE bcp.menu_node_id = mn.id
      AND mn.branch_id = v_target_id
      AND mn.menu_scope = ANY (v_scopes);

    DELETE FROM public.bulk_included_product_ranges r
    USING public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE r.bulk_included_product_id = bip.id
      AND mn.branch_id = v_target_id
      AND mn.menu_scope = 'BULK';

    DELETE FROM public.bulk_included_products bip
    USING public.menu_nodes mn
    WHERE bip.menu_node_id = mn.id
      AND mn.branch_id = v_target_id
      AND mn.menu_scope = 'BULK';

    DELETE FROM public.menu_node_modifiers mnm
    USING public.menu_nodes mn
    WHERE mnm.node_id = mn.id
      AND mn.branch_id = v_target_id
      AND mn.menu_scope = ANY (v_scopes);

    DELETE FROM public.menu_nodes
    WHERE branch_id = v_target_id
      AND menu_scope = ANY (v_scopes);

    TRUNCATE tmp_mod_map, tmp_node_map, tmp_bulk_map;

    -- ── Mapa modificadores (reutilizar en destino si misma descripción) ─────
    INSERT INTO tmp_mod_map (old_id, new_id)
    SELECT DISTINCT
      m.id,
      COALESCE(
        (
          SELECT t.id
          FROM public.modifiers t
          WHERE t.branch_id = v_target_id
            AND lower(trim(t.description)) = lower(trim(m.description))
          ORDER BY t.created_at
          LIMIT 1
        ),
        gen_random_uuid()
      )
    FROM public.modifiers m
    JOIN public.menu_node_modifiers mnm ON mnm.modifier_id = m.id
    JOIN public.menu_nodes mn ON mn.id = mnm.node_id
    WHERE mn.branch_id = v_source_id
      AND mn.menu_scope = ANY (v_scopes);

    INSERT INTO public.modifiers (id, branch_id, description, is_active, created_at)
    SELECT map.new_id, v_target_id, m.description, m.is_active, now()
    FROM tmp_mod_map map
    JOIN public.modifiers m ON m.id = map.old_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.modifiers existing
      WHERE existing.branch_id = v_target_id
        AND existing.id = map.new_id
    );

    -- ── Copiar nodos TAKEOUT + BULK ─────────────────────────────────────────
    INSERT INTO tmp_node_map (old_id, new_id)
    SELECT mn.id, gen_random_uuid()
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_source_id
      AND mn.menu_scope = ANY (v_scopes);

    SELECT COALESCE(MAX(mn.depth), -1)
    INTO v_max_depth
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_source_id
      AND mn.menu_scope = ANY (v_scopes);

    FOR v_depth IN 0..v_max_depth LOOP
      INSERT INTO public.menu_nodes (
        id,
        branch_id,
        parent_id,
        name,
        qr_name,
        description,
        node_type,
        menu_scope,
        depth,
        display_order,
        price,
        is_active,
        icon,
        image_url,
        legacy_product_id,
        producto_global_id,
        manual_price_enabled,
        is_tray_category,
        created_at,
        updated_at
      )
      SELECT
        nm.new_id,
        v_target_id,
        CASE WHEN mn.parent_id IS NULL THEN NULL ELSE pm.new_id END,
        mn.name,
        mn.qr_name,
        mn.description,
        mn.node_type,
        mn.menu_scope,
        mn.depth,
        mn.display_order,
        mn.price,
        mn.is_active,
        mn.icon,
        mn.image_url,
        CASE
          WHEN mn.producto_global_id IS NOT NULL THEN mn.producto_global_id
          ELSE NULL
        END,
        mn.producto_global_id,
        mn.manual_price_enabled,
        mn.is_tray_category,
        now(),
        now()
      FROM public.menu_nodes mn
      JOIN tmp_node_map nm ON nm.old_id = mn.id
      LEFT JOIN tmp_node_map pm ON pm.old_id = mn.parent_id
      WHERE mn.branch_id = v_source_id
        AND mn.menu_scope = ANY (v_scopes)
        AND mn.depth = v_depth;
    END LOOP;

    -- ── Modificadores por nodo ──────────────────────────────────────────────
    INSERT INTO public.menu_node_modifiers (
      id, node_id, modifier_id, display_order, is_active, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      nm.new_id,
      map.new_id,
      mnm.display_order,
      mnm.is_active,
      now(),
      now()
    FROM public.menu_node_modifiers mnm
    JOIN tmp_node_map nm ON nm.old_id = mnm.node_id
    JOIN tmp_mod_map map ON map.old_id = mnm.modifier_id;

    -- ── A granel: productos incluidos (included = nodo TABLE en destino) ───
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
      tgt_inc.id,
      bip.is_active,
      bip.display_order,
      now(),
      now()
    FROM public.bulk_included_products bip
    JOIN tmp_bulk_map bm ON bm.old_id = bip.id
    JOIN tmp_node_map nm_src ON nm_src.old_id = bip.menu_node_id
    JOIN public.menu_nodes src_inc ON src_inc.id = bip.included_node_id
    JOIN LATERAL (
      SELECT ti.id
      FROM public.menu_nodes ti
      WHERE ti.branch_id = v_target_id
        AND ti.menu_scope = 'TABLE'
        AND ti.node_type = 'product'
        AND (
          (
            src_inc.producto_global_id IS NOT NULL
            AND ti.producto_global_id = src_inc.producto_global_id
          )
          OR (
            src_inc.producto_global_id IS NULL
            AND ti.producto_global_id IS NULL
            AND lower(trim(ti.name)) = lower(trim(src_inc.name))
          )
        )
      ORDER BY ti.display_order, ti.name
      LIMIT 1
    ) tgt_inc ON true
    WHERE src_inc.branch_id = v_source_id;

    IF EXISTS (
      SELECT 1
      FROM public.bulk_included_products bip
      JOIN tmp_node_map nm ON nm.old_id = bip.menu_node_id
      WHERE NOT EXISTS (SELECT 1 FROM tmp_bulk_map bm WHERE bm.old_id = bip.id)
    ) THEN
      RAISE WARNING
        'Destino %: alguna regla bulk_included de origen no se copió (falta producto TABLE equivalente en destino).',
        v_target_name;
    END IF;

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

    -- ── Política cancelación (solo nodos copiados) ──────────────────────────
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

    -- ── producto_sucursal para productos globales del menú copiado ──────────
    INSERT INTO public.producto_sucursal (
      sucursal_id,
      producto_global_id,
      cantidad_disponible,
      integra_con_ventas,
      activo
    )
    SELECT DISTINCT
      v_target_id,
      mn.producto_global_id,
      0,
      false,
      true
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_target_id
      AND mn.menu_scope = ANY (v_scopes)
      AND mn.producto_global_id IS NOT NULL
    ON CONFLICT (sucursal_id, producto_global_id) DO UPDATE
    SET activo = true,
        updated_at = now();

    SELECT format(
      '%s | takeout+bulk nodes=%s | bulk_rules=%s',
      v_target_name,
      (SELECT count(*) FROM tmp_node_map),
      (SELECT count(*) FROM tmp_bulk_map)
    )
    INTO v_stats;

    RAISE NOTICE '%', v_stats;
  END LOOP;

  RAISE NOTICE 'Réplica TAKEOUT+BULK completada desde %', v_source_name;
END;
$$;

COMMIT;

-- =============================================================================
-- 2) VERIFICACIÓN
-- =============================================================================

WITH origen AS (
  SELECT
    mn.menu_scope,
    count(*) AS nodos
  FROM public.menu_nodes mn
  JOIN public.branches b ON b.id = mn.branch_id
  WHERE b.branch_code = 'P1M'
    AND mn.menu_scope IN ('TAKEOUT', 'BULK')
  GROUP BY mn.menu_scope
)
SELECT
  b.branch_code,
  b.name,
  o.menu_scope,
  count(mn.id) AS nodos_destino,
  o.nodos AS nodos_origen_p1m,
  CASE WHEN count(mn.id) = o.nodos THEN 'OK' ELSE 'REVISAR' END AS estado
FROM public.branches b
CROSS JOIN origen o
LEFT JOIN public.menu_nodes mn ON mn.branch_id = b.id AND mn.menu_scope = o.menu_scope
WHERE b.branch_code IN ('P1M', 'P1T', 'EP2', 'EP3', 'EP4')
GROUP BY b.branch_code, b.name, o.menu_scope, o.nodos
ORDER BY b.branch_code, o.menu_scope;

-- Duplicados Con envase / A granel (debe ser 0 filas)
SELECT
  b.branch_code,
  b.name,
  mn.menu_scope,
  pg.nombre_principal,
  count(*) AS veces
FROM public.menu_nodes mn
JOIN public.branches b ON b.id = mn.branch_id
JOIN public.productos_globales pg ON pg.id = mn.producto_global_id
WHERE mn.node_type = 'product'
  AND mn.menu_scope IN ('TAKEOUT', 'BULK')
  AND b.branch_code IN ('P1T', 'EP2', 'EP3', 'EP4')
GROUP BY b.branch_code, b.name, mn.menu_scope, pg.nombre_principal
HAVING count(*) > 1
ORDER BY b.branch_code, mn.menu_scope;
