-- Orden especial para llevar: se crea ya marcada como especial dentro del RPC.
-- Mismas reglas de permiso que antes; solo agrega p_is_special.

DROP FUNCTION IF EXISTS public.create_takeout_order(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_takeout_order(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.create_takeout_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_is_special boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shift_id uuid;
  v_order_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_is_special boolean := COALESCE(p_is_special, false);
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'created_by es obligatorio';
  END IF;

  IF v_actor_id IS NULL OR v_actor_id <> p_created_by THEN
    RAISE EXCEPTION 'Usuario no autenticado o inconsistente';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
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
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, p_branch_id)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para abrir ordenes para llevar en este turno.';
  END IF;

  INSERT INTO public.orders (
    branch_id,
    order_type,
    menu_scope,
    status,
    is_tray_order,
    is_special,
    special_marked_at,
    special_marked_by,
    table_name_snapshot,
    created_by
  )
  VALUES (
    p_branch_id,
    'TAKEOUT',
    'TAKEOUT',
    'DRAFT',
    false,
    v_is_special,
    CASE WHEN v_is_special THEN now() ELSE NULL END,
    CASE WHEN v_is_special THEN v_actor_id ELSE NULL END,
    CASE WHEN v_is_special THEN 'Para llevar' ELSE NULL END,
    v_actor_id
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_takeout_order(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_takeout_order(uuid, uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
