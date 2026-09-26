-- Integra ventas: bandera por producto/sucursal en bodega sucursal.
-- Las ventas siguen descontando nevera, pero el flag se configura aquí.

ALTER TABLE public.inventario_bodega_sucursal
  ADD COLUMN IF NOT EXISTS integra_con_ventas boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventario_bodega_sucursal.integra_con_ventas IS
  'Por sucursal. true = ventas validan/descuentan stock de nevera; false = ventas ignoran inventario.';

-- Copiar flags ya configurados en nevera (mismo producto_id = producto_global_id).
UPDATE public.inventario_bodega_sucursal ibs
SET integra_con_ventas = ip.integra_con_ventas
FROM public.inventario_productos ip
WHERE ip.sucursal_id = ibs.sucursal_id
  AND ip.producto_id = ibs.producto_global_id
  AND ip.integra_con_ventas = true
  AND ibs.integra_con_ventas IS DISTINCT FROM true;

-- Crear fila de bodega sucursal (stock 0) si solo existía el flag en nevera
-- y el producto_id corresponde a un producto global.
INSERT INTO public.inventario_bodega_sucursal (
  producto_global_id,
  sucursal_id,
  cantidad_disponible,
  activo,
  integra_con_ventas
)
SELECT
  ip.producto_id,
  ip.sucursal_id,
  0,
  true,
  true
FROM public.inventario_productos ip
JOIN public.productos_globales pg ON pg.id = ip.producto_id
WHERE ip.integra_con_ventas = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.producto_global_id = ip.producto_id
      AND ibs.sucursal_id = ip.sucursal_id
  )
ON CONFLICT (producto_global_id, sucursal_id) DO UPDATE
SET integra_con_ventas = EXCLUDED.integra_con_ventas;

-- Las ventas consultan el flag en bodega sucursal.
CREATE OR REPLACE FUNCTION public.inventario_debe_controlar_venta(
  p_sucursal_id uuid,
  p_producto_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_sucursal_id IS NOT NULL
    AND p_producto_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.inventario_bodega_sucursal ibs
      WHERE ibs.sucursal_id = p_sucursal_id
        AND ibs.producto_global_id = p_producto_id
        AND ibs.integra_con_ventas = true
        AND ibs.activo = true
    );
$$;

COMMENT ON FUNCTION public.inventario_debe_controlar_venta(uuid, uuid) IS
  'true si bodega sucursal tiene integra_con_ventas para ese producto (descuenta nevera al vender).';

NOTIFY pgrst, 'reload schema';
