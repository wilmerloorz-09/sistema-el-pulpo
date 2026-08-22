-- Etapa 1: Inventario operativo por sucursal
-- - products.tipo_producto (COMPRADO | PREPARADO)
-- - tabla inventario_productos
-- - RLS por sucursal
-- - backfill seguro (solo productos con sucursal clara vía categorías)
-- NO modifica is_active de products/menu_nodes ni lógica de venta.

-- 1) Enum + campo en products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'tipo_producto'
  ) THEN
    CREATE TYPE public.tipo_producto AS ENUM ('COMPRADO', 'PREPARADO');
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tipo_producto public.tipo_producto;

UPDATE public.products
SET tipo_producto = 'COMPRADO'::public.tipo_producto
WHERE tipo_producto IS NULL;

ALTER TABLE public.products
  ALTER COLUMN tipo_producto SET DEFAULT 'COMPRADO'::public.tipo_producto;

ALTER TABLE public.products
  ALTER COLUMN tipo_producto SET NOT NULL;

COMMENT ON COLUMN public.products.tipo_producto IS
  'COMPRADO = abastecido por compra; PREPARADO = elaborado en cocina. No implica control de stock automático en Etapa 1.';

-- 2) Tabla inventario_productos
CREATE TABLE IF NOT EXISTS public.inventario_productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cantidad_disponible numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT inventario_productos_cantidad_disponible_chk CHECK (cantidad_disponible >= 0),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventario_productos_producto_sucursal_unico UNIQUE (producto_id, sucursal_id)
);

COMMENT ON TABLE public.inventario_productos IS
  'Cantidad disponible por producto y sucursal. Independiente de products.is_active / menu_nodes.is_active.';
COMMENT ON COLUMN public.inventario_productos.cantidad_disponible IS
  'Stock operativo actual. 0 = AGOTADO en el módulo Inventario; no desactiva el catálogo.';
COMMENT ON COLUMN public.inventario_productos.activo IS
  'Registro de inventario activo (no confundir con producto activo en menú).';

CREATE INDEX IF NOT EXISTS idx_inventario_productos_sucursal
  ON public.inventario_productos (sucursal_id);

CREATE INDEX IF NOT EXISTS idx_inventario_productos_sucursal_activo
  ON public.inventario_productos (sucursal_id, activo);

CREATE INDEX IF NOT EXISTS idx_inventario_productos_sucursal_cantidad
  ON public.inventario_productos (sucursal_id, cantidad_disponible);

CREATE OR REPLACE FUNCTION public.inventario_productos_set_actualizado_en()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_productos_set_actualizado_en ON public.inventario_productos;
CREATE TRIGGER trg_inventario_productos_set_actualizado_en
BEFORE UPDATE ON public.inventario_productos
FOR EACH ROW
EXECUTE FUNCTION public.inventario_productos_set_actualizado_en();

-- 3) RLS
ALTER TABLE public.inventario_productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventario select por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario select por sucursal"
ON public.inventario_productos
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'VIEW'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'VIEW'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
);

DROP POLICY IF EXISTS "Inventario insert por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario insert por sucursal"
ON public.inventario_productos
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), sucursal_id));

DROP POLICY IF EXISTS "Inventario update por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario update por sucursal"
ON public.inventario_productos
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), sucursal_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), sucursal_id));

DROP POLICY IF EXISTS "Inventario delete por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario delete por sucursal"
ON public.inventario_productos
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), sucursal_id));

-- 4) Backfill: solo productos con sucursal clara (categories.branch_id)
-- No inventar sucursal para productos huérfanos / sin categoría.
INSERT INTO public.inventario_productos (
  producto_id,
  sucursal_id,
  cantidad_disponible,
  activo
)
SELECT
  p.id,
  c.branch_id,
  0,
  true
FROM public.products p
JOIN public.subcategories s ON s.id = p.subcategory_id
JOIN public.categories c ON c.id = s.category_id
WHERE c.branch_id IS NOT NULL
ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

DO $$
DECLARE
  v_total_products integer;
  v_with_branch integer;
  v_without_branch integer;
  v_inventory_rows integer;
BEGIN
  SELECT COUNT(*) INTO v_total_products FROM public.products;
  SELECT COUNT(*) INTO v_with_branch
  FROM public.products p
  JOIN public.subcategories s ON s.id = p.subcategory_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE c.branch_id IS NOT NULL;
  v_without_branch := v_total_products - v_with_branch;
  SELECT COUNT(*) INTO v_inventory_rows FROM public.inventario_productos;

  RAISE NOTICE
    'Inventario Etapa 1 backfill: products=% con_sucursal=% sin_sucursal_clara=% filas_inventario=%',
    v_total_products, v_with_branch, v_without_branch, v_inventory_rows;
END $$;
