-- Límite de stock por producto/sucursal (Productos Sucursal).
-- En la orden, el stock de nevera menor a este límite se muestra en rojo.

ALTER TABLE public.inventario_bodega_sucursal
  ADD COLUMN IF NOT EXISTS limite_stock numeric(14, 3) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventario_bodega_sucursal_limite_stock_chk'
  ) THEN
    ALTER TABLE public.inventario_bodega_sucursal
      ADD CONSTRAINT inventario_bodega_sucursal_limite_stock_chk CHECK (limite_stock >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.inventario_bodega_sucursal.limite_stock IS
  'Por sucursal. En órdenes, stock de nevera menor a este valor se muestra en rojo.';

NOTIFY pgrst, 'reload schema';
