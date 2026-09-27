-- El límite de stock vive en Nevera (inventario_productos.limite_stock).

ALTER TABLE public.inventario_bodega_sucursal
  DROP CONSTRAINT IF EXISTS inventario_bodega_sucursal_limite_stock_chk;

ALTER TABLE public.inventario_bodega_sucursal
  DROP COLUMN IF EXISTS limite_stock;

NOTIFY pgrst, 'reload schema';
