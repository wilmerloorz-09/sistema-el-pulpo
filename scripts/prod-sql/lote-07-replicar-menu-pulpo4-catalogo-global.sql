-- lote-07-replicar-menu-pulpo4-catalogo-global
-- Ejecutar en Supabase SQL Editor (producción)
-- Fecha: 2026-08-31
--
-- Objetivo:
--   1. Activar catálogo global (usa_catalogo_global) en sucursales destino
--   2. REEMPLAZAR el menú operativo (menu_nodes) copiando desde El Pulpo 4
--   3. NO duplicar ítems en pantalla (se borra árbol viejo antes de copiar)
--   4. NO borrar órdenes ni products legacy referenciados por historial
--
-- Origen:  El Pulpo 4 / El Pulpo 4 (Prueba) — la que tenga usa_catalogo_global = true
-- Destinos por branch_code: P1M, P1T, EP2, EP3 (no depende del acento en "Mañana")
--
-- IMPORTANTE:
--   - Ejecutar fuera de horario operativo (ideal: local cerrado)
--   - Primero correr solo la sección "0) Prechequeo" y revisar resultados
--   - Luego correr la sección "1) Migración" completa

SET statement_timeout = '600s';

-- =============================================================================
-- 0) PRECHEQUEO (solo lectura — Run esto primero)
-- =============================================================================

SELECT id, name, branch_code, usa_catalogo_global, is_active
FROM public.branches
WHERE is_active = true
  AND branch_code IN ('P1M', 'P1T', 'EP2', 'EP3', 'EP4')
ORDER BY branch_code;

-- Origen esperado
SELECT id, name, usa_catalogo_global,
       (SELECT count(*) FROM public.menu_nodes mn WHERE mn.branch_id = b.id) AS menu_nodes,
       (SELECT count(*) FROM public.menu_nodes mn
        WHERE mn.branch_id = b.id AND mn.producto_global_id IS NOT NULL) AS nodos_con_global
FROM public.branches b
WHERE b.usa_catalogo_global = true
  AND b.name ILIKE 'El Pulpo 4%'
ORDER BY b.name;

-- Origen: productos sin catálogo global (debe ser 0 en Pulpo 4 migrado)
SELECT count(*) AS productos_sin_global_en_origen
FROM public.menu_nodes mn
JOIN public.branches b ON b.id = mn.branch_id
WHERE b.usa_catalogo_global = true
  AND b.name ILIKE 'El Pulpo 4%'
  AND mn.node_type = 'product'
  AND mn.producto_global_id IS NULL;

-- Destinos: menú actual vs órdenes (si orders > 0, historial se conserva; menú se reemplaza igual)
SELECT
  b.name,
  b.usa_catalogo_global,
  (SELECT count(*) FROM public.menu_nodes mn WHERE mn.branch_id = b.id) AS menu_nodes_actuales,
  (SELECT count(*) FROM public.orders o WHERE o.branch_id = b.id) AS ordenes_historicas
FROM public.branches b
WHERE b.branch_code IN ('P1M', 'P1T', 'EP2', 'EP3')
ORDER BY b.branch_code;

-- Si alguna fila no aparece arriba, lista todas las sucursales activas:
-- SELECT id, name, branch_code FROM public.branches WHERE is_active = true ORDER BY name;

-- =============================================================================
-- 1) MIGRACIÓN (Run después de revisar prechequeo)
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_source_id uuid;
  v_source_name text;
  v_target_id uuid;
  v_target_name text;
  v_depth int;
  v_max_depth int;
  v_stats text;
