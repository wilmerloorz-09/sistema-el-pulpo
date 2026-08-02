-- =============================================================================
-- Admins (global / admin_sucursal MANAGE) operan sin estar habilitados en turno
-- =============================================================================
-- Alinea el gate UI y la apertura de caja con las RPCs operativas que ya usan
-- can_manage_branch_admin para bypasear cash_shift_users.is_enabled.
-- =============================================================================

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
  v_user_caja_status public.caja_status := 'UNOPENED';
  v_user_row record;
  v_is_branch_admin boolean := false;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
    RETURN;
  END IF;

  v_is_branch_admin := public.can_manage_branch_admin(auth.uid(), p_branch_id);

  SELECT cs.id, COALESCE(cs.active_tables_count, 0)
  INTO v_shift_id, v_active_tables_count
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT public.get_user_caja_status(v_shift_id, auth.uid())
  INTO v_user_caja_status;

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

  -- Admin de sucursal/global: acceso operativo completo aunque no figure habilitado.
  IF v_is_branch_admin THEN
    RETURN QUERY
    SELECT
      v_shift_id,
      true,
      true,
      v_active_tables_count,
      COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
      true,
      true,
      true,
      true,
      true,
      true,
      true;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_shift_id,
    true,
    COALESCE(v_user_row.is_enabled, false),
    v_active_tables_count,
    COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
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

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2) := 0;
  v_register_role text := 'primary';
  v_is_branch_admin boolean := false;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  v_is_branch_admin := public.can_manage_branch_admin(auth.uid(), p_branch_id);

  IF NOT v_is_branch_admin
     AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users
    WHERE shift_id = p_shift_id
      AND user_id = p_cashier_id
      AND is_enabled = true
      AND can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'Tu usuario debe estar habilitado con permiso de Caja en este turno para abrir caja.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una caja abierta en este turno. Cierrala antes de abrir otra apertura.';
  END IF;

  INSERT INTO public.cash_register_openings (
    id,
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total,
    register_role
  )
  VALUES (
    v_opening_id,
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    0,
    v_register_role
  );

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true;
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
        cashier_id,
        opening_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        p_cashier_id,
        v_opening_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;

    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_denoms csd
        WHERE csd.shift_id = p_shift_id
          AND csd.cashier_id = p_cashier_id
          AND csd.opening_id = v_opening_id
          AND csd.denomination_id = d.id
      );
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id
    AND csd.cashier_id = p_cashier_id
    AND csd.opening_id = v_opening_id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  RETURN v_opening_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
