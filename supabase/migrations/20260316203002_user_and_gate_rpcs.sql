-- Modify get_my_branch_shift_gate to return the roles too

DROP FUNCTION IF EXISTS public.list_shift_users_for_branch(uuid);
CREATE OR REPLACE FUNCTION public.list_shift_users_for_branch(
  p_branch_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  is_profile_active boolean,
  is_enabled boolean,
  can_serve_tables boolean,
  can_dispatch_orders boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  is_supervisor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.is_supervisor, false) AS is_supervisor
  FROM public.user_branches ub
  JOIN public.profiles p
    ON p.id = ub.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = ub.user_id
  WHERE ub.branch_id = p_branch_id
  ORDER BY p.full_name, p.username;
END;
$$;


DROP FUNCTION IF EXISTS public.get_my_branch_shift_gate(uuid);
CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate(
  p_branch_id uuid
)
RETURNS TABLE (
  shift_id uuid,
  shift_open boolean,
  user_enabled boolean,
  active_tables_count integer,
  caja_status public.caja_status,
  can_serve_tables boolean,
  can_dispatch_orders boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  is_supervisor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_active_tables_count integer := 0;
  v_caja_status public.caja_status;
  v_user_row record;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT cs.id, COALESCE(cs.active_tables_count, 0), cs.caja_status
  INTO v_shift_id, v_active_tables_count, v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT csu.is_enabled, csu.can_serve_tables, csu.can_dispatch_orders, csu.can_use_caja, csu.can_authorize_order_cancel, csu.is_supervisor
  INTO v_user_row
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift_id
    AND csu.user_id = auth.uid();

  RETURN QUERY
  SELECT 
    v_shift_id, 
    true, 
    COALESCE(v_user_row.is_enabled, false), 
    v_active_tables_count,
    v_caja_status,
    COALESCE(v_user_row.can_serve_tables, false),
    COALESCE(v_user_row.can_dispatch_orders, false),
    COALESCE(v_user_row.can_use_caja, false),
    COALESCE(v_user_row.can_authorize_order_cancel, false),
    COALESCE(v_user_row.is_supervisor, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;
