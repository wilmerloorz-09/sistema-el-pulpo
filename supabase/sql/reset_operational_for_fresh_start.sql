-- ============================================================
-- RESET OPERATIVO DEL SISTEMA POS PARA PRUEBAS DESDE CERO
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina solo datos transaccionales y operativos
--   - incluye ordenes especiales y sus pagos parciales/manuales
--   - incluye tarjetas dinamicas de Para Llevar y Orden Especial, que se reconstruyen desde `orders` y no se persisten como entidad aparte
--   - la tarjeta `+` de Para Llevar / Orden Especial es UI-only y siempre reaparece despues del reset
--   - incluye borradores vacios ocultos, borradores con items visibles y orden visual consecutivo calculado por UI
--   - incluye ordenes especiales con valor manual `$0` que el cierre de turno puede autopagar con confirmacion explicita
--   - incluye ordenes especiales `PAID` aunque su detalle de cobro no exista por cantidad en `payment_items`
--   - incluye ordenes Express (`order_type = EXPRESS`) en cualquier etapa del flujo despacho-cobro
--   - incluye ordenes Extra (`order_type = EXTRA`) en cualquier etapa del flujo caja -> PAID -> despacho manual (sin mesa)
--   - incluye cierre Extra con `close_extra_order` desde /extra (sin auto-despacho al cobrar; ver `20260602120000`)
--   - incluye tarjetas Extra pendientes en Despacho (pestanas Mesa y Todos; pestaña unificada Para llevar / Express)
--   - incluye alcance de caja secundaria Por llevar/Express por cajero (`secondary_caja_*`)
--   - incluye la numeracion/orden visible de cuentas de mesa basada en `orders.table_order_position` (reemplaza a divisiones)
--   - incluye la numeracion visible unificada: `orders.order_number` se deriva del sufijo de `orders.order_code`
--   - incluye snapshots visuales de mesa en `orders.table_name_snapshot`
--   - incluye bloqueos de edicion `orders.locked_for_editing` y cualquier sesion buffered de `Editar Orden` operando de manera In-Situ
--   - incluye la persistencia del estado de navegación mediante el parámetro `origin` y resaltado manual (forceActive/suppressActive)
--   - incluye el bloqueo automático del botón "Cobrar" en Caja mientras una orden está en edición
--   - incluye el agrupamiento visual de ítems en Caja y Resumen de Orden para mejorar la legibilidad
--   - incluye la flexibilidad de permisos: usuarios operativos ahora pueden acceder a "Editar orden" y búsqueda
--   - incluye la regla de Caja: una orden/item `DRAFT` nunca debe aparecer ni poder cobrarse en Caja
--   - incluye solicitudes pendientes de anulacion por orden/item y sus payloads `[PENDING_REQUEST]`
--   - incluye anulaciones seguras de pago con autorizacion de supervisor, registro histórico en `order_cancellations` y notas en pedidos
--   - incluye ordenes historicas por pago anulado marcadas con `VOID_SUCCESSOR_ORDER`, que deben quedar `CANCELLED` y no `PAID`
--   - incluye ordenes sucesoras creadas por anulacion de pago con `SUCCESSOR_OF_VOIDED_ORDER` y nuevo `order_code` / `order_number`
--   - incluye la gestión simplificada de mesas con pagos anulados (sin banner central de Pagos Anulados)
--   - incluye reapertura operativa de cuentas/mesas derivada de pagos anulados
--   - incluye movimientos entre órdenes de mesa (anteriormente Unir/Dividir divisiones), junto con su redistribucion de historial READY/DISPATCHED
--   - incluye solicitudes y metadatos de comprobantes de transferencia
--   - incluye tambien resultados OCR/analisis persistidos en `payment_proofs`
-- - Conserva usuarios, sucursales, permisos, referencia de mesas, capacidad interna de mesas y catalogos
-- - Conserva el modelo vigente de usuarios:
--   - `profiles.first_name` como Nombres visibles
--   - `profiles.last_name` como Apellidos
--   - `profiles.full_name` como compatibilidad legacy sincronizada desde `first_name`
-- - Conserva el flujo global
--    Caja antes de Despacho (Mesa, Para Llevar, Especial deben pagarse para ser elegibles para despacho).
--    Anulación de pagos requiere supervisor solo si hay ítems despachados; de lo contrario, es directa.
--    Toda anulación de pago deja un rastro de auditoría en `order_cancellations` y una nota histórica en el pedido.
--    Si la anulacion conserva una cuenta activa, la orden original queda historica `CANCELLED` con su numero original y la sucesora recibe un numero nuevo.
--    `Pagos del turno` debe reconstruirse desde `cash_shifts.opened_at`, no desde medianoche, para soportar turnos que cruzan de dia.
-- - `branches.workflow_mode` queda solo como compatibilidad interna forzada a `CASH_THEN_DISPATCH`
-- - Conserva la estructura de permisos por turno, pero limpia sus asignaciones activas y la auditoria/historial del turno cerrado
--   - al limpiar cash_shifts tambien se borra `opened_at`, que la UI muestra como fecha/hora de apertura del turno abierto
--   - al limpiar cash_shifts tambien se borra el usuario capturador y el equipo configurado para apertura de caja
--   - al limpiar cash_shift_users tambien se eliminan los session locks operativos (`last_session_id`) y cualquier toma de control vigente en Caja
--   - tambien limpia los session locks guardados en `profiles`, incluida la segunda sesion autorizada para Caja
-- - Conserva arbol menu, categorias, subcategorias, productos, modificadores y configuracion base
-- - Conserva productos frecuentes configurados (`extra_frequent_products` por contexto MESA/TAKEOUT/EXPRESS/EXTRA)
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
--   - el flujo de cobro/despacho es global: Caja primero y Despacho despues (excepto Express: despacho -> cobro; Extra: caja -> PAID -> despacho manual, cierre con `close_extra_order`)
--   - Despacho en UI: pestaña unificada Para llevar / Express; Extra visible en Mesa y Todos
--   - varios cajeros pueden tener can_use_caja en el mismo turno (hasta max_caja_sessions); cada uno abre su propia caja y denoms por cashier_id
--   - incluye configuracion de caja principal (`primary_cashier_id`) y secundarias con plantilla de arqueo y flags `secondary_caja_takeout_enabled` / `secondary_caja_express_enabled`
--   - al borrar cash_register_openings y cash_shift_denoms se eliminan todas las aperturas/denominaciones de todos los cajeros del turno
--   - el catalogo `denominations` se conserva; define lo que el cliente puede entregar al cobrar (independiente de plantilla de apertura)
--   - Caja cobra cantidades ordenadas activas antes del despacho (Express solo cuando KITCHEN_DISPATCHED)
--   - Caja excluye siempre items borrador; solo cobra items ya enviados al flujo operativo
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
--   - Para Llevar y Orden Especial muestran solo borradores con items; las ordenes no borrador permanecen visibles hasta despacho aplicado/cancelacion
--   - `Ordenes > Despachada` debe incluir cabecera KITCHEN_DISPATCHED y tambien PAID con despacho aplicado mientras la cabecera se sincroniza
-- - Conserva la regla de eliminacion completa de orden:
--   - requiere confirmacion visual antes de ejecutar
--   - todos los items deben estar en borrador o en caja
--   - no aplica si hay items despachados, pagados o con anulacion pendiente
-- - Conserva intactos los cambios frontend de shell responsivo, tabs de Caja por URL y rendimiento, porque no persisten en base de datos
-- - Conserva politicas de cancelacion/anulacion por categoria por sucursal
--   - por eso se mantiene que un mesero pueda anular directo solo en las categorias habilitadas por turno/sucursal
--   - si la selección toca una cantidad ya despachada, el flujo seguira requiriendo autorizacion
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
-- - Conserva la lógica de edición In-Situ:
--   - `Editar Orden` usa buffer temporal, `locked_for_editing` y confirma con `Aceptar cambios` preservando el contexto visual y de navegación (`origin`)
--   - el bloqueo de edición impide automáticamente el cobro en Caja para evitar discrepancias
--   - el cálculo de cambio se unifica para contemplar excedentes de todos los métodos de pago (incluyendo transferencias)
--   - al aumentar cantidad de un item ya enviado/en caja, se actualiza la misma linea si no tiene pagos registrados
--   - los items nuevos aceptados en ordenes "En caja" mantienen su flujo de cobro correcto
--   - incluye la restricción de **Caja Abierta**: el pago requiere obligatoriamente que la caja esté inicializada con denominaciones
--   - incluye la **Integridad Financiera**: precisión decimal estricta, redondeo financiero en cuadre y exclusión de cancelados en totales
--   - incluye la **Optimización para Tablet**: visualización de Despacho ajustada a 1280px para máxima operatividad
--   - Para Llevar y Orden Especial se despachan como orden completa; el detalle puede expandirse, pero no debe mostrar botones por item
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
  v_had_profile_first_name_constraint boolean := false;
  v_had_profile_last_name_constraint boolean := false;
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

    -- Ordenes (antes de cash_shifts: FK orders.cash_shift_id -> cash_shifts.id)
    'public.order_item_modifiers',
    'public.order_items',
    'public.orders',

    -- Divisiones de mesa operativas
    'public.table_splits',

    'public.cash_shift_users',
    'public.cash_shifts',

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

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_first_name_letters_only'
    )
    INTO v_had_profile_first_name_constraint;

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_last_name_letters_only'
    )
    INTO v_had_profile_last_name_constraint;

    IF v_had_profile_full_name_constraint THEN
      ALTER TABLE public.profiles
        DROP CONSTRAINT profiles_full_name_letters_only;
    END IF;

    IF v_had_profile_first_name_constraint THEN
      ALTER TABLE public.profiles
        DROP CONSTRAINT profiles_first_name_letters_only;
    END IF;

    IF v_had_profile_last_name_constraint THEN
      ALTER TABLE public.profiles
        DROP CONSTRAINT profiles_last_name_letters_only;
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

    IF v_had_profile_first_name_constraint THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_first_name_letters_only
        CHECK (first_name ~ U&'^[A-Za-z\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1[:space:]]+$') NOT VALID;
    END IF;

    IF v_had_profile_last_name_constraint THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_last_name_letters_only
        CHECK (last_name ~ U&'^[A-Za-z\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1[:space:]]+$') NOT VALID;
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
-- - Perfiles intactos con first_name/last_name/full_name legacy conservados
-- - Sucursales intactas
-- - Flujo global Caja - Despacho intacto
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
-- - 0 ordenes historicas `VOID_SUCCESSOR_ORDER` y 0 ordenes sucesoras `SUCCESSOR_OF_VOIDED_ORDER`
-- - 0 anulaciones parciales pendientes/ejecutadas y 0 pagos de reemplazo derivados de anulacion parcial
-- - 0 movimientos Unir/Dividir persistidos ni historial READY/DISPATCHED redistribuido entre ordenes
-- - 0 borradores vacios residuales capaces de seguir ocupando una mesa en overview
-- - 0 borradores no enviados residuales capaces de bloquear cierre de turno
-- - 0 ordenes/items borrador visibles o cobrables en Caja
-- - 0 ordenes especiales `$0` pendientes capaces de bloquear cierre de turno
-- - 0 ordenes especiales `PAID` historicas ocultas por falta de detalle cobrado en `payment_items`
-- - archivos en Supabase Storage no se borran con este SQL
--   - recomendado: `node .\scripts\empty-payment-proofs-bucket.mjs`
-- - Catalogo intacto (incluye arbol menu mesa, arbol menu para llevar, arbol a granel, imagenes de producto, precios manuales por categoria, productos incluidos para a granel, asignaciones por nodo y productos frecuentes por contexto)
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos (incluye orden especial, Express, Extra con flujo caja-despacho manual y cierre `close_extra_order`, aperturas multi-cajero y principal/secundaria con flags takeout/express, modificaciones transaccionales In-Situ, bloqueos de edicion, solicitudes/anulaciones de pago, movimientos entre órdenes, órdenes reabiertas por anulacion y alertas de listo)
-- - 0 aperturas de caja por cajero (cash_register_openings) ni denominaciones particionadas (cash_shift_denoms.cashier_id / opening_id)
-- - 0 tarjetas operativas de Para Llevar / Orden Especial derivadas de ordenes reales; solo queda la tarjeta `+` UI-only al entrar al modulo
-- - 0 base operativa para reimprimir reportes de caja por apertura o consolidado del turno previo
-- - 0 posiciones visibles de cuentas por mesa ni snapshots historicos de nombre de mesa
-- - 0 codigos/numeros visibles de orden previos; la siguiente orden vuelve a generar `order_code` y sincronizar `order_number`
-- - Contadores de usuarios/mesas/sucursales preservados
-- ============================================================
