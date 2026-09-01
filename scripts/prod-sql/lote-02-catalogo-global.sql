-- lote-02-catalogo-global
-- Ejecutar en Supabase SQL Editor (produccion)
-- Fecha: 2026-08-30

-- ===== 20260824200000_catalogo_global_productos_piloto.sql =====
-- CatÃ¡logo global de productos (piloto aislado a sucursales con usa_catalogo_global = true).
-- El resto de sucursales sigue con products + legacy_product_id + inventario_productos sin cambios de flujo.

-- 1) Flag por sucursal
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS usa_catalogo_global boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.usa_catalogo_global IS
  'Si true, Admin/POS de esa sucursal usan productos_globales + producto_sucursal. Si false, flujo legacy.';

UPDATE public.branches
SET usa_catalogo_global = true
WHERE id = 'd6074413-8632-4984-9b16-2aa872629307'
  AND name = 'El Pulpo 4 (Prueba)';

-- 2) Tabla global
CREATE TABLE IF NOT EXISTS public.productos_globales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_principal text NOT NULL,
  nombre_qr_default text NULL,
  precio_default numeric(12, 2) NOT NULL DEFAULT 0
    CONSTRAINT productos_globales_precio_default_chk CHECK (precio_default >= 0),
  price_mode public.price_mode NOT NULL DEFAULT 'FIXED',
  descripcion_default text NULL,
  imagen_default_url text NULL,
  tipo_producto public.tipo_producto NOT NULL DEFAULT 'COMPRADO',
  force_servir_default boolean NOT NULL DEFAULT false,
  codigo text NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT productos_globales_nombre_principal_uniq UNIQUE (nombre_principal),
  CONSTRAINT productos_globales_codigo_uniq UNIQUE (codigo)
);

COMMENT ON TABLE public.productos_globales IS
  'CatÃ¡logo Ãºnico del sistema. Defaults para menÃº; el precio/nombre finales viven en menu_nodes.';

CREATE INDEX IF NOT EXISTS idx_productos_globales_activo
  ON public.productos_globales (activo);

CREATE INDEX IF NOT EXISTS idx_productos_globales_nombre
  ON public.productos_globales (nombre_principal);

-- 3) Producto Ã— sucursal (+ inventario operativo)
CREATE TABLE IF NOT EXISTS public.producto_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  producto_global_id uuid NOT NULL REFERENCES public.productos_globales(id) ON DELETE RESTRICT,
  cantidad_disponible numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT producto_sucursal_cantidad_chk CHECK (cantidad_disponible >= 0),
  integra_con_ventas boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_sucursal_unico UNIQUE (sucursal_id, producto_global_id)
);

COMMENT ON TABLE public.producto_sucursal IS
  'AsignaciÃ³n del producto global a una sucursal + stock e integra_con_ventas.';

CREATE INDEX IF NOT EXISTS idx_producto_sucursal_sucursal
  ON public.producto_sucursal (sucursal_id);

CREATE INDEX IF NOT EXISTS idx_producto_sucursal_producto
  ON public.producto_sucursal (producto_global_id);

-- 4) Enlace en menÃº
ALTER TABLE public.menu_nodes
  ADD COLUMN IF NOT EXISTS producto_global_id uuid NULL
    REFERENCES public.productos_globales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_menu_nodes_producto_global
  ON public.menu_nodes (producto_global_id)
  WHERE producto_global_id IS NOT NULL;

COMMENT ON COLUMN public.menu_nodes.producto_global_id IS
  'FK al catÃ¡logo global (piloto). En sucursales legacy permanece NULL.';

-- 5) SubcategorÃ­a puente para fila en products (mismo id = producto global)
--    Necesaria porque order_items / inventario legacy siguen referenciando products.id
DO $$
DECLARE
  v_branch uuid := 'd6074413-8632-4984-9b16-2aa872629307';
  v_cat uuid;
  v_sub uuid;
BEGIN
  SELECT id INTO v_cat
  FROM public.categories
  WHERE branch_id = v_branch
    AND description = 'Sistema Â· CatÃ¡logo global'
  LIMIT 1;

  IF v_cat IS NULL THEN
    v_cat := gen_random_uuid();
    INSERT INTO public.categories (id, branch_id, description, display_order, is_active)
    VALUES (v_cat, v_branch, 'Sistema Â· CatÃ¡logo global', 9999, true);
  END IF;

  SELECT id INTO v_sub
  FROM public.subcategories
  WHERE category_id = v_cat
    AND description = 'CatÃ¡logo global'
  LIMIT 1;

  IF v_sub IS NULL THEN
    v_sub := gen_random_uuid();
    INSERT INTO public.subcategories (id, category_id, description, display_order, is_active)
    VALUES (v_sub, v_cat, 'CatÃ¡logo global', 1, true);
  END IF;

  PERFORM set_config('app.catalogo_global_subcategory_id', v_sub::text, false);
