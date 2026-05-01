-- ============================================================
-- RESET OPERATIVO DEL SISTEMA POS PARA PRUEBAS DESDE CERO
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina solo datos transaccionales y operativos
--   - incluye ordenes especiales y sus pagos parciales/manuales
--   - incluye ordenes especiales con valor manual `$0` que el cierre de turno puede autopagar con confirmacion explicita
--   - incluye ordenes especiales `PAID` aunque su detalle de cobro no exista por cantidad en `payment_items`
--   - incluye la numeracion/orden visible de cuentas de mesa basada en `orders.table_order_position`
--   - incluye snapshots visuales de mesa en `orders.table_name_snapshot`
--   - incluye bloqueos de edicion `orders.locked_for_editing` y cualquier sesion buffered de `Editar Orden`
--   - incluye solicitudes pendientes de anulacion por orden/item y sus payloads `[PENDING_REQUEST]`
--   - incluye anulaciones seguras de pago con autorizacion de supervisor
--   - incluye reapertura operativa de cuentas/mesas derivada de pagos anulados
--   - incluye movimientos entre ordenes DINE_IN por Unir/Dividir, junto con su redistribucion de historial READY/DISPATCHED
--   - incluye solicitudes y metadatos de comprobantes de transferencia
--   - incluye tambien resultados OCR/analisis persistidos en `payment_proofs`
-- - Conserva usuarios, sucursales, permisos, referencia de mesas, capacidad interna de mesas y catalogos
-- - Conserva `branches.workflow_mode`:
--   - `DISPATCH_THEN_CASH` mantiene despacho primero y caja despues para mesa/especial
--   - `CASH_THEN_DISPATCH` mantiene caja primero y despacho despues para mesa, para llevar y especial
-- - Conserva la estructura de permisos por turno, pero limpia sus asignaciones activas y la auditoria/historial del turno cerrado
--   - al limpiar cash_shifts tambien se borra `opened_at`, que la UI muestra como fecha/hora de apertura del turno abierto
--   - al limpiar cash_shifts tambien se borra el usuario capturador y el equipo configurado para apertura de caja
--   - al limpiar cash_shift_users tambien se eliminan los session locks operativos (`last_session_id`) y cualquier toma de control vigente en Caja
--   - tambien limpia los session locks guardados en `profiles`, incluida la segunda sesion autorizada para Caja
-- - Conserva arbol menu, categorias, subcategorias, productos, modificadores y configuracion base
-- - Conserva todos los arboles operativos de menu_nodes:
--   - `TABLE`
--   - `TAKEOUT`
--   - `BULK`
-- - Conserva tambien `menu_nodes.image_url` / `legacy_product_id`, por lo que Caja y Ordenes siguen pudiendo resolver imagen real de producto
-- - Conserva la configuracion `manual_price_enabled` en categorias de `menu_nodes`
-- - Conserva la configuracion de productos incluidos para `A granel` y sus reglas de entrega por monto
-- - Conserva plantillas de apertura de caja y su composicion:
--   - `cash_register_templates`
--   - `cash_register_template_denoms`
-- - Conserva la diferencia arquitectonica entre caja y turno:
--   - cerrar caja sigue siendo distinto de cerrar turno
--   - el flujo de cobro/despacho sigue saliendo de `branches.workflow_mode`
--   - en `CASH_THEN_DISPATCH`, Caja cobra cantidades ordenadas activas antes del despacho
--   - el cierre de turno cancela borradores no enviados sin pagos ni items operativos antes de evaluar bloqueos
--   - cerrar turno puede resolver ordenes especiales pendientes de `$0` solo con confirmacion explicita antes de invocar el cierre normal
--   - el conteo de esa confirmacion solo debe incluir SENT_TO_KITCHEN, READY y KITCHEN_DISPATCHED sin paid_at
-- - Conserva la arquitectura de reportes de caja, pero borra la base operativa que esos reportes leen:
--   - aperturas/cierres de `cash_register_openings`
--   - pagos del rango
--   - movimientos de caja
--   - composicion actual de `cash_shift_denoms`
-- - Conserva las RPCs/funciones operativas, incluidas las de alerta de mesero, las de orden especial y el sistema de tickets (80mm)
-- - Conserva la regla visual de Ordenes:
--   - ordenes especiales `PAID` deben aparecer en Pagadas aunque no tengan cantidades pagadas por item
--   - `special_total_manual` es el valor manual visible/cobrable de la orden especial
-- - Conserva intactos los cambios frontend de shell responsivo, tabs de Caja por URL y rendimiento, porque no persisten en base de datos
-- - Conserva politicas de cancelacion/anulacion por categoria por sucursal
--   - por eso se mantiene que un mesero pueda anular directo solo en las categorias habilitadas por turno/sucursal
--   - si la seleccion toca una cantidad ya despachada, el flujo seguira requiriendo autorizacion
--   - administrador, supervisor y usuario con can_authorize_order_cancel conservan su capacidad de resolver directo
-- - Conserva configuracion estructural de despacho por sucursal:
--   - dispatch_config
--   - dispatch_assignments
-- - Reinicia la operacion diaria sin desmontar el sistema
--   - al borrar cash_shift_users se limpian permisos del turno actual para Mesas, Ordenes, Despacho, Productos, Caja y autorizacion de anulacion
--   - al borrar cash_shift_users se limpia tambien la habilitacion `can_double_session`; el reset ademas limpia las columnas de sesion secundaria en profiles
--   - al borrar cash_shifts tambien se elimina la auditoria de cierre (usuario/equipo/user agent)
--   - al borrar payment_void_requests y payments se eliminan solicitudes/aprobaciones/ejecuciones de anulacion de pago
--   - esto incluye anulacion total y parcial, pagos de reemplazo (`replacement_payment_id`) y desglose de devolucion en efectivo
--   - al borrar `orders`, `order_cancellations` y `order_item_cancellations` se limpian tambien:
--     - `orders.cancel_requested_at`
--     - cabeceras pendientes `[PENDING_REQUEST]`
--     - solicitudes por item usadas por el tab `Pendiente de anulacion`
--   - al borrar orders y table_splits se eliminan tambien las divisiones reabiertas por anulacion de pago
--   - aunque `table_splits` se limpia por compatibilidad, la base vigente de tabs/cuentas de mesa ya vive en `orders.table_order_position`
--   - al borrar order_ready_events/order_dispatch_events y sus lineas tambien se limpia cualquier trazabilidad recreada por mover items entre ordenes
--   - al borrar payment_capture_requests y payment_proofs se limpia el flujo operativo de comprobantes de transferencia
-- - Conserva tambien los ajustes recientes de abril 14:
--   - `get_branch_tables_overview(...)` sigue ignorando borradores vacios
--   - crear/eliminar cuentas adicionales sigue alineado al shift gate operativo
-- - NO elimina archivos del bucket privado de Supabase Storage
--   - si ya subiste comprobantes reales al bucket payment-proofs, su limpieza debe hacerse aparte
--   - metodo recomendado: `node .\scripts\empty-payment-proofs-bucket.mjs`
--   - wrapper opcional: `.\scripts\reset-payment-proofs-storage.ps1`
--
-- IDEAL PARA:
-- - volver a probar el flujo del POS desde cero
-- - limpiar ventas, ordenes, cocina, despacho y caja
-- - limpiar tambien solicitudes de anulacion pendientes ya registradas
-- - limpiar tambien reaperturas de mesa/division generadas por anulaciones de pago
-- - mantener lista la base para nuevas pruebas sin reconfigurar todo
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_table text;
  v_session_column text;
  v_had_profile_full_name_constraint boolean := false;
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
    'public.payment_void_requests',
    'public.payment_items',
    'public.cash_register_movements',
    'public.cash_register_openings',
    'public.cash_movements',
    'public.cash_shift_denoms',
    'public.payment_proofs',
    'public.payment_capture_requests',
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

  -- Limpia session locks efimeros en perfiles conservados.
  -- Incluye la segunda sesion permitida para Caja por `can_double_session`.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_full_name_letters_only'
    )
    INTO v_had_profile_full_name_constraint;

    IF v_had_profile_full_name_constraint THEN
      ALTER TABLE public.profiles
        DROP CONSTRAINT profiles_full_name_letters_only;
    END IF;

    FOREACH v_session_column IN ARRAY ARRAY[
      'current_app_session_id',
      'current_app_session_started_at',
      'current_app_session_device',
      'current_app_secondary_session_id',
      'current_app_secondary_session_started_at',
      'current_app_secondary_session_device'
    ]
    LOOP
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = v_session_column
      ) THEN
        EXECUTE format('UPDATE public.profiles SET %I = NULL;', v_session_column);
      END IF;
    END LOOP;

    IF v_had_profile_full_name_constraint THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_full_name_letters_only
        CHECK (full_name ~ U&'^[A-Za-z\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1[:space:]]+$') NOT VALID;
    END IF;

    RAISE NOTICE 'Session locks de app limpiados en profiles';
  END IF;

  IF to_regclass('public.restaurant_tables') IS NOT NULL THEN
    UPDATE public.restaurant_tables
    SET is_active = false;
    RAISE NOTICE 'Mesas internas desactivadas para dejar el turno en limpio';
  END IF;

  IF to_regclass('public.entity_counters') IS NOT NULL THEN
    DELETE FROM public.entity_counters
    WHERE entity_key IN (
      'orders_daily',
      'orders_repair',
      'cash_shifts',
      'cash_movements',
      'payments'
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
-- - Flujo de trabajo por sucursal intacto (`branches.workflow_mode`)
-- - Referencia de mesas intacta
-- - Mesas internas intactas, pero desactivadas
-- - Politicas de cancelacion/anulacion por categoria intactas
-- - Reglas de anulacion directa por mesero intactas:
--   - las categorias habilitadas siguen marcadas
--   - las lineas ya despachadas siguen requiriendo autorizacion para mesero
-- - Configuracion y asignaciones de despacho intactas
-- - Plantillas de apertura de caja intactas
-- - 0 usuarios habilitados por turno y 0 auditoria de cierre previa
-- - 0 turnos abiertos y 0 fecha/hora de apertura visible en `Admin > Turno`
-- - 0 session locks/toma de control vigente en Caja, incluida la segunda sesion de app
-- - 0 solicitudes de captura y 0 metadatos de comprobantes de transferencia (incluye OCR/analisis)
-- - 0 solicitudes/anulaciones pendientes por item/orden, 0 payloads `[PENDING_REQUEST]`, 0 solicitudes/anulaciones seguras de pago, 0 reversas de caja por anulacion y 0 reaperturas de mesa/division derivadas de esos pagos
-- - 0 anulaciones parciales pendientes/ejecutadas y 0 pagos de reemplazo derivados de anulacion parcial
-- - 0 movimientos Unir/Dividir persistidos ni historial READY/DISPATCHED redistribuido entre ordenes
-- - 0 borradores vacios residuales capaces de seguir ocupando una mesa en overview
-- - 0 borradores no enviados residuales capaces de bloquear cierre de turno
-- - 0 ordenes especiales `$0` pendientes capaces de bloquear cierre de turno
-- - 0 ordenes especiales `PAID` historicas ocultas por falta de detalle cobrado en `payment_items`
-- - archivos en Supabase Storage no se borran con este SQL
--   - recomendado: `node .\scripts\empty-payment-proofs-bucket.mjs`
-- - Catalogo intacto (incluye arbol menu mesa, arbol menu para llevar, arbol a granel, imagenes de producto, precios manuales por categoria, productos incluidos para a granel y asignaciones por nodo)
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos (incluye orden especial, modificaciones transaccionales, bloqueos de edicion, solicitudes/anulaciones de pago, `Unir/Dividir`, divisiones reabiertas por anulacion y alertas de listo)
-- - 0 base operativa para reimprimir reportes de caja por apertura o consolidado del turno previo
-- - 0 posiciones visibles de cuentas por mesa ni snapshots historicos de nombre de mesa
-- - Contadores de usuarios/mesas/sucursales preservados
-- ============================================================






