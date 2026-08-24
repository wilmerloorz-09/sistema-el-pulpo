-- Flag por sucursal: si el producto participa en validación/descuento de stock al vender.
-- Por defecto false (no integra) hasta activarlo explícitamente en Inventario → Productos.

ALTER TABLE public.inventario_productos
  ADD COLUMN IF NOT EXISTS integra_con_ventas boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventario_productos.integra_con_ventas IS
  'Por sucursal. true = Etapa ventas validará/descontará stock; false = ventas ignoran inventario.';