END $$;

CREATE OR REPLACE FUNCTION public.catalogo_global_bridge_subcategory_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid := 'd6074413-8632-4984-9b16-2aa872629307';
  v_sub uuid;
BEGIN
  SELECT s.id INTO v_sub
  FROM public.subcategories s
  JOIN public.categories c ON c.id = s.category_id
  WHERE c.branch_id = v_branch
    AND c.description = 'Sistema Â· CatÃ¡logo global'
    AND s.description = 'CatÃ¡logo global'
  LIMIT 1;
  RETURN v_sub;
END;
$$;

-- 6) Al crear/actualizar producto global â†’ espejo en products (mismo UUID) para POS/inventario legacy
CREATE OR REPLACE FUNCTION public.trg_productos_globales_mirror_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub uuid;
  v_display_order integer;
BEGIN
  v_sub := public.catalogo_global_bridge_subcategory_id();
  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'No existe subcategoria puente CatÃ¡logo global';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(display_order), 0) + 1
    INTO v_display_order
    FROM public.products
    WHERE subcategory_id = v_sub;
  ELSE
    SELECT display_order
    INTO v_display_order
    FROM public.products
    WHERE id = NEW.id;

    IF v_display_order IS NULL THEN
      SELECT COALESCE(MAX(display_order), 0) + 1
      INTO v_display_order
      FROM public.products
      WHERE subcategory_id = v_sub;
    END IF;
  END IF;

  INSERT INTO public.products (
    id,
    subcategory_id,
    description,
    unit_price,
    price_mode,
    display_order,
    is_active,
    tipo_producto,
    force_servir_module
  )
  VALUES (
    NEW.id,
    v_sub,
    NEW.nombre_principal,
    NEW.precio_default,
    NEW.price_mode,
    v_display_order,
    NEW.activo,
    NEW.tipo_producto,
    NEW.force_servir_default
  )
  ON CONFLICT (id) DO UPDATE
  SET
    description = EXCLUDED.description,
    unit_price = EXCLUDED.unit_price,
    price_mode = EXCLUDED.price_mode,
    is_active = EXCLUDED.is_active,
    tipo_producto = EXCLUDED.tipo_producto,
    force_servir_module = EXCLUDED.force_servir_module,
    updated_at = now();

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_globales_mirror_products ON public.productos_globales;
CREATE TRIGGER trg_productos_globales_mirror_products
BEFORE INSERT OR UPDATE ON public.productos_globales
FOR EACH ROW
EXECUTE FUNCTION public.trg_productos_globales_mirror_products();

-- 7) producto_sucursal â†” inventario_productos (para que submit/Ordenes no cambien)
CREATE OR REPLACE FUNCTION public.trg_producto_sucursal_sync_inventario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  INSERT INTO public.inventario_productos (
    producto_id,
    sucursal_id,
    cantidad_disponible,
    integra_con_ventas,
    activo
  )
  VALUES (
    NEW.producto_global_id,
    NEW.sucursal_id,
    NEW.cantidad_disponible,
    NEW.integra_con_ventas,
    NEW.activo
  )
  ON CONFLICT (producto_id, sucursal_id) DO UPDATE
  SET
    cantidad_disponible = EXCLUDED.cantidad_disponible,
    integra_con_ventas = EXCLUDED.integra_con_ventas,
    activo = EXCLUDED.activo,
    actualizado_en = now();

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producto_sucursal_sync_inventario ON public.producto_sucursal;
CREATE TRIGGER trg_producto_sucursal_sync_inventario
BEFORE INSERT OR UPDATE ON public.producto_sucursal
FOR EACH ROW
EXECUTE FUNCTION public.trg_producto_sucursal_sync_inventario();

