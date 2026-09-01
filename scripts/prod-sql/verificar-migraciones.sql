-- Verificación lotes 1-6 (producción)
-- Pegar TODO y Run una sola vez.

WITH checks AS (
  SELECT 1 AS orden, 'Lote 1 - menú legacy' AS lote, 'función sync_menu_node_to_legacy_product' AS objeto,
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'sync_menu_node_to_legacy_product'
    ) AS ok
  UNION ALL
  SELECT 1, 'Lote 1 - menú legacy', 'función menu_node_has_valid_legacy_product',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'menu_node_has_valid_legacy_product'
    )
  UNION ALL
  SELECT 2, 'Lote 2 - catálogo global', 'columna branches.usa_catalogo_global',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'usa_catalogo_global'
    )
  UNION ALL
  SELECT 2, 'Lote 2 - catálogo global', 'tabla productos_globales',
    to_regclass('public.productos_globales') IS NOT NULL
  UNION ALL
  SELECT 2, 'Lote 2 - catálogo global', 'tabla producto_sucursal',
    to_regclass('public.producto_sucursal') IS NOT NULL
  UNION ALL
  SELECT 2, 'Lote 2 - catálogo global', 'columna productos_globales.categoria',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'productos_globales' AND column_name = 'categoria'
    )
  UNION ALL
  SELECT 2, 'Lote 2 - catálogo global', 'policy storage global-products',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'Global admins can upload global product images'
    )
  UNION ALL
  SELECT 3, 'Lote 3 - blindaje paid_at', 'función order_has_complete_payment_coverage',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'order_has_complete_payment_coverage'
    )
  UNION ALL
  SELECT 3, 'Lote 3 - blindaje paid_at', 'función repair_shift_orders_missing_paid_at',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'repair_shift_orders_missing_paid_at'
    )
  UNION ALL
  SELECT 4, 'Lote 4 - reemplazo cajero', 'función replace_shift_cashier',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'replace_shift_cashier'
    )
  UNION ALL
  SELECT 4, 'Lote 4 - reemplazo cajero', 'función get_register_opening_collected_payments',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_register_opening_collected_payments'
    )
  UNION ALL
  SELECT 5, 'Lote 5 - supervisor temporal', 'tabla branch_supervisor_delegations',
    to_regclass('public.branch_supervisor_delegations') IS NOT NULL
  UNION ALL
  SELECT 5, 'Lote 5 - supervisor temporal', 'función list_branch_supervisor_delegation_status',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'list_branch_supervisor_delegation_status'
    )
  UNION ALL
  SELECT 6, 'Lote 6 - cola operativa (opcional)', 'función get_operational_queue',
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_operational_queue'
    )
),
detalle AS (
  SELECT
    orden,
    lote,
    objeto,
    CASE WHEN ok THEN 'OK' ELSE 'FALTA' END AS estado
  FROM checks
),
resumen AS (
  SELECT
    MIN(orden) AS orden,
    lote,
    '>>> RESUMEN LOTE' AS objeto,
    CASE WHEN BOOL_AND(ok) THEN 'COMPLETO' ELSE 'INCOMPLETO' END AS estado
  FROM checks
  GROUP BY lote
)
SELECT orden, lote, objeto, estado FROM detalle
UNION ALL
SELECT orden, lote, objeto, estado FROM resumen
ORDER BY orden, objeto;
