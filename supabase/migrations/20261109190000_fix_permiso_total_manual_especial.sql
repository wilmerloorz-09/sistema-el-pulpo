-- Alinea permiso de Total Manual con el de enviar a cocina:
-- admin / mesas|ordenes OPERATE / o usuario habilitado en turno abierto.

CREATE OR REPLACE FUNCTION public.actualizar_total_manual_especial(
  p_order_id uuid,
  p_special_total_manual numeric
)
RETURNS TABLE (
  order_id uuid,
  is_special boolean,
  special_total_manual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_total numeric;
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF p_special_total_manual IS NULL THEN
    RAISE EXCEPTION 'El total manual es obligatorio (puede ser 0)';
  END IF;

  IF p_special_total_manual < 0 THEN
    RAISE EXCEPTION 'El total manual no puede ser negativo';
  END IF;

  v_total := ROUND(p_special_total_manual, 2);

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo se puede definir total manual en ordenes especiales';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede editar el total de una orden cerrada';
  END IF;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para actualizar el total manual';
  END IF;

  UPDATE public.orders AS o
  SET
    special_total_manual = v_total,
    updated_at = now()
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT o.id, o.is_special, o.special_total_manual
  FROM public.orders AS o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_total_manual_especial(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_total_manual_especial(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
