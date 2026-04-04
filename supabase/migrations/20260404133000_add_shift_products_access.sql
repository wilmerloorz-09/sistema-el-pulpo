ALTER TABLE public.cash_shift_users
ADD COLUMN IF NOT EXISTS can_manage_products boolean NOT NULL DEFAULT false;

UPDATE public.cash_shift_users
SET can_manage_products = true
WHERE can_dispatch_orders = true
  AND can_manage_products = false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shift_users_has_capability_chk'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
    DROP CONSTRAINT cash_shift_users_has_capability_chk;
  END IF;
END;
$$;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  can_serve_tables = true OR
  can_access_orders = true OR
  can_dispatch_orders = true OR
  can_manage_products = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.shift_user_input'::regtype
      AND attname = 'can_manage_products'
      AND NOT attisdropped
  ) THEN
    ALTER TYPE public.shift_user_input
    ADD ATTRIBUTE can_manage_products boolean;
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
  FROM public.v_user_accessible_branches ub
  JOIN public.profiles p
    ON p.id = ub.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = ub.user_id
  WHERE ub.branch_id = p_branch_id
  ORDER BY p.full_name, p.username;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;

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
  v_active_tables_count integer := 0;
  v_caja_status public.caja_status;
  v_user_row record;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
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
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT
    csu.is_enabled,
    csu.can_serve_tables,
    csu.can_access_orders,
    csu.can_dispatch_orders,
    csu.can_manage_products,
    csu.can_use_caja,
    csu.can_authorize_order_cancel,
    csu.is_supervisor
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
    COALESCE(v_user_row.can_access_orders, COALESCE(v_user_row.can_serve_tables, false), false),
    COALESCE(v_user_row.can_dispatch_orders, false),
    COALESCE(v_user_row.can_manage_products, COALESCE(v_user_row.can_dispatch_orders, false), false),
    COALESCE(v_user_row.can_use_caja, false),
    COALESCE(v_user_row.can_authorize_order_cancel, false),
    COALESCE(v_user_row.is_supervisor, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_shift_user_enabled(
  p_shift_id uuid,
  p_user_id uuid,
  p_is_enabled boolean,
  p_can_serve_tables boolean DEFAULT false,
  p_can_access_orders boolean DEFAULT false,
  p_can_dispatch_orders boolean DEFAULT false,
  p_can_manage_products boolean DEFAULT false,
  p_can_use_caja boolean DEFAULT false,
  p_can_authorize_order_cancel boolean DEFAULT false,
  p_is_supervisor boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y user_id son obligatorios';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.status = 'OPEN';

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar usuarios de este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.profiles p ON p.id = ub.user_id
    WHERE ub.branch_id = v_branch_id
      AND ub.user_id = p_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'El usuario no pertenece a la sucursal activa o no esta activo';
  END IF;

  INSERT INTO public.cash_shift_users (
    shift_id,
    user_id,
    is_enabled,
    can_serve_tables,
    can_access_orders,
    can_dispatch_orders,
    can_manage_products,
    can_use_caja,
    can_authorize_order_cancel,
    is_supervisor
  )
  VALUES (
    p_shift_id,
    p_user_id,
    COALESCE(p_is_enabled, true),
    COALESCE(p_can_serve_tables, false),
    COALESCE(p_can_serve_tables, false) OR COALESCE(p_can_access_orders, false),
    COALESCE(p_can_dispatch_orders, false),
    COALESCE(p_can_dispatch_orders, false) OR COALESCE(p_can_manage_products, false),
    COALESCE(p_can_use_caja, false),
    COALESCE(p_can_authorize_order_cancel, false),
    COALESCE(p_is_supervisor, false)
  )
  ON CONFLICT (shift_id, user_id)
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    can_serve_tables = EXCLUDED.can_serve_tables,
    can_access_orders = EXCLUDED.can_access_orders,
    can_dispatch_orders = EXCLUDED.can_dispatch_orders,
    can_manage_products = EXCLUDED.can_manage_products,
    can_use_caja = EXCLUDED.can_use_caja,
    can_authorize_order_cancel = EXCLUDED.can_authorize_order_cancel,
    is_supervisor = EXCLUDED.is_supervisor,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_shift_user_enabled(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;

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
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir turno con tu propio usuario autenticado';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para abrir turno en esta sucursal';
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

  IF p_enabled_users IS NOT NULL THEN
    FOREACH v_user_input IN ARRAY p_enabled_users
    LOOP
      INSERT INTO public.cash_shift_users (
        shift_id,
        user_id,
        is_enabled,
        can_serve_tables,
        can_access_orders,
        can_dispatch_orders,
        can_manage_products,
        can_use_caja,
        can_authorize_order_cancel,
        is_supervisor
      )
      VALUES (
        v_shift_id,
        v_user_input.user_id,
        true,
        v_user_input.can_serve_tables,
        COALESCE(v_user_input.can_serve_tables, false) OR COALESCE(v_user_input.can_access_orders, false),
        v_user_input.can_dispatch_orders,
        COALESCE(v_user_input.can_dispatch_orders, false) OR COALESCE(v_user_input.can_manage_products, false),
        v_user_input.can_use_caja,
        v_user_input.can_authorize_order_cancel,
        v_user_input.is_supervisor
      );
    END LOOP;
  ELSE
    INSERT INTO public.cash_shift_users (
      shift_id,
      user_id,
      is_enabled,
      can_serve_tables,
      can_access_orders,
      can_dispatch_orders,
      can_manage_products,
      can_use_caja,
      can_authorize_order_cancel,
      is_supervisor
    )
    SELECT
      v_shift_id,
      p.id,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      p.id = p_cashier_id
    FROM public.v_user_accessible_branches ub
    JOIN public.profiles p
      ON p.id = ub.user_id
    WHERE ub.branch_id = p_branch_id
      AND p.is_active = true;
  END IF;

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