-- Si movimientos/admin tocan inventario_productos, reflejar en producto_sucursal (solo si existe asignaciÃ³n)
CREATE OR REPLACE FUNCTION public.trg_inventario_productos_sync_producto_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.producto_sucursal ps
  SET
    cantidad_disponible = NEW.cantidad_disponible,
    integra_con_ventas = NEW.integra_con_ventas,
    activo = NEW.activo,
    updated_at = now()
  WHERE ps.sucursal_id = NEW.sucursal_id
    AND ps.producto_global_id = NEW.producto_id
    AND (
      ps.cantidad_disponible IS DISTINCT FROM NEW.cantidad_disponible
      OR ps.integra_con_ventas IS DISTINCT FROM NEW.integra_con_ventas
      OR ps.activo IS DISTINCT FROM NEW.activo
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_productos_sync_producto_sucursal ON public.inventario_productos;
CREATE TRIGGER trg_inventario_productos_sync_producto_sucursal
AFTER INSERT OR UPDATE OF cantidad_disponible, integra_con_ventas, activo
ON public.inventario_productos
FOR EACH ROW
EXECUTE FUNCTION public.trg_inventario_productos_sync_producto_sucursal();

-- 8) RLS
ALTER TABLE public.productos_globales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS productos_globales_select ON public.productos_globales;
CREATE POLICY productos_globales_select ON public.productos_globales
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS productos_globales_write ON public.productos_globales;
CREATE POLICY productos_globales_write ON public.productos_globales
FOR ALL TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS producto_sucursal_select ON public.producto_sucursal;
CREATE POLICY producto_sucursal_select ON public.producto_sucursal
FOR SELECT TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'VIEW'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'VIEW'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
);

DROP POLICY IF EXISTS producto_sucursal_write ON public.producto_sucursal;
CREATE POLICY producto_sucursal_write ON public.producto_sucursal
FOR ALL TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'MANAGE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'MANAGE'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
)
WITH CHECK (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'MANAGE'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'MANAGE'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
);

-- 9) Exponer flag en access context (sin cambiar lÃ³gica de otras sucursales)
CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_branch uuid;
  v_branches jsonb := '[]'::jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_shift_permissions jsonb := '{}'::jsonb;
  v_shift_branch uuid;
  v_has_shift_at_current boolean;
  v_is_global_admin boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_is_global_admin := public.is_global_admin(v_user_id);

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT cs.branch_id INTO v_shift_branch
  FROM public.cash_shifts cs
  JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
  WHERE cs.status = 'OPEN'
    AND csu.user_id = v_user_id
    AND csu.is_enabled = true
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  v_has_shift_at_current := EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
    WHERE cs.branch_id = v_active_branch
      AND cs.status = 'OPEN'
      AND csu.user_id = v_user_id
      AND csu.is_enabled = true
  );

  IF NOT v_is_global_admin
     AND v_shift_branch IS NOT NULL
     AND NOT v_has_shift_at_current
  THEN
    v_active_branch := v_shift_branch;
    UPDATE public.profiles
    SET active_branch_id = v_active_branch, updated_at = now()
    WHERE id = v_user_id;
  END IF;

  IF v_is_global_admin THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    WHERE b.is_active = true;
  ELSE
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    ),
    ranked AS (
      SELECT branch_id,
        row_number() OVER (ORDER BY priority, branch_id) AS rn
      FROM accessible_branch_ids
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    JOIN ranked r ON r.branch_id = b.id
    WHERE b.is_active = true;
  END IF;

  IF v_active_branch IS NULL
     OR NOT EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id = v_active_branch
          AND b.is_active = true
     )
  THEN
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    WHERE b.is_active = true
    ORDER BY b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(module_code, access_level::text), '{}'::jsonb)
    INTO v_permissions
    FROM public.v_user_effective_permissions
    WHERE user_id = v_user_id
      AND branch_id = v_active_branch;

    IF NOT v_is_global_admin THEN
      SELECT COALESCE(jsonb_strip_nulls(jsonb_build_object(
        'mesas', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'ordenes', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.can_access_orders, false) OR COALESCE(csu.can_edit_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_total', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_mesa', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_para_llevar', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'caja', CASE WHEN bool_or(COALESCE(csu.can_use_caja, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END
      )), '{}'::jsonb)
      INTO v_shift_permissions
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.branch_id = v_active_branch
        AND cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true;

      v_permissions := COALESCE(v_shift_permissions, '{}'::jsonb) || COALESCE(v_permissions, '{}'::jsonb);
    END IF;

    IF public.can_operate_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'OPERATE');
    ELSIF public.can_view_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'VIEW');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', v_is_global_admin
  );
END;
$$;

NOTIFY pgrst, 'reload schema';



