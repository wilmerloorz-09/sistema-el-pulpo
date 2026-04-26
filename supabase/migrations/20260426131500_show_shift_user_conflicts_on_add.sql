-- Muestra todos los usuarios en el combo de turno, pero permite validar al
-- agregarlos si ya estan habilitados en otro turno abierto.

CREATE OR REPLACE FUNCTION public.get_user_open_shift_conflict(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  shift_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_shift_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_current_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    b.id AS branch_id,
    b.name AS branch_name,
    cs.id AS shift_id
  FROM public.cash_shift_users csu
  JOIN public.cash_shifts cs
    ON cs.id = csu.shift_id
  JOIN public.branches b
    ON b.id = cs.branch_id
  WHERE csu.user_id = p_user_id
    AND csu.is_enabled = true
    AND cs.status = 'OPEN'
    AND (v_current_shift_id IS NULL OR cs.id <> v_current_shift_id)
  ORDER BY cs.opened_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_user_single_open_shift(p_user_id uuid, p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_branch_name text;
BEGIN
  IF p_user_id IS NULL OR p_shift_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts current_shift
    WHERE current_shift.id = p_shift_id
      AND current_shift.status = 'OPEN'
  ) THEN
    RETURN;
  END IF;

  SELECT b.name
  INTO v_conflict_branch_name
  FROM public.cash_shift_users other_user
  JOIN public.cash_shifts other_shift
    ON other_shift.id = other_user.shift_id
  JOIN public.branches b
    ON b.id = other_shift.branch_id
  WHERE other_user.user_id = p_user_id
    AND other_user.is_enabled = true
    AND other_user.shift_id <> p_shift_id
    AND other_shift.status = 'OPEN'
  ORDER BY other_shift.opened_at DESC
  LIMIT 1;

  IF v_conflict_branch_name IS NOT NULL THEN
    RAISE EXCEPTION 'Este usuario no se puede agregar porque esta habilitado en el turno de la sucursal %', v_conflict_branch_name;
  END IF;
END;
$$;

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
  can_edit_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  can_double_session boolean,
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

    UNION

    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.is_active = true
      AND NOT public.is_global_admin(p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
  )
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_edit_orders, false) AS can_edit_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_manage_products, COALESCE(csu.can_dispatch_orders, false), false) AS can_manage_products,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.can_double_session, false) AS can_double_session,
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

GRANT EXECUTE ON FUNCTION public.get_user_open_shift_conflict(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_user_single_open_shift(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
