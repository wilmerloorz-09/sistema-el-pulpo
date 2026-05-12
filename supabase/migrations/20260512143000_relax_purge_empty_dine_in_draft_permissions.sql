-- Ampliar quien puede purgar un borrador de mesa vacio al salir (VIEW mesas/ordenes en la sucursal).

CREATE OR REPLACE FUNCTION public.purge_empty_dine_in_draft_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_id uuid;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_shift_gate_ok boolean := false;
  v_creator_empty boolean := false;
  v_branch_view_ok boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.order_type <> 'DINE_IN' OR v_order.table_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_order.is_special, false) OR COALESCE(v_order.is_tray_order, false) THEN
    RETURN NULL;
  END IF;

  IF v_order.status <> 'DRAFT'
    OR v_order.sent_to_kitchen_at IS NOT NULL
    OR v_order.ready_at IS NOT NULL
    OR v_order.dispatched_at IS NOT NULL
  THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = p_order_id LIMIT 1) THEN
    RETURN NULL;
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

  v_has_operate_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  v_shift_gate_ok := (
    v_shift_id IS NOT NULL
    AND COALESCE(v_user_enabled, false) IS TRUE
    AND (
      COALESCE(v_can_serve_tables, false) IS TRUE
      OR COALESCE(v_can_access_orders, false) IS TRUE
      OR COALESCE(v_is_supervisor, false) IS TRUE
    )
  );

  v_creator_empty := (
    auth.uid() IS NOT NULL
    AND v_order.created_by IS NOT DISTINCT FROM auth.uid()
  );

  v_branch_view_ok := (
    public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'VIEW'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'VIEW'::public.access_level)
  );

  IF NOT (
    v_has_operate_permission
    OR v_shift_gate_ok
    OR v_creator_empty
    OR v_branch_view_ok
  ) THEN
    RETURN NULL;
  END IF;

  v_table_id := v_order.table_id;

  DELETE FROM public.order_item_modifiers oim
  USING public.order_items oi
  WHERE oi.id = oim.order_item_id
    AND oi.order_id = p_order_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_table_id);

  RETURN v_table_id;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_empty_dine_in_draft_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_empty_dine_in_draft_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
