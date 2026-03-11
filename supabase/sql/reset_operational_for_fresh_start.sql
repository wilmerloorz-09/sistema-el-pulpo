-- ============================================================
-- RESET OPERATIVO DEL SISTEMA POS PARA PRUEBAS DESDE CERO
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina solo datos transaccionales y operativos
-- - Conserva usuarios, sucursales, permisos, mesas y catalogos
-- - Conserva categorias, subcategorias, productos, modificadores y configuracion base
-- - Reinicia la operacion diaria sin desmontar el sistema
--
-- IDEAL PARA:
-- - volver a probar el flujo del POS desde cero
-- - limpiar ventas, ordenes, cocina, despacho y caja
-- - mantener lista la base para nuevas pruebas sin reconfigurar todo
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    -- Seguridad efimera / sesiones
    'public.webauthn_challenges',

    -- Notificaciones y trazabilidad operativa
    'public.kitchen_notifications',
    'public.order_ready_notifications',
    'public.order_item_dispatch_events',
    'public.order_dispatch_events',
    'public.order_item_ready_events',
    'public.order_ready_events',
    'public.order_item_cancellations',
    'public.order_cancellations',

    -- Pagos / caja
    'public.payment_items',
    'public.cash_movements',
    'public.cash_shift_denoms',
    'public.payments',
    'public.operational_losses',
    'public.cash_shifts',

    -- Ordenes
    'public.order_item_modifiers',
    'public.order_items',
    'public.orders',

    -- Configuracion operativa por jornada/sucursal
    'public.dispatch_assignments',
    'public.dispatch_config',
    'public.entity_counters',

    -- Auditoria y settings operativos
    'public.audit_log'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(v_table) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %s;', v_table);
      RAISE NOTICE 'Tabla limpiada: %', v_table;
    ELSE
      RAISE NOTICE 'Tabla no encontrada, se omite: %', v_table;
    END IF;
  END LOOP;
END $$;

-- Reinicia secuencias legacy si existen.
ALTER SEQUENCE IF EXISTS public.orders_order_number_seq RESTART WITH 1;

COMMIT;

-- ============================================================
-- POST RESET ESPERADO
-- - Usuarios intactos
-- - Sucursales intactas
-- - Mesas intactas
-- - Catalogo intacto
-- - 0 ordenes/pagos/caja/notificaciones/eventos
-- ============================================================
