-- =============================================================================
-- Corrección: chifle por encebollado aplica en TODAS las sucursales (incluida P1).
-- Único requisito: Chifle con integra_con_ventas activo (lo valida
-- inventario_movimiento_venta_internal / inventario_debe_controlar_venta).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.inventario_aplica_chifle_por_encebollado(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_sucursal_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.inventario_aplica_chifle_por_encebollado(uuid) IS
  'Indica si la sucursal puede evaluar el acompañamiento chifle/encebollado. El descuento real solo ocurre si Chifle tiene integra_con_ventas.';
