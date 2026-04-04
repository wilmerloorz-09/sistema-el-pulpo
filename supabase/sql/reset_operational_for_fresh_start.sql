-- ============================================================
-- RESET OPERATIVO DEL SISTEMA POS PARA PRUEBAS DESDE CERO
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina solo datos transaccionales y operativos
--   - incluye ordenes especiales y sus pagos parciales/manuales
-- - Conserva usuarios, sucursales, permisos, referencia de mesas, capacidad interna de mesas y catalogos
-- - Conserva arbol menu, categorias, subcategorias, productos, modificadores y configuracion base
-- - Conserva todos los arboles operativos de menu_nodes:
--   - `TABLE`
--   - `TAKEOUT`
--   - `BULK`
-- - Conserva tambien `menu_nodes.image_url` / `legacy_product_id`, por lo que Caja y Ordenes siguen pudiendo resolver imagen real de producto
-- - Conserva la configuracion `manual_price_enabled` en categorias de `menu_nodes`
-- - Conserva la configuracion de productos incluidos para `A granel` y sus reglas de entrega por monto
-- - Conserva las RPCs/funciones operativas, incluidas las de alerta de mesero, las de orden especial y el sistema de tickets (80mm)
-- - Conserva intactos los cambios frontend de shell responsivo, tabs de Caja por URL y rendimiento, porque no persisten en base de datos
-- - Conserva politicas de cancelacion/anulacion por categoria por sucursal
--   - por eso se mantiene que un mesero pueda anular directo solo en las categorias habilitadas por turno/sucursal
--   - si la seleccion toca una cantidad ya despachada, el flujo seguira requiriendo autorizacion
--   - administrador, supervisor y usuario con can_authorize_order_cancel conservan su capacidad de resolver directo
-- - Conserva configuracion estructural de despacho por sucursal:
--   - dispatch_config
--   - dispatch_assignments
-- - Reinicia la operacion diaria sin desmontar el sistema
--
-- IDEAL PARA:
-- - volver a probar el flujo del POS desde cero
-- - limpiar ventas, ordenes, cocina, despacho y caja
-- - limpiar tambien solicitudes de anulacion pendientes ya registradas
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
    'public.cash_register_movements',
    'public.cash_register_openings',
    'public.cash_movements',
    'public.cash_shift_denoms',
    'public.payments',
    'public.operational_losses',
    'public.cash_shift_users',
    'public.cash_shifts',

    -- Ordenes
    'public.order_item_modifiers',
    'public.order_items',
    'public.orders',

    -- Divisiones de mesa operativas
    'public.table_splits',

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

  IF to_regclass('public.restaurant_tables') IS NOT NULL THEN
    UPDATE public.restaurant_tables
    SET is_active = false;
    RAISE NOTICE 'Mesas internas desactivadas para dejar el turno en limpio';
  END IF;

  IF to_regclass('public.entity_counters') IS NOT NULL THEN
    DELETE FROM public.entity_counters
    WHERE entity_key IN (
      'orders',
      'cash_shifts',
      'cash_register_openings',
      'cash_register_movements'
    );
    RAISE NOTICE 'Se limpiaron solo contadores operativos, preservando perfiles/mesas/sucursales';
  END IF;
END $$;

-- Reinicia secuencias legacy si existen.
ALTER SEQUENCE IF EXISTS public.orders_order_number_seq RESTART WITH 1;

COMMIT;

-- ============================================================
-- POST RESET ESPERADO
-- - Usuarios intactos
-- - Sucursales intactas
-- - Referencia de mesas intacta
-- - Mesas internas intactas, pero desactivadas
-- - Politicas de cancelacion/anulacion por categoria intactas
-- - Reglas de anulacion directa por mesero intactas:
--   - las categorias habilitadas siguen marcadas
--   - las lineas ya despachadas siguen requiriendo autorizacion para mesero
-- - Configuracion y asignaciones de despacho intactas
-- - Catalogo intacto (incluye arbol menu mesa, arbol menu para llevar, arbol a granel, imagenes de producto, precios manuales por categoria, productos incluidos para a granel y asignaciones por nodo)
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos (incluye orden especial, solicitudes/anulaciones pendientes y alertas de listo)
-- - Contadores de usuarios/mesas/sucursales preservados
-- ============================================================
