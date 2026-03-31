-- Modify set_shift_user_enabled to allow global admins (via v_user_accessible_branches)
-- Also fix the fallback in open_cash_shift_with_tables

CREATE OR REPLACE FUNCTION public.set_shift_user_enabled(
  p_shift_id uuid,
  p_user_id uuid,
  p_is_enabled boolean,
  p_can_serve_tables boolean DEFAULT false,
  p_can_dispatch_orders boolean DEFAULT false,
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
    can_dispatch_orders,
    can_use_caja,
    can_authorize_order_cancel,
    is_supervisor
  )
  VALUES (
    p_shift_id,
    p_user_id,
    COALESCE(p_is_enabled, true),
    COALESCE(p_can_serve_tables, false),
    COALESCE(p_can_dispatch_orders, false),
    COALESCE(p_can_use_caja, false),
    COALESCE(p_can_authorize_order_cancel, false),
    COALESCE(p_is_supervisor, false)
  )
  ON CONFLICT (shift_id, user_id)
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    can_serve_tables = EXCLUDED.can_serve_tables,
    can_dispatch_orders = EXCLUDED.can_dispatch_orders,
    can_use_caja = EXCLUDED.can_use_caja,
    can_authorize_order_cancel = EXCLUDED.can_authorize_order_cancel,
    is_supervisor = EXCLUDED.is_supervisor,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_shift_user_enabled(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;

-- Also patch the fallback in open_cash_shift_with_tables for consistency
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
        can_dispatch_orders,
        can_use_caja,
        can_authorize_order_cancel,
        is_supervisor
      )
      VALUES (
        v_shift_id,
        v_user_input.user_id,
        true,
        v_user_input.can_serve_tables,
        v_user_input.can_dispatch_orders,
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
      can_dispatch_orders,
      can_use_caja,
      can_authorize_order_cancel,
      is_supervisor
    )
    SELECT
      v_shift_id,
      p.id,
      true,
      true, true, true, true,
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
