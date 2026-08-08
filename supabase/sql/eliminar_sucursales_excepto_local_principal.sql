-- =============================================================================
-- Eliminar TODAS las sucursales excepto "Local Principal (Chone)"
-- =============================================================================
-- Uso: pegar en Supabase → SQL Editor → Run
--
-- Qué hace:
--   1. Localiza la sucursal a conservar (Local Principal / Chone)
--   2. Borra datos operativos y de configuración de las demás sucursales
--   3. Reasigna perfiles/cuentas bancarias que apuntaban a las eliminadas
--   4. Elimina las filas de public.branches (excepto la conservada)
--
-- Conserva:
--   - Local Principal (Chone): menú, modificadores, plantillas, mesas, etc.
--   - Usuarios, roles globales, módulos, denominaciones globales, bancos
--
-- NO toca:
--   - Datos de Local Principal (ni transacciones ni configuración)
--   - Archivos en Storage (payment-proofs); limpia aparte si hace falta
--
-- ADVERTENCIA: destructivo e irreversible para las otras sucursales.
-- =============================================================================

SET statement_timeout = '300s';

BEGIN;

DO $$
DECLARE
  v_keep_id uuid;
  v_keep_name text;
  v_delete_ids uuid[];
  v_delete_count integer;
  v_names text;