-- ===== 20260824210000_fix_productos_globales_display_order.sql =====
-- Fix: el espejo a products no puede usar siempre display_order=1
-- (uq_products_subcategory_display_order bloqueaba el 2.Âº producto global).

CREATE OR REPLACE FUNCTION public.trg_productos_globales_mirror_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub uuid;
  v_display_order integer;
BEGIN
  v_sub := public.catalogo_global_bridge_subcategory_id();
  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'No existe subcategoria puente CatÃ¡logo global';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(display_order), 0) + 1
    INTO v_display_order
    FROM public.products
    WHERE subcategory_id = v_sub;
  ELSE
    SELECT display_order
    INTO v_display_order
    FROM public.products
    WHERE id = NEW.id;

    IF v_display_order IS NULL THEN
      SELECT COALESCE(MAX(display_order), 0) + 1
      INTO v_display_order
      FROM public.products
      WHERE subcategory_id = v_sub;
    END IF;
  END IF;

  INSERT INTO public.products (
    id,
    subcategory_id,
    description,
    unit_price,
    price_mode,
    display_order,
    is_active,
    tipo_producto,
    force_servir_module
  )
  VALUES (
    NEW.id,
    v_sub,
    NEW.nombre_principal,
    NEW.precio_default,
    NEW.price_mode,
    v_display_order,
    NEW.activo,
    NEW.tipo_producto,
    NEW.force_servir_default
  )
  ON CONFLICT (id) DO UPDATE
  SET
    description = EXCLUDED.description,
    unit_price = EXCLUDED.unit_price,
    price_mode = EXCLUDED.price_mode,
    is_active = EXCLUDED.is_active,
    tipo_producto = EXCLUDED.tipo_producto,
    force_servir_module = EXCLUDED.force_servir_module,
    updated_at = now();

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';



-- ===== 20260824220000_storage_productos_globales_images.sql =====
-- ImÃ¡genes de productos globales: path global-products/{producto_id}/...
-- Las policies actuales de menu-node-images exigen que la 1Âª carpeta sea UUID de sucursal.

DROP POLICY IF EXISTS "Global admins can upload global product images" ON storage.objects;
CREATE POLICY "Global admins can upload global product images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Global admins can update global product images" ON storage.objects;
CREATE POLICY "Global admins can update global product images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
)
WITH CHECK (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Global admins can delete global product images" ON storage.objects;
CREATE POLICY "Global admins can delete global product images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);



-- ===== 20260824230000_unique_menu_producto_global_por_padre.sql =====
-- Un mismo producto global no puede repetirse bajo el mismo padre (misma sucursal/scope).
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_nodes_parent_producto_global
  ON public.menu_nodes (branch_id, menu_scope, parent_id, producto_global_id)
  WHERE node_type = 'product'
    AND producto_global_id IS NOT NULL
    AND parent_id IS NOT NULL;



-- ===== 20260824240000_unique_menu_producto_global_por_scope.sql =====
-- Un producto global solo una vez por menÃº (branch + scope).
-- Puede repetirse en otro scope (TABLE vs TAKEOUT, etc.).

DROP INDEX IF EXISTS public.uq_menu_nodes_parent_producto_global;

CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_nodes_scope_producto_global
  ON public.menu_nodes (branch_id, menu_scope, producto_global_id)
  WHERE node_type = 'product'
    AND producto_global_id IS NOT NULL;



-- ===== 20260824250000_productos_globales_categoria.sql =====
-- CategorÃ­a de negocio del producto global (no es el Ã¡rbol de menÃº por sucursal).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'categoria_producto_global'
  ) THEN
    CREATE TYPE public.categoria_producto_global AS ENUM ('PLATOS', 'BEBIDAS', 'VARIOS');
  END IF;
END $$;

ALTER TABLE public.productos_globales
  ADD COLUMN IF NOT EXISTS categoria public.categoria_producto_global;

UPDATE public.productos_globales
SET categoria = 'PLATOS'::public.categoria_producto_global
WHERE categoria IS NULL;

ALTER TABLE public.productos_globales
  ALTER COLUMN categoria SET DEFAULT 'PLATOS'::public.categoria_producto_global;

ALTER TABLE public.productos_globales
  ALTER COLUMN categoria SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_productos_globales_categoria
  ON public.productos_globales (categoria);

COMMENT ON COLUMN public.productos_globales.categoria IS
  'ClasificaciÃ³n del catÃ¡logo global: PLATOS, BEBIDAS o VARIOS.';




