-- ============================================================
-- RESET TOTAL DEL SISTEMA POS PARA PRUEBAS DESDE CERO (MODO DESTRUCTIVO)
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina datos operativos: ordenes, items, pagos, caja, cocina, despacho, mesas
--   - incluye ordenes normales y ordenes especiales (`is_special`, `special_total_manual`)
--   - incluye solicitudes, metadatos y archivos de comprobantes de transferencia
-- - Elimina historial de aperturas/anulaciones/movimientos de caja y usuarios habilitados por turno
--   - incluye permisos operativos por turno para Mesas, Ordenes, Despacho, Productos, Caja y autorizacion de anulacion
--   - incluye auditoria de cierre de turno (closed_by, closed_from_device, closed_from_user_agent)
-- - Elimina catalogos operativos: arbol menu, categorias, subcategorias, productos, modificadores
--   - incluye todos los alcances de menu_nodes: `TABLE`, `TAKEOUT` y `BULK`
--   - incluye imagenes/referencias visuales de productos en `menu_nodes.image_url`
--   - incluye configuraciones de categoria como `manual_price_enabled`
--   - incluye configuracion de productos incluidos para `A granel` y sus reglas de entrega por monto
-- - Elimina sucursales y configuraciones asociadas:
--   - incluye referencia de mesas por sucursal
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
-- - SI YA USAS ARBOL MENU MESA / PARA LLEVAR / A GRANEL, TODOS QUEDAN VACIOS
-- - LAS RPCS/FUNCIONES PERMANECEN INTACTAS, INCLUIDAS LAS DE ALERTA DE MESERO (emit_order_ready_alert, get_mesero_ready_alerts, order_has_dispatch_after)
-- - TAMBIEN QUEDA INTACTA LA LOGICA DE ANULACION:
--   - mesero: anulacion directa solo en categorias habilitadas y mientras no toque cantidades ya despachadas
--   - items/ordenes despachados: requieren autorizacion si quien opera no tiene autoridad directa
--   - administrador, supervisor y usuario con can_authorize_order_cancel siguen pudiendo resolver directo
-- - LAS REGLAS DE HERENCIA DE PERMISOS POR TURNO SIGUEN EXISTIENDO EN LA ESTRUCTURA:
--   - Mesas incluye acceso a Ordenes
--   - Despacho incluye acceso total a Productos
--   - Ordenes y Productos tambien pueden habilitarse por separado
-- - TAMBIEN PERMANECEN INTACTAS LAS RPCS de ORDEN ESPECIAL Y EL SISTEMA de TICKETS (80mm)
-- - LOS AJUSTES RECIENTES de NAVEGACION (sidebar, bottom nav, tabs de Caja por URL) Y RENDIMIENTO SON SOLO FRONTEND Y NO SE VEN AFECTADOS POR ESTE RESET
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_protected_count integer;
  v_protected_user_id uuid;
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
END $$;

-- Reinicia secuencias legacy si existen.
ALTER SEQUENCE IF EXISTS public.orders_order_number_seq RESTART WITH 1;

COMMIT;

-- ============================================================
-- POST RESET ESPERADO
-- - 1 usuario: el superadmin protegido
-- - 0 sucursales
-- - 0 referencias de mesas por sucursal
-- - 0 mesas internas
-- - 0 politicas de cancelacion/anulacion por categoria
-- - 0 categorias habilitadas para anulacion directa por mesero
-- - 0 configuraciones/asignaciones de despacho
-- - 0 usuarios habilitados por turno y 0 permisos operativos por turno
-- - 0 auditoria de cierre de turno previa
-- - 0 nodos de menu/categorias/subcategorias/productos/modificadores
-- - 0 configuraciones de precios manuales por categoria
-- - 0 arbol menu mesa / 0 arbol menu para llevar / 0 arbol a granel
-- - 0 configuraciones de productos incluidos para a granel ni reglas de entrega por monto
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos (incluye orden especial, solicitudes/anulaciones pendientes y alertas de listo)
-- - 0 metadatos de comprobantes en base de datos; los archivos del bucket `payment-proofs` deben vaciarse aparte
--   - recomendado: `node .\scripts\empty-payment-proofs-bucket.mjs`
-- - modulos, roles y permisos base intactos
-- ============================================================


