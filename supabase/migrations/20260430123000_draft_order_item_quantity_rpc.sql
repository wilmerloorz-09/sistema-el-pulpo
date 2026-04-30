CREATE OR REPLACE FUNCTION public.set_draft_order_item_quantity(
  p_item_id uuid,
  p_quantity integer,
  p_unit_price numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_effective_unit_price numeric;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
  END IF;

  IF v_item.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Solo se pueden modificar items borrador desde este flujo.';
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
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  IF p_quantity = 0 THEN
    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = p_item_id;

    DELETE FROM public.order_items
    WHERE id = p_item_id;

    RETURN;
  END IF;

  v_effective_unit_price := COALESCE(p_unit_price, v_item.unit_price);

  IF v_effective_unit_price IS NULL OR v_effective_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  UPDATE public.order_items
  SET quantity = p_quantity,
      unit_price = v_effective_unit_price,
      total = ((p_quantity * v_effective_unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
  WHERE id = p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) TO authenticated;
