CREATE OR REPLACE FUNCTION public.delete_dine_in_table_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next_order_id uuid;
  v_has_permission boolean := false;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden es obligatoria';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Solo puedes eliminar ordenes activas de mesa';
  END IF;

  IF v_order.status <> 'DRAFT'
    OR v_order.sent_to_kitchen_at IS NOT NULL
    OR v_order.ready_at IS NOT NULL
    OR v_order.dispatched_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Solo puedes eliminar una orden borrador que aun no haya sido enviada';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_shift_id,
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = auth.uid()
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    v_shift_id IS NULL
    OR COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar esta orden';
  END IF;

  DELETE FROM public.order_item_modifiers oim
  USING public.order_items oi
  WHERE oi.id = oim.order_item_id
    AND oi.order_id = p_order_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_order.table_id);

  SELECT o.id
  INTO v_next_order_id
  FROM public.orders o
  WHERE o.table_id = v_order.table_id
    AND o.order_type = 'DINE_IN'
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  ORDER BY
    COALESCE(o.table_order_position, 2147483647),
    COALESCE(o.order_number, 2147483647),
    o.id
  LIMIT 1;

  RETURN v_next_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_dine_in_table_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_dine_in_table_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