BEGIN
  -- ── 1) Sucursal a conservar ───────────────────────────────────────────────
  SELECT b.id, b.name
  INTO v_keep_id, v_keep_name
  FROM public.branches b
  WHERE b.name ILIKE '%Local Principal%Chone%'
     OR b.name ILIKE 'Local Principal (Chone)'
     OR b.name ILIKE '%Local Principal%'
  ORDER BY
    CASE
      WHEN b.name ILIKE '%Chone%' THEN 0
      WHEN b.name ILIKE 'Local Principal (Chone)' THEN 0
      ELSE 1
    END,
    b.name
  LIMIT 1;

  IF v_keep_id IS NULL THEN
    RAISE EXCEPTION
      'No se encontró la sucursal Local Principal (Chone). Revisa public.branches.name.';
  END IF;

  SELECT COALESCE(array_agg(b.id), ARRAY[]::uuid[])
  INTO v_delete_ids
  FROM public.branches b
  WHERE b.id <> v_keep_id;

  v_delete_count := COALESCE(cardinality(v_delete_ids), 0);

  IF v_delete_count = 0 THEN
    RAISE NOTICE 'Solo existe la sucursal a conservar: % (%)', v_keep_name, v_keep_id;
    RETURN;
  END IF;

  SELECT string_agg(b.name, ', ' ORDER BY b.name)
  INTO v_names
  FROM public.branches b
  WHERE b.id = ANY (v_delete_ids);

  RAISE NOTICE 'Conservar: % (%)', v_keep_name, v_keep_id;
  RAISE NOTICE 'Eliminar % sucursal(es): %', v_delete_count, v_names;

  -- ── 2) Perfiles: no deben apuntar a sucursales que vamos a borrar ─────────
  UPDATE public.profiles p
  SET active_branch_id = v_keep_id
  WHERE p.active_branch_id = ANY (v_delete_ids);

  UPDATE public.profiles p
  SET branch_id = v_keep_id
  WHERE p.branch_id = ANY (v_delete_ids);

  -- Historial de cambios de sucursal (FKs sin CASCADE)
  IF to_regclass('public.user_branch_change_history') IS NOT NULL THEN
    UPDATE public.user_branch_change_history
    SET previous_branch_id = NULL
    WHERE previous_branch_id = ANY (v_delete_ids);

    UPDATE public.user_branch_change_history
    SET new_branch_id = NULL
    WHERE new_branch_id = ANY (v_delete_ids);

    UPDATE public.user_branch_change_history
    SET branch_id = v_keep_id
    WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.user_module_change_history') IS NOT NULL THEN
    UPDATE public.user_module_change_history
    SET branch_id = v_keep_id
    WHERE branch_id = ANY (v_delete_ids);
  END IF;

  -- Cuentas bancarias ligadas solo a sucursales borradas → quedan globales
  IF to_regclass('public.cuentas_bancarias_destino') IS NOT NULL THEN
    UPDATE public.cuentas_bancarias_destino
    SET sucursal_id = NULL
    WHERE sucursal_id = ANY (v_delete_ids);
  END IF;

  -- ── 3) Datos con ON DELETE RESTRICT (borrar antes que la sucursal) ────────
  IF to_regclass('public.validaciones_comprobantes_transferencia') IS NOT NULL THEN
    DELETE FROM public.validaciones_comprobantes_transferencia
    WHERE sucursal_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.comprobantes_pago') IS NOT NULL THEN
    DELETE FROM public.comprobantes_pago
    WHERE sucursal_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payment_proofs') IS NOT NULL
     AND to_regclass('public.payment_capture_requests') IS NOT NULL THEN
    DELETE FROM public.payment_proofs pp
    USING public.payment_capture_requests pcr
    WHERE pp.capture_request_id = pcr.id
      AND pcr.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payment_capture_requests') IS NOT NULL THEN
    DELETE FROM public.payment_capture_requests
    WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_register_movements') IS NOT NULL THEN
    DELETE FROM public.cash_register_movements
    WHERE branch_id = ANY (v_delete_ids);
  END IF;

  -- ── 4) Operacional por sucursal (orden FK-safe) ───────────────────────────
  IF to_regclass('public.kitchen_notifications') IS NOT NULL THEN
    DELETE FROM public.kitchen_notifications WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_ready_notifications') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_ready_notifications'
        AND column_name = 'branch_id'
    ) THEN
      DELETE FROM public.order_ready_notifications WHERE branch_id = ANY (v_delete_ids);
    ELSE
      DELETE FROM public.order_ready_notifications n
      USING public.orders o
      WHERE n.order_id = o.id
        AND o.branch_id = ANY (v_delete_ids);
    END IF;
  END IF;

  -- Eventos / cancelaciones ligados a órdenes de esas sucursales
  IF to_regclass('public.order_item_dispatch_events') IS NOT NULL THEN
    DELETE FROM public.order_item_dispatch_events e
    USING public.orders o
    WHERE e.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_dispatch_events') IS NOT NULL THEN
    DELETE FROM public.order_dispatch_events e
    USING public.orders o
    WHERE e.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_item_ready_events') IS NOT NULL THEN
    DELETE FROM public.order_item_ready_events e
    USING public.orders o
    WHERE e.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_ready_events') IS NOT NULL THEN
    DELETE FROM public.order_ready_events e
    USING public.orders o
    WHERE e.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_item_cancellations') IS NOT NULL THEN
    DELETE FROM public.order_item_cancellations c
    USING public.orders o
    WHERE c.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_cancellations') IS NOT NULL THEN
    DELETE FROM public.order_cancellations c
    USING public.orders o
    WHERE c.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payment_void_requests') IS NOT NULL THEN
    DELETE FROM public.payment_void_requests pvr
    USING public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE pvr.payment_id = p.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payment_items') IS NOT NULL THEN
    DELETE FROM public.payment_items pi
    USING public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE pi.payment_id = p.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_movements') IS NOT NULL THEN
    DELETE FROM public.cash_movements cm
    USING public.cash_shifts cs
    WHERE cm.shift_id = cs.id
      AND cs.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_shift_denoms') IS NOT NULL THEN
    DELETE FROM public.cash_shift_denoms d
    USING public.cash_shifts cs
    WHERE d.shift_id = cs.id
      AND cs.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_register_openings') IS NOT NULL THEN
    DELETE FROM public.cash_register_openings
    WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payments') IS NOT NULL THEN
    DELETE FROM public.payments p
    USING public.orders o
    WHERE p.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.operational_losses') IS NOT NULL THEN
    DELETE FROM public.operational_losses ol
    USING public.orders o
    WHERE ol.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_item_modifiers') IS NOT NULL THEN
    DELETE FROM public.order_item_modifiers oim
    USING public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oim.order_item_id = oi.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    DELETE FROM public.order_items oi
    USING public.orders o
    WHERE oi.order_id = o.id
      AND o.branch_id = ANY (v_delete_ids);

    -- Columna denormalizada (si existe)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_items'
        AND column_name = 'sucursal_id'
    ) THEN
      DELETE FROM public.order_items
      WHERE sucursal_id = ANY (v_delete_ids);
    END IF;
  END IF;

  IF to_regclass('public.predicciones_clientes') IS NOT NULL THEN
    DELETE FROM public.predicciones_clientes pc
    USING public.orders o
    WHERE pc.orden_id = o.id
      AND o.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.table_splits') IS NOT NULL THEN
    DELETE FROM public.table_splits ts
    USING public.restaurant_tables rt
    WHERE ts.table_id = rt.id
      AND rt.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    DELETE FROM public.orders WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.permisos_promociones_turnos') IS NOT NULL THEN
    DELETE FROM public.permisos_promociones_turnos ppt
    USING public.cash_shift_users csu
    JOIN public.cash_shifts cs ON cs.id = csu.shift_id
    WHERE ppt.turno_usuario_id = csu.id
      AND cs.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_shift_users') IS NOT NULL THEN
    DELETE FROM public.cash_shift_users csu
    USING public.cash_shifts cs
    WHERE csu.shift_id = cs.id
      AND cs.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_shifts') IS NOT NULL THEN
    DELETE FROM public.cash_shifts WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.tokens_qr_mesas') IS NOT NULL THEN
    DELETE FROM public.tokens_qr_mesas WHERE sucursal_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.restaurant_tables') IS NOT NULL THEN
    DELETE FROM public.restaurant_tables WHERE branch_id = ANY (v_delete_ids);
  END IF;

  -- ── 5) Configuración / catálogo por sucursal ──────────────────────────────
  IF to_regclass('public.branch_cancel_policy') IS NOT NULL THEN
    DELETE FROM public.branch_cancel_policy WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.extra_frequent_products') IS NOT NULL THEN
    DELETE FROM public.extra_frequent_products WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.bulk_included_product_ranges') IS NOT NULL THEN
    DELETE FROM public.bulk_included_product_ranges r
    USING public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE r.bulk_included_product_id = bip.id
      AND mn.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.bulk_included_products') IS NOT NULL THEN
    DELETE FROM public.bulk_included_products bip
    USING public.menu_nodes mn
    WHERE bip.menu_node_id = mn.id
      AND mn.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.menu_node_modifiers') IS NOT NULL THEN
    DELETE FROM public.menu_node_modifiers mnm
    USING public.menu_nodes mn
    WHERE mnm.node_id = mn.id
      AND mn.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.menu_nodes') IS NOT NULL THEN
    DELETE FROM public.menu_nodes WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.subcategory_modifiers') IS NOT NULL THEN
    DELETE FROM public.subcategory_modifiers sm
    USING public.subcategories sc
    JOIN public.categories c ON c.id = sc.category_id
    WHERE sm.subcategory_id = sc.id
      AND c.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    DELETE FROM public.products p
    USING public.subcategories sc
    JOIN public.categories c ON c.id = sc.category_id
    WHERE p.subcategory_id = sc.id
      AND c.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.subcategories') IS NOT NULL THEN
    DELETE FROM public.subcategories sc
    USING public.categories c
    WHERE sc.category_id = c.id
      AND c.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.categories') IS NOT NULL THEN
    DELETE FROM public.categories WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.modifiers') IS NOT NULL THEN
    DELETE FROM public.modifiers WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_register_template_denoms') IS NOT NULL THEN
    DELETE FROM public.cash_register_template_denoms d
    USING public.cash_register_templates t
    WHERE d.template_id = t.id
      AND t.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.cash_register_templates') IS NOT NULL THEN
    DELETE FROM public.cash_register_templates WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.payment_methods') IS NOT NULL THEN
    DELETE FROM public.payment_methods WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.dispatch_assignments') IS NOT NULL THEN
    DELETE FROM public.dispatch_assignments da
    USING public.dispatch_config dc
    WHERE da.dispatch_config_id = dc.id
      AND dc.branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.dispatch_config') IS NOT NULL THEN
    DELETE FROM public.dispatch_config WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.entity_counters') IS NOT NULL THEN
    DELETE FROM public.entity_counters WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.supervisor_branch_module_limits') IS NOT NULL THEN
    DELETE FROM public.supervisor_branch_module_limits WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.user_branch_modules') IS NOT NULL THEN
    DELETE FROM public.user_branch_modules WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.user_branch_roles') IS NOT NULL THEN
    DELETE FROM public.user_branch_roles WHERE branch_id = ANY (v_delete_ids);
  END IF;

  IF to_regclass('public.user_branches') IS NOT NULL THEN
    DELETE FROM public.user_branches WHERE branch_id = ANY (v_delete_ids);
  END IF;

  -- ── 6) Borrar sucursales ──────────────────────────────────────────────────
  DELETE FROM public.branches
  WHERE id = ANY (v_delete_ids);

  RAISE NOTICE 'Listo. Queda solo: % (%)', v_keep_name, v_keep_id;
END;
$$;

COMMIT;

-- Verificación
SELECT id, name, branch_code, display_code, workflow_mode, is_active
FROM public.branches
ORDER BY name;
