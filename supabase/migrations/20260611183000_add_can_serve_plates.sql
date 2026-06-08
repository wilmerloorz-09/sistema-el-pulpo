-- Add can_serve_plates to cash_shift_users table
ALTER TABLE public.cash_shift_users ADD COLUMN IF NOT EXISTS can_serve_plates BOOLEAN NOT NULL DEFAULT FALSE;

-- Add attribute to shift_user_input type
ALTER TYPE public.shift_user_input ADD ATTRIBUTE can_serve_plates BOOLEAN CASCADE;

-- Recreate list_shift_users_for_branch to include the new column
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
  is_supervisor boolean,
  can_pack_orders boolean,
  secondary_caja_takeout_enabled boolean,
  secondary_caja_express_enabled boolean,
  secondary_caja_template_id uuid,
  can_serve_plates boolean
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

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
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
    COALESCE(csu.is_supervisor, false) AS is_supervisor,
    COALESCE(csu.can_pack_orders, false) AS can_pack_orders,
    COALESCE(csu.secondary_caja_takeout_enabled, false) AS secondary_caja_takeout_enabled,
    COALESCE(csu.secondary_caja_express_enabled, false) AS secondary_caja_express_enabled,
    csu.secondary_caja_template_id,
    COALESCE(csu.can_serve_plates, false) AS can_serve_plates
  FROM branch_members bm
  JOIN public.profiles p
    ON p.id = bm.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = bm.user_id
  ORDER BY p.full_name, p.username;
END;
$$;

-- Note: open_cash_shift_with_tables uses the shift_user_input type, but we might need to recreate it if the signature changes or just rely on the new type.
-- Wait, we also need to recreate open_cash_shift_with_tables to handle inserting can_serve_plates!

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_user_input public.shift_user_input;
  v_enabled_user_count integer := 0;
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir turno con tu propio usuario autenticado';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para abrir turno en esta sucursal';
  END IF;

  SELECT COUNT(*)
  INTO v_enabled_user_count
  FROM unnest(COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])) AS enabled_user
  JOIN public.profiles p
    ON p.id = enabled_user.user_id
   AND p.is_active = true
  WHERE enabled_user.user_id IS NOT NULL
    AND (
      COALESCE(enabled_user.can_serve_tables, false)
      OR COALESCE(enabled_user.can_access_orders, false)
      OR COALESCE(enabled_user.can_edit_orders, false)
      OR COALESCE(enabled_user.can_dispatch_orders, false)
      OR COALESCE(enabled_user.can_manage_products, false)
      OR COALESCE(enabled_user.can_use_caja, false)
      OR COALESCE(enabled_user.can_authorize_order_cancel, false)
      OR COALESCE(enabled_user.is_supervisor, false)
      OR COALESCE(enabled_user.can_pack_orders, false)
      OR COALESCE(enabled_user.can_serve_plates, false)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.cash_shift_users other_user
      JOIN public.cash_shifts other_shift
        ON other_shift.id = other_user.shift_id
      WHERE other_user.user_id = enabled_user.user_id
        AND other_user.is_enabled = true
        AND other_shift.status = 'OPEN'
    )
    AND (
      COALESCE(enabled_user.is_supervisor, false) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = enabled_user.user_id
          AND ubr.branch_id = p_branch_id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
    );

  IF v_enabled_user_count = 0 THEN
    RAISE EXCEPTION 'No se puede abrir el turno sin al menos un usuario habilitado con rol operativo disponible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto en la sucursal activa';
  END IF;

  INSERT INTO public.cash_shifts (
    id,
    cashier_id,
    branch_id,
    active_tables_count,
    status,
    caja_status,
    opened_at
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    'UNOPENED',
    v_now
  );

  PERFORM public.configure_shift_active_tables(
    p_branch_id,
    v_shift_id,
    p_active_tables_count
  );

  FOREACH v_user_input IN ARRAY p_enabled_users
  LOOP
    IF v_user_input.user_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.cash_shift_users (
      shift_id,
      user_id,
      is_enabled,
      can_serve_tables,
      can_access_orders,
      can_edit_orders,
      can_dispatch_orders,
      can_manage_products,
      can_use_caja,
      can_authorize_order_cancel,
      can_double_session,
      is_supervisor,
      can_pack_orders,
      secondary_caja_takeout_enabled,
      secondary_caja_express_enabled,
      secondary_caja_template_id,
      can_serve_plates
    )
    VALUES (
      v_shift_id,
      v_user_input.user_id,
      true,
      COALESCE(v_user_input.can_serve_tables, false),
      COALESCE(v_user_input.can_serve_tables, false) OR COALESCE(v_user_input.can_access_orders, false),
      COALESCE(v_user_input.can_edit_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false) OR COALESCE(v_user_input.can_manage_products, false),
      COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.can_authorize_order_cancel, false),
      COALESCE(v_user_input.can_double_session, false) AND COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.is_supervisor, false),
      COALESCE(v_user_input.can_pack_orders, false),
      COALESCE(v_user_input.secondary_caja_takeout_enabled, false),
      COALESCE(v_user_input.secondary_caja_express_enabled, false),
      v_user_input.secondary_caja_template_id,
      COALESCE(v_user_input.can_serve_plates, false)
    );
  END LOOP;

  RETURN v_shift_id;
END;
$$;
