-- Permitir nueva orden en la misma mesa (+) cuando la orden origen ya esta PAID
-- (nueva cuenta / siguiente servicio). Se mantiene bloqueo solo para CANCELLED.

CREATE OR REPLACE FUNCTION public.create_additional_dine_in_order(
  p_source_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_order public.orders%ROWTYPE;
  v_new_order_id uuid;
  v_has_permission boolean := false;
  v_next_position integer := 1;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
BEGIN
  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden origen es obligatoria';
  END IF;

  SELECT o.*
  INTO v_source_order
  FROM public.orders o
  WHERE o.id = p_source_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden origen';
  END IF;

  IF v_source_order.order_type <> 'DINE_IN'
    OR v_source_order.table_id IS NULL
    OR COALESCE(v_source_order.is_special, false)
  THEN
    RAISE EXCEPTION 'Solo puedes crear ordenes adicionales desde una orden de mesa activa';
  END IF;

  IF v_source_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden origen ya no admite nuevas ordenes hermanas';
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
  WHERE cs.branch_id = v_source_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_source_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
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
    RAISE EXCEPTION 'No tienes permisos para crear una nueva orden en esta mesa';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_source_order.table_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  ) THEN
    RAISE EXCEPTION 'Todas las ordenes activas de la mesa deben tener al menos un item antes de crear otra';
  END IF;

  v_next_position := public.next_table_order_position(v_source_order.table_id);

  INSERT INTO public.orders (
    branch_id,
    table_id,
    table_order_position,
    order_type,
    menu_scope,
    status,
    is_special,
    created_by
  )
  VALUES (
    v_source_order.branch_id,
    v_source_order.table_id,
    v_next_position,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    false,
    auth.uid()
  )
  RETURNING id INTO v_new_order_id;

  RETURN v_new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_additional_dine_in_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_additional_dine_in_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
