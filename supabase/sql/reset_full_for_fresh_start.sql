-- ============================================================
-- RESET TOTAL DEL SISTEMA POS PARA PRUEBAS DESDE CERO (MODO DESTRUCTIVO)
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina datos operativos: ordenes, items, pagos, caja, cocina, despacho, mesas
--   - incluye ordenes normales y ordenes especiales (`is_special`, `special_total_manual`)
--   - incluye tarjetas dinamicas de Para Llevar y Orden Especial, que se reconstruyen desde `orders` y no se persisten como entidad aparte
--   - la tarjeta `+` de Para Llevar / Orden Especial es UI-only y siempre reaparece despues del reset
--   - incluye borradores vacios ocultos, borradores con items visibles y orden visual consecutivo calculado por UI
--   - incluye ordenes especiales con valor manual `$0` que el cierre de turno puede autopagar con confirmacion explicita
--   - incluye ordenes especiales `PAID` aunque su detalle de cobro no exista por cantidad en `payment_items`
--   - incluye ordenes Express (`order_type = EXPRESS`) y su flujo despacho antes de cobro
--   - incluye ordenes Extra (`order_type = EXTRA`) y su flujo caja -> PAID -> despacho manual, ahora requiriendo seleccion obligatoria de mesa
--   - incluye cierre Extra desde /extra via `close_extra_order` (las ordenes Extra despachadas desaparecen automaticamente del modulo Extra)
--   - incluye listado Extra en Despacho (pestanas Mesa y Todos; pestañas unificadas)
--   - caja unificada: el alcance “todas/mías/por usuario” es UI (no flags `secondary_caja_*`)
--   - incluye productos frecuentes configurados (`extra_frequent_products` por contexto MESA/TAKEOUT/EXPRESS/EXTRA)
--   - incluye comensales (`clientes`), vinculo opcional `orders.cliente_id` y participaciones en campañas (`predicciones_clientes`)
--   - incluye campañas promocionales activas/inactivas, cartelera JSON, cierre de ofertas y cupones generados
--   - incluye permisos por turno para registrar promociones (`permisos_promociones_turnos`, auto-creado al habilitar usuario en turno)
--   - incluye la numeracion/orden visible de cuentas de mesa basada en `orders.table_order_position` (reemplaza a divisiones)
--   - incluye snapshots visuales de mesa en `orders.table_name_snapshot`
--   - incluye bloqueos de edicion `orders.locked_for_editing` y cualquier sesion buffered de `Editar Orden` operando de manera In-Situ
--   - incluye la persistencia del estado de navegaciÃ³n mediante el parÃ¡metro `origin` y resaltado manual (forceActive/suppressActive)
--   - incluye el bloqueo transaccional del botÃ³n "Cobrar" en Caja mientras una orden estÃ¡ en ediciÃ³n
--   - incluye el agrupamiento visual de Ã­tems en toda la UI operativa (Caja, Ordenes)
--   - incluye la apertura de permisos operativos para ediciÃ³n de orden y bÃºsqueda
--   - incluye solicitudes pendientes de anulacion de orden/item (`orders.cancel_requested_at`, `order_cancellations`, `order_item_cancellations`)
--   - incluye payloads serializados en `order_cancellations.notes` con prefijo `[PENDING_REQUEST]`
--   - incluye solicitudes de anulacion de pago, anulaciones parciales, pagos de reemplazo y registro histÃ³rico en `order_cancellations` y `orders.notes`
--   - incluye ordenes historicas por pago anulado marcadas con `VOID_SUCCESSOR_ORDER`, que deben quedar `CANCELLED` y no `PAID`
--   - incluye ordenes sucesoras creadas por anulacion de pago con `SUCCESSOR_OF_VOIDED_ORDER` que conservan el `order_code` / `order_number` original
--   - incluye la gestiÃ³n simplificada de mesas con pagos anulados (eliminaciÃ³n del banner central de Pagos Anulados)
--   - incluye movimientos entre Ã³rdenes de mesa (anteriormente Unir/Dividir divisiones)
--   - incluye solicitudes y metadatos de comprobantes de transferencia
--   - incluye resultados de OCR/analisis guardados en `payment_proofs`
-- - Elimina historial de aperturas/anulaciones/movimientos de caja y usuarios habilitados por turno
--   - incluye multiples aperturas por turno (una por cajero en cash_register_openings) y denoms por cashier_id/opening_id
--   - incluye configuración de caja por turno con principal opcional (`primary_cashier_id`) y plantilla por cajero
--   - incluye cobro con catalogo global de denominaciones (UI) vs plantilla de arqueo (apertura); tras reset solo queda el catalogo en `denominations`
--   - incluye el turno operativo `cash_shifts.opened_at` que la UI muestra como fecha/hora de apertura en `Admin > Turno`
--   - incluye `cash_shifts.max_caja_sessions` and slots de sesion Caja en cash_shift_users (caja_session_slots)
--   - incluye permisos operativos por turno para Mesas, Ordenes, Despacho, Productos, Caja, autorizacion de anulacion, Empacador y Servir
--   - incluye templates de apertura de caja y su composicion por denominacion
--   - deja sin base transaccional los reportes de caja por apertura y el consolidado por turno
--   - incluye auditoria de cierre de turno (closed_by, closed_from_device, closed_from_user_agent)
-- - Elimina catalogos operativos: arbol menu, categorias, subcategorias, productos, modificadores
--   - incluye todos los alcances de menu_nodes: `TABLE`, `TAKEOUT` y `BULK`
--   - incluye imagenes/referencias visuales de productos en `menu_nodes.image_url`
--   - incluye configuraciones de categoria como `manual_price_enabled`
--   - incluye configuracion de productos incluidos para `A granel` y sus reglas de entrega por monto
-- - Elimina sucursales y configuraciones asociadas:
--   - incluye referencia de mesas por sucursal
--   - incluye `branches.workflow_mode`, que queda forzado globalmente a `CASH_THEN_DISPATCH`
--   - incluye catalogo de denominaciones globales
-- - Elimina politicas/configuraciones por sucursal:
--   - cancelacion/anulacion directa por categoria
--   - con eso tambien se resetea la habilitacion de anulacion directa por mesero
--   - despues del reset ya no queda ninguna categoria autorizada para anulacion directa
--   - configuracion de despacho por sucursal
--   - asignaciones de despacho
-- - Elimina usuarios no protegidos y sus metadatos:
--   - incluye roles desglosados y herencia de permisos
--   - incluye avatares y configuraciones de perfil modernizadas
--   - conserva el modelo vigente de usuario con `first_name` (Nombres), `last_name` (Apellidos) y `full_name` legacy sincronizado desde `first_name`
--   - limpia session locks de app del superadmin protegido, incluida la segunda sesion autorizada para Caja
-- - Conserva solo el superadmin principal protegido
-- - Preserva estructura base del sistema: modulos, roles, permisos, funciones, migraciones
--
-- PRECONDICION:
-- - Debe existir exactamente 1 perfil con profiles.is_protected_superadmin = true
--
-- ADVERTENCIA:
-- - ESTE SCRIPT ES DESTRUCTIVO
-- - NO LO EJECUTES SI QUIERES CONSERVAR HISTORIAL
-- - DESPUES DEL RESET TENDRAS QUE CONFIGURAR SUCURSAL/PRODUCTOS/REFERENCIA DE MESAS DESDE CERO
-- - LOS ARCHIVOS DEL BUCKET PRIVADO `payment-proofs` DEBEN BORRARSE APARTE
--   - metodo recomendado: ejecutar `node .\scripts\empty-payment-proofs-bucket.mjs`
--   - wrapper opcional: `.\scripts\reset-payment-proofs-storage.ps1`
-- - SI YA USAS ARBOL MENU MESA / PARA LLEVAR / A GRANEL, TODOS QUEDAN VACIOS
-- - LAS RPCS/FUNCIONES PERMANECEN INTACTAS, INCLUIDAS LAS DE ALERTA DE MESERO (emit_order_ready_alert, get_mesero_ready_alerts, order_has_dispatch_after)
-- - AUNQUE ESTE RESET SIGUE LIMPIANDO `table_splits`, LA BASE OPERATIVA ACTUAL DE TABS/CUENTAS DE MESA YA VIVE EN `orders.table_order_position`
-- - TAMBIEN QUEDAN INTACTOS LOS AJUSTES RECIENTES DE ABRIL 14:
--   - `get_branch_tables_overview(...)` ignora borradores vacios
--   - crear/eliminar cuentas adicionales sigue alineado al shift gate operativo
-- - TAMBIEN QUEDA INTACTA LA LOGICA DE ANULACION:
--   - mesero: anulacion directa solo en categorias habilitadas y mientras no toque cantidades ya despachadas
--   - items/ordenes despachados: requieren autorizacion si quien opera no tiene autoridad directa
--   - administrador, supervisor y usuario con can_authorize_order_cancel siguen pudiendo resolver directo
--   - la infraestructura de solicitud pendiente sigue existiendo:
--     - `create_pending_order_cancellation_request(...)`
--     - `request_order_cancellation(...)`
--     - `clear_pending_order_cancellation_request(...)`
--     - `list_pending_order_cancellation_requests(...)`
-- - LAS REGLAS DE HERENCIA DE PERMISOS POR TURNO SIGUEN EXISTIENDO EN LA ESTRUCTURA:
--   - Mesas incluye acceso a Ordenes
--   - Despacho incluye acceso total a Productos
--   - Ordenes y Productos tambien pueden habilitarse por separado
--   - la doble sesion de Caja sigue dependiendo de `cash_shift_users.can_double_session`
-- - TAMBIEN PERMANECEN INTACTAS LAS RPCS de ORDEN ESPECIAL Y EL SISTEMA de TICKETS (80mm)
-- - TAMBIEN PERMANECE INTACTA LA LIMPIEZA CENTRAL DE CIERRE DE TURNO:
--   - `cancel_empty_draft_orders_for_branch(...)` cancela borradores no enviados sin pagos ni items operativos
--   - `list_branch_closure_blocking_orders(...)` no debe bloquear por borradores vacios
-- - TAMBIEN PERMANECE INTACTA LA REGLA UI DE CIERRE DE TURNO:
--   - si hay ordenes especiales pendientes con valor `$0`, se debe pedir confirmacion
--   - al continuar, esas ordenes se marcan `PAID` y luego se invoca el cierre normal del turno
--   - el conteo debe limitarse a estados realmente bloqueantes: SENT_TO_KITCHEN, READY y KITCHEN_DISPATCHED sin paid_at
-- - TAMBIEN PERMANECE INTACTA LA REGLA DE VISIBILIDAD:
--   - ordenes especiales `PAID` deben aparecer en Pagadas aunque no tengan cantidades pagadas por item
--   - Para Llevar y Orden Especial muestran solo borradores con items; las ordenes no borrador permanecen visibles hasta despacho aplicado/cancelacion
--   - `Ordenes > Despachada` debe incluir cabecera KITCHEN_DISPATCHED y tambien PAID con despacho aplicado mientras la cabecera se sincroniza
-- - TAMBIEN PERMANECE INTACTA LA REGLA DE ELIMINAR ORDEN COMPLETA:
--   - requiere confirmacion visual antes de ejecutar
--   - solo aplica si todos los items estan en borrador o en caja
--   - si existe algun item despachado, pagado o con anulacion pendiente, no debe mostrarse ni ejecutarse
-- - ESTE RESET BORRA DATOS DE CAJA/PAGOS, PERO NO CAMBIA LA REGLA DE PRODUCTO:
--   - cerrar caja y cerrar turno siguen siendo operaciones distintas en la arquitectura
--   - el flujo global sigue siendo Caja antes de Despacho (Mesa, Para Llevar, Especial, Extra); Express es despacho antes de cobro.
--   - Extra queda PAID tras cobrar y requiere despacho manual en Despacho (Mesa/Todos); cierre con `close_extra_order` desde /extra.
--   - Despacho usa pestaÃ±a unificada Para llevar / Express (TAKEOUT + EXPRESS); ya no hay pestaÃ±a Express separada.
--   - cada cajero habilitado abre su propia caja en el mismo turno; el reset borra todas las aperturas y denoms asociadas.
--   - la plantilla de apertura (`cash_register_template_denoms`) es independiente del catalogo `denominations` usado en cobro
--   - AnulaciÃ³n de pagos requiere supervisor solo si hay Ã­tems despachados; de lo contrario, es directa.
--   - Toda anulaciÃ³n de pago deja un rastro de auditorÃ­a en `order_cancellations` y una nota histÃ³rica en el pedido.
--   - Si la anulacion conserva una cuenta activa, la orden sucesora hereda/conserva el numero y codigo original, mientras la orden original queda historica `CANCELLED` con su codigo original modificado por un sufijo.
--   - `Pagos del turno` debe reconstruirse desde `cash_shifts.opened_at`, no desde medianoche, para soportar turnos que cruzan de dia.
--   - `branches.workflow_mode` queda como compatibilidad interna con default `CASH_THEN_DISPATCH`
--   - el reporte por apertura sigue dependiendo de `cash_register_openings`, `payments`, `cash_movements` y `cash_shift_denoms`, pero aqui esos datos quedan vacios
-- - LOS AJUSTES RECIENTES de NAVEGACION (sidebar, bottom nav, tabs de Caja por URL) Y RENDIMIENTO SON SOLO FRONTEND Y NO SE VEN AFECTADOS POR ESTE RESET
-- - TAMBIEN QUEDA INTACTA LA LOGICA DE EDICION:
--   - `Editar Orden` usa buffer temporal, `locked_for_editing` y confirma con `Aceptar cambios` preservando el contexto visual (In-Situ) y de navegaciÃ³n (`origin`)
--   - el bloqueo de ediciÃ³n impide automÃ¡ticamente el cobro en Caja para evitar discrepancias
--   - el cÃ¡lculo de cambio se unifica para contemplar excedentes de todos los mÃ©todos de pago (incluyendo transferencias)
--   - los Ã­tems nuevos aceptados en Ã³rdenes "En caja" mantienen su flujo de cobro correcto
--   - incluye la restricciÃ³n de **Caja Abierta**: el pago requiere obligatoriamente que la caja estÃ© inicializada con denominaciones
--   - incluye la **Integridad Financiera**: precisiÃ³n decimal estricta, redondeo financiero en cuadre y exclusiÃ³n de cancelados en totales
--   - incluye la **OptimizaciÃ³n para Tablet**: visualizaciÃ³n de Despacho ajustada a 1280px para mÃ¡xima operatividad
--   - Para Llevar y Orden Especial se despachan como orden completa; el detalle puede expandirse, pero no debe mostrar botones por item
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_protected_count integer;
  v_protected_user_id uuid;
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

    -- Promociones / comensales
    'public.predicciones_clientes',
    'public.permisos_promociones_turnos',
    'public.campanas_promocionales',
    'public.clientes',

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

    -- Ordenes
    'public.order_item_modifiers',
    'public.order_items',
    'public.orders',

    -- Mesas
    'public.table_splits',
    'public.restaurant_tables',

    -- Configuracion por sucursal
    'public.branch_cancel_policy',

    -- Catalogos
    'public.extra_frequent_products',
    'public.bulk_included_product_ranges',
    'public.bulk_included_products',
    'public.menu_node_modifiers',
    'public.menu_nodes',
    'public.subcategory_modifiers',
    'public.products',
    'public.subcategories',
    'public.modifiers',
    'public.categories',
    'public.denominations',
    'public.payment_methods',
    'public.cash_register_template_denoms',
    'public.cash_register_templates',

    -- Caja / despacho / configuracion operativa por sucursal
    'public.cash_shift_users',
    'public.cash_shifts',
    'public.dispatch_assignments',
    'public.dispatch_config',
    'public.entity_counters',

    -- Accesos ligados a sucursal
    'public.user_module_change_history',
    'public.user_branch_change_history',
    'public.supervisor_branch_module_limits',
    'public.user_branch_modules',
    'public.user_branch_roles',
    'public.user_branches',

    -- Configuracion general / auditoria
    'public.system_settings',
    'public.audit_log',

    -- Sucursales al final
    'public.branches'
  ];
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'No existe public.profiles. Script cancelado.';
  END IF;

  SELECT count(*)
  INTO v_protected_count
  FROM public.profiles
  WHERE is_protected_superadmin = true;

  IF v_protected_count = 0 THEN
    RAISE EXCEPTION 'No existe un superadmin protegido. Aborta para evitar borrar todos los accesos.';
  END IF;

  IF v_protected_count > 1 THEN
    RAISE EXCEPTION 'Se encontraron % superadmins protegidos. Deja exactamente 1 antes de ejecutar este reset.', v_protected_count;
  END IF;

  SELECT id
  INTO v_protected_user_id
  FROM public.profiles
  WHERE is_protected_superadmin = true
  LIMIT 1;

  RAISE NOTICE 'Superadmin protegido preservado: %', v_protected_user_id;

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

  -- Evita FK a sucursales antes de borrarlas.
  -- Aqui hay que limpiar la referencia para TODOS los perfiles existentes,
  -- no solo para el superadmin protegido.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'active_branch_id'
  ) THEN
    UPDATE public.profiles
    SET active_branch_id = NULL
    WHERE active_branch_id IS NOT NULL;
  END IF;

  -- Limpia session locks efimeros de la app antes/despues del borrado.
  -- Incluye la segunda sesion permitida para Caja por `can_double_session`.
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

  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(v_table) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %s;', v_table);
      RAISE NOTICE 'Tabla limpiada: %', v_table;
    ELSE
      RAISE NOTICE 'Tabla no encontrada, se omite: %', v_table;
    END IF;
  END LOOP;

  -- Conserva solo credenciales/passkeys del superadmin protegido.
  IF to_regclass('public.webauthn_credentials') IS NOT NULL THEN
    EXECUTE format(
      'DELETE FROM public.webauthn_credentials WHERE user_id <> %L::uuid;',
      v_protected_user_id
    );
  END IF;

  -- Conserva solo roles globales/legacy del superadmin protegido.
  IF to_regclass('public.user_global_roles') IS NOT NULL THEN
    EXECUTE format(
      'DELETE FROM public.user_global_roles WHERE user_id <> %L::uuid;',
      v_protected_user_id
    );
  END IF;

  IF to_regclass('public.user_roles') IS NOT NULL THEN
    EXECUTE format(
      'DELETE FROM public.user_roles WHERE user_id <> %L::uuid;',
      v_protected_user_id
    );
  END IF;

  --   - incluye auto-pago de ordenes especiales cuando los abonos/pagos alcanzan su valor manual, independientemente de sus items
