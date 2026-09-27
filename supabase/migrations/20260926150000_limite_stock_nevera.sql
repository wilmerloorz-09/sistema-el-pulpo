-- Límite de stock por producto/sucursal en Nevera.
-- En la orden, el stock de nevera menor a este límite se muestra en rojo.

ALTER TABLE public.inventario_productos
  ADD COLUMN IF NOT EXISTS limite_stock numeric(14, 3) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventario_productos_limite_stock_chk'
  ) THEN
    ALTER TABLE public.inventario_productos
      ADD CONSTRAINT inventario_productos_limite_stock_chk CHECK (limite_stock >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.inventario_productos.limite_stock IS
  'Por sucursal. En órdenes, stock de nevera menor a este valor se muestra en rojo.';

UPDATE public.inventario_productos ip
SET limite_stock = ibs.limite_stock
FROM public.inventario_bodega_sucursal ibs
WHERE ibs.producto_global_id = ip.producto_id
  AND ibs.sucursal_id = ip.sucursal_id
  AND ibs.limite_stock > 0
  AND ip.limite_stock = 0;

NOTIFY pgrst, 'reload schema';
