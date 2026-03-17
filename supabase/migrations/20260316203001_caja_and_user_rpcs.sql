-- 1. Create a custom type for shift users to pass as an array
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_user_input') THEN
    CREATE TYPE public.shift_user_input AS (
      user_id uuid,
      can_serve_tables boolean,
      can_dispatch_orders boolean,
      can_use_caja boolean,
      can_authorize_order_cancel boolean,
      is_supervisor boolean
    );
  END IF;
END$$;

-- 2. Modify open_cash_shift_with_tables to use the new array and set caja_status to UNOPENED
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

  -- Insert shift users from array
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
    -- Fallback to default users with all permissions if null given (for backwards compatibility/testing)
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
    FROM public.user_branches ub
    JOIN public.profiles p
      ON p.id = ub.user_id
    WHERE ub.branch_id = p_branch_id
      AND p.is_active = true;
  END IF;

  RETURN v_shift_id;
END;
$$;

-- 3. Modify close_cash_shift_with_tables to enforce caja is closed
CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'No puedes cerrar el turno porque la caja esta abierta. Cierra la caja en el modulo Caja y vuelve a intentarlo.';
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

-- 4. New RPC: open_cash_register
CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_caja_status public.caja_status;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  -- Verify user has can_use_caja
  IF NOT EXISTS(
    SELECT 1 FROM public.cash_shift_users
    WHERE shift_id = p_shift_id AND user_id = p_cashier_id AND is_enabled = true AND can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF v_caja_status != 'UNOPENED' THEN
    RAISE EXCEPTION 'La caja ya fue abierta anteriormente en este turno';
  END IF;

  -- Setup Denoms
  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.branch_id = p_branch_id
      AND d.is_active = true;
  ELSE
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.cash_shift_denoms (
        id,
        shift_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        v_denomination_id,
        v_qty,
        v_qty
      );

      IF v_qty > 0 THEN
        INSERT INTO public.cash_movements (
          id,
          shift_id,
          denomination_id,
          movement_type,
          qty_delta,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          p_shift_id,
          v_denomination_id,
          'OPENING',
          v_qty,
          v_now
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.cash_shifts
  SET caja_status = 'OPEN'
  WHERE id = p_shift_id;
END;
$$;


-- 5. New RPC: close_cash_register
CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar caja con tu propio usuario autenticado';
  END IF;

  -- Verify user has can_use_caja
  IF NOT EXISTS(
    SELECT 1 FROM public.cash_shift_users
    WHERE shift_id = p_shift_id AND user_id = p_cashier_id AND is_enabled = true AND can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF v_caja_status != 'OPEN' THEN
    RAISE EXCEPTION 'La caja no esta abierta para poder cerrarla';
  END IF;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED',
      notes = COALESCE(notes, '') || CASE WHEN notes IS NOT NULL THEN E'\n' ELSE '' END || COALESCE(p_notes, '')
  WHERE id = p_shift_id;
END;
$$;

-- Update set_shift_user_enabled (if it needs to set roles too)
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
    FROM public.user_branches ub
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

-- Allow RPC execution
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shift_user_enabled(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;