--   - incluye visualizacion explicita de ordenes 'Especial' en reportes, desvinculandolas de su tipo de base (Mesa/Extra)
--   - incluye exclusividad mutua en embudo de Monitoreo Global para no sobrecontar ordenes despachadas como generadas
--   - incluye grid responsivo mejorado y resolucion de truncamiento de timestamps en UI operativa (tablet)
--   - incluye logo corporativo con enmascarado circular completo sin rebordes y assets PWA actualizados
-- Elimina cualquier otro perfil del esquema publico.
  EXECUTE format(
    'DELETE FROM public.profiles WHERE id <> %L::uuid;',
    v_protected_user_id
  );

  -- Elimina usuarios del esquema auth, dejando solo el superadmin protegido.
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE format(
      'DELETE FROM auth.users WHERE id <> %L::uuid;',
      v_protected_user_id
    );
  END IF;

  -- Seguridad final: asegurar que el superadmin quede sin sucursal activa.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'active_branch_id'
  ) THEN
    UPDATE public.profiles
    SET active_branch_id = NULL
    WHERE id = v_protected_user_id;
  END IF;

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
END $$;

-- Reinicia secuencias legacy si existen.
ALTER SEQUENCE IF EXISTS public.orders_order_number_seq RESTART WITH 1;

COMMIT;

