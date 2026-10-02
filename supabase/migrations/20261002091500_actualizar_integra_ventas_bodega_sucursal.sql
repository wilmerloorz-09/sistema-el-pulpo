-- inventario_bodega_sucursal no tiene políticas de escritura: el flag Integra ventas
-- se guarda mediante esta función, con el mismo permiso que habilita el combo en pantalla.

CREATE OR REPLACE FUNCTION public.actualizar_integra_ventas_bodega_sucursal(
  p_producto_global_id uuid,
  p_sucursal_id uuid,
  p_integra_con_ventas boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_resultado boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_producto_global_id IS NULL OR p_sucursal_id IS NULL OR p_integra_con_ventas IS NULL THEN
    RAISE EXCEPTION 'Producto, sucursal e Integra ventas son obligatorios';
  END IF;

  IF NOT (
    public.is_global_admin(v_actor_id)
    OR public.can_manage_branch_admin(v_actor_id, p_sucursal_id)
    OR public.has_branch_permission(v_actor_id, p_sucursal_id, 'admin_sucursal'::text, 'MANAGE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_sucursal_id, 'admin_global'::text, 'MANAGE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar Integra ventas en esta sucursal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.productos_globales WHERE id = p_producto_global_id) THEN
    RAISE EXCEPTION 'El producto no existe en el catálogo global';
  END IF;

  INSERT INTO public.inventario_bodega_sucursal (
    producto_global_id,
    sucursal_id,
    cantidad_disponible,
    activo,
    integra_con_ventas
  )
  VALUES (p_producto_global_id, p_sucursal_id, 0, true, p_integra_con_ventas)
  ON CONFLICT (producto_global_id, sucursal_id) DO UPDATE
    SET integra_con_ventas = EXCLUDED.integra_con_ventas,
        actualizado_en = now()
  RETURNING integra_con_ventas INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_integra_ventas_bodega_sucursal(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_integra_ventas_bodega_sucursal(uuid, uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
