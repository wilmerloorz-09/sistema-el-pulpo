BEGIN;

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
  can_access_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
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
  WITH branch_members AS (
    SELECT ub.user_id
    FROM public.user_branches ub
    WHERE ub.branch_id = p_branch_id

    UNION

    SELECT ugr.user_id
    FROM public.user_global_roles ugr
    JOIN public.roles r
      ON r.id = ugr.role_id
    WHERE ugr.is_active = true
      AND r.is_active = true
      AND r.scope = 'GLOBAL'::public.role_scope
      AND r.code = 'administrador'
  )
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_manage_products, COALESCE(csu.can_dispatch_orders, false), false) AS can_manage_products,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.is_supervisor, false) AS is_supervisor
  FROM branch_members bm
  JOIN public.profiles p
    ON p.id = bm.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = bm.user_id
  ORDER BY p.full_name, p.username;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;

COMMIT;
