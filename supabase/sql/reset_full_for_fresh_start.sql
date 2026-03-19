-- ============================================================
-- RESET TOTAL DEL SISTEMA POS PARA PRUEBAS DESDE CERO (MODO DESTRUCTIVO)
-- Archivo pensado para ejecutarse manualmente en Supabase SQL Editor.
--
-- QUE HACE:
-- - Elimina datos operativos: ordenes, items, pagos, caja, cocina, despacho, mesas
-- - Elimina historial de aperturas/anulaciones/movimientos de caja y usuarios habilitados por turno
-- - Elimina catalogos operativos: arbol menu, categorias, subcategorias, productos, modificadores
-- - Elimina sucursales y configuraciones asociadas, incluida la referencia de mesas por sucursal
-- - Elimina politicas por sucursal, como cancelacion/anulacion directa por categoria
-- - Elimina usuarios no protegidos
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
-- - 0 nodos de menu/categorias/subcategorias/productos/modificadores
-- - 0 ordenes/pagos/caja/aperturas/movimientos/notificaciones/eventos
-- - modulos, roles y permisos base intactos
-- ============================================================