BEGIN
  -- ── Resolver origen (El Pulpo 4 con catálogo global) ─────────────────────
  SELECT b.id, b.name
  INTO v_source_id, v_source_name
  FROM public.branches b
  WHERE b.is_active = true
    AND b.usa_catalogo_global = true
    AND b.name ILIKE 'El Pulpo 4%'
  ORDER BY
    CASE WHEN b.name ILIKE '%Prueba%' THEN 0 ELSE 1 END,
    b.name
  LIMIT 1;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION
      'No se encontró sucursal origen El Pulpo 4 con usa_catalogo_global = true. '
      'Actívalo primero (lote-02) en esa sucursal.';
  END IF;

  RAISE NOTICE 'Origen: % (%)', v_source_name, v_source_id;

  CREATE TEMP TABLE tmp_targets (
    sort_order int PRIMARY KEY,
    branch_code varchar(4) NOT NULL,
    label text NOT NULL,
    branch_id uuid
  ) ON COMMIT DROP;

  INSERT INTO tmp_targets (sort_order, branch_code, label) VALUES
    (1, 'P1M', 'El Pulpo 1 Mañana'),
    (2, 'P1T', 'El Pulpo 1 Tarde'),
    (3, 'EP2', 'El Pulpo 2'),
    (4, 'EP3', 'El Pulpo 3');

  UPDATE tmp_targets t
  SET branch_id = b.id
  FROM public.branches b
  WHERE b.branch_code = t.branch_code
    AND b.is_active = true;

  IF EXISTS (SELECT 1 FROM tmp_targets WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION
      'Falta alguna sucursal destino. Revisa branch_code en branches: %. '
      'Ejecuta: SELECT id, name, branch_code FROM branches WHERE is_active = true ORDER BY name;',
      (SELECT string_agg(branch_code || ' (' || label || ')', ', ' ORDER BY sort_order)
       FROM tmp_targets WHERE branch_id IS NULL);
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
      RAISE NOTICE 'Omitiendo origen como destino: %', v_target_name;
      CONTINUE;
    END IF;

    RAISE NOTICE '── Procesando destino: % (%)', v_target_name, v_target_id;

    -- Activar catálogo global en destino
    UPDATE public.branches
    SET usa_catalogo_global = true,
        updated_at = now()
    WHERE id = v_target_id;

    -- ── Limpiar SOLO menú operativo (no orders, no products con historial) ──
    DELETE FROM public.branch_cancel_policy
    WHERE branch_id = v_target_id;

    DELETE FROM public.extra_frequent_products
    WHERE branch_id = v_target_id;

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

    DELETE FROM public.menu_nodes
    WHERE branch_id = v_target_id;

    -- Modificadores: borrar solo los NO usados en órdenes históricas de esta sucursal
    DELETE FROM public.modifiers m
    WHERE m.branch_id = v_target_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_item_modifiers oim
        JOIN public.order_items oi ON oi.id = oim.order_item_id
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.branch_id = v_target_id
          AND oim.modifier_id = m.id
      );

    TRUNCATE tmp_mod_map, tmp_node_map, tmp_bulk_map;

    -- ── Copiar modificadores del origen ─────────────────────────────────────
    INSERT INTO tmp_mod_map (old_id, new_id)
    SELECT m.id, gen_random_uuid()
    FROM public.modifiers m
    WHERE m.branch_id = v_source_id;

    INSERT INTO public.modifiers (id, branch_id, description, is_active, created_at)
    SELECT map.new_id, v_target_id, m.description, m.is_active, now()
    FROM public.modifiers m
    JOIN tmp_mod_map map ON map.old_id = m.id
    WHERE m.branch_id = v_source_id;

    -- ── Copiar árbol menu_nodes (producto_global_id igual; nodos nuevos) ─────
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
        AND mn.depth = v_depth;
    END LOOP;

    -- ── Asignaciones modificador ↔ nodo ─────────────────────────────────────
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

    -- ── Bulk included products + rangos ─────────────────────────────────────
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

    -- ── Productos frecuentes (Extra) ────────────────────────────────────────
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

    -- ── Política de cancelación por nodo ────────────────────────────────────
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

    -- ── producto_sucursal: vínculo inventario por cada producto global en menú ─
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
      AND mn.producto_global_id IS NOT NULL
    ON CONFLICT (sucursal_id, producto_global_id) DO UPDATE
    SET activo = true,
        updated_at = now();

    SELECT format(
      '%s | mods=%s nodes=%s globals=%s producto_sucursal=%s',
      v_target_name,
      (SELECT count(*) FROM tmp_mod_map),
      (SELECT count(*) FROM tmp_node_map),
      (SELECT count(DISTINCT mn.producto_global_id)
       FROM public.menu_nodes mn
       WHERE mn.branch_id = v_target_id AND mn.producto_global_id IS NOT NULL),
      (SELECT count(*) FROM public.producto_sucursal ps WHERE ps.sucursal_id = v_target_id)
    )
    INTO v_stats;

    RAISE NOTICE '%', v_stats;
  END LOOP;

  RAISE NOTICE 'Réplica completada desde %', v_source_name;
END;
$$;

COMMIT;

-- =============================================================================
-- 2) VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================

WITH source AS (
  SELECT b.id, count(mn.id) AS nodos
  FROM public.branches b
  LEFT JOIN public.menu_nodes mn ON mn.branch_id = b.id
  WHERE b.is_active = true
    AND b.usa_catalogo_global = true
    AND b.name ILIKE 'El Pulpo 4%'
  GROUP BY b.id
  ORDER BY b.id
  LIMIT 1
)
SELECT
  b.name,
  b.branch_code,
  b.usa_catalogo_global,
  s.nodos AS nodos_origen_pulpo4,
  mn_stats.nodos_destino,
  mn_stats.productos_globales_en_menu,
  ord_stats.ordenes_historicas_intactas
FROM public.branches b
CROSS JOIN source s
LEFT JOIN LATERAL (
  SELECT
    count(*) AS nodos_destino,
    count(DISTINCT mn.producto_global_id) FILTER (WHERE mn.producto_global_id IS NOT NULL)
      AS productos_globales_en_menu
  FROM public.menu_nodes mn
  WHERE mn.branch_id = b.id
) mn_stats ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS ordenes_historicas_intactas
  FROM public.orders o
  WHERE o.branch_id = b.id
) ord_stats ON true
WHERE b.branch_code IN ('P1M', 'P1T', 'EP2', 'EP3')
ORDER BY b.branch_code;

-- Duplicados en menú (debe devolver 0 filas por sucursal/scope/producto)
SELECT
  b.name,
  mn.menu_scope,
  mn.producto_global_id,
  pg.nombre_principal,
  count(*) AS veces_en_menu
FROM public.menu_nodes mn
JOIN public.branches b ON b.id = mn.branch_id
JOIN public.productos_globales pg ON pg.id = mn.producto_global_id
WHERE mn.node_type = 'product'
  AND mn.producto_global_id IS NOT NULL
  AND b.branch_code IN ('P1M', 'P1T', 'EP2', 'EP3')
GROUP BY b.name, b.branch_code, mn.menu_scope, mn.producto_global_id, pg.nombre_principal
HAVING count(*) > 1
ORDER BY b.branch_code, mn.menu_scope, pg.nombre_principal;