-- ============================================================
-- POST RESET ESPERADO
-- - 1 usuario: el superadmin protegido
-- - perfil de superadmin conservado con first_name/last_name/full_name legacy intactos
-- - 0 sucursales
-- - 0 referencias de mesas por sucursal
-- - 0 mesas internas
-- - 0 politicas de cancelacion/anulacion por categoria
-- - 0 categorias habilitadas para anulacion directa por mesero
-- - 0 configuraciones/asignaciones de despacho
-- - 0 usuarios habilitados por turno y 0 permisos operativos por turno
-- - 0 turnos abiertos y 0 fecha/hora de apertura visible en `Admin > Turno`
-- - 0 session locks de app en perfiles, incluida la sesion secundaria de Caja
-- - 0 auditoria de cierre de turno previa
-- - 0 templates de apertura de caja y 0 composiciones predefinidas por denominacion
-- - 0 nodos de menu/categorias/subcategorias/productos/modificadores
-- - 0 configuraciones de precios manuales por categoria
-- - 0 arbol menu mesa / 0 arbol menu para llevar / 0 arbol a granel
-- - 0 configuraciones de productos incluidos para a granel ni reglas de entrega por monto
-- - 0 productos frecuentes configurados (`extra_frequent_products` por contexto)
-- - 0 comensales en `clientes`, 0 campañas en `campanas_promocionales`, 0 predicciones ni permisos de promociones por turno
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos (incluye orden especial, Express, Extra con flujo caja-despacho manual y cierre `close_extra_order`, caja principal/secundaria con flags takeout/express, bloqueos de edicion In-Situ, solicitudes/anulaciones pendientes por item/orden, payloads `[PENDING_REQUEST]`, anulaciones de pago, movimientos entre Ã³rdenes y alertas de listo)
-- - 0 aperturas multi-cajero ni cash_shift_denoms por cashier_id
-- - 0 tarjetas operativas de Para Llevar / Orden Especial derivadas de ordenes reales; solo queda la tarjeta `+` UI-only al entrar al modulo
-- - 0 ordenes historicas `VOID_SUCCESSOR_ORDER` y 0 ordenes sucesoras `SUCCESSOR_OF_VOIDED_ORDER`
-- - 0 base transaccional para reimprimir reportes de caja por apertura ni consolidado por turno
-- - 0 posiciones visibles de cuentas por mesa ni snapshots historicos de nombre de mesa
-- - 0 borradores vacios residuales capaces de aparecer como ocupacion real de mesa
-- - 0 borradores no enviados residuales capaces de bloquear cierre de turno
-- - 0 metadatos de comprobantes en base de datos (incluye OCR/analisis); los archivos del bucket `payment-proofs` deben vaciarse aparte
--   - recomendado: `node .\scripts\empty-payment-proofs-bucket.mjs`
-- - modulos, roles y permisos base intactos
-- ============================================================

