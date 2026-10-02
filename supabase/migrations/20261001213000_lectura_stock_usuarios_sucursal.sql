-- Lectura de stock para usuarios operativos de la sucursal (solo SELECT).
-- Nevera: el usuario asignado a nevera (inventario_movimientos) debe ver las cantidades que ajusta.
-- Órdenes: quien trabaja en la sucursal activa necesita el stock de nevera y el flag Integra ventas
-- para ver el stock y bloquear productos en 0. Mismo criterio que menu_nodes (sucursal activa).

DROP POLICY IF EXISTS "Inventario select por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario select por sucursal"
ON public.inventario_productos
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal'::text, 'VIEW'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global'::text, 'VIEW'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  OR public.can_operate_inventario_movimientos(auth.uid(), sucursal_id)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'inventario_movimientos'::text, 'VIEW'::public.access_level)
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active_branch_id = inventario_productos.sucursal_id
  )
);

DROP POLICY IF EXISTS inventario_bodega_sucursal_select ON public.inventario_bodega_sucursal;
CREATE POLICY inventario_bodega_sucursal_select
ON public.inventario_bodega_sucursal
FOR SELECT
TO authenticated
USING (
  public.can_operate_bodega_general(auth.uid())
  OR public.can_operate_bodega_sucursal(auth.uid(), sucursal_id)
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active_branch_id = inventario_bodega_sucursal.sucursal_id
  )
);
