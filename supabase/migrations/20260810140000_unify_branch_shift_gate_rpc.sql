-- =============================================================================
-- Gate unificado SIN DROP de la RPC vieja (segura bajo carga)
-- =============================================================================
-- get_my_branch_shift_gate está siendo llamada por todas las tablets; DROP
-- espera AccessExclusiveLock y bajo 4 sucursales OPEN el SQL Editor hace timeout.
-- Creamos get_my_branch_shift_gate_v2 (nombre nuevo) y el cliente la prefiere.
-- Más adelante, en valle, se puede DROP de la v1 y renombrar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate_v2(
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
  can_edit_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_pack_orders boolean,
  can_serve_plates boolean,
  can_authorize_order_cancel boolean,
  can_double_session boolean,
  is_supervisor boolean,
  cashier_id uuid,
  capture_user_id uuid,
  primary_cashier_id uuid,
  opened_at timestamptz,
  is_stale_shift boolean,
  last_session_id text,
  secondary_session_id text,
  caja_session_slots text[],
  secondary_caja_takeout_enabled boolean,
  secondary_caja_express_enabled boolean,
  is_secondary_cashier boolean,
  max_caja_sessions integer,
  global_caja_sessions_used integer,
  legacy_fallback_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_user public.cash_shift_users%ROWTYPE;
  v_has_user boolean := false;
  v_user_caja_status public.caja_status := 'UNOPENED';
  v_is_branch_admin boolean := false;
  v_is_stale boolean := false;
  v_can_use_caja boolean := false;
  v_is_secondary boolean := false;
  v_max_sessions integer := 1;
  v_global_used integer := 0;
  v_slots text[] := ARRAY[]::text[];
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT
      NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status,
      false, false, false, false, false, false, false, false, false, false, false,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::timestamptz, false,
      NULL::text, NULL::text, ARRAY[]::text[],
      false, false, false, 1, 0, false;
    RETURN;
  END IF;

  v_is_branch_admin := public.can_manage_branch_admin(auth.uid(), p_branch_id);

  SELECT cs.*
  INTO v_shift
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_shift.id IS NULL THEN
    RETURN QUERY SELECT
      NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status,
      false, false, false, false, false, false, false, false, false, false, false,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::timestamptz, false,
      NULL::text, NULL::text, ARRAY[]::text[],
      false, false, false, 1, 0, false;
    RETURN;
  END IF;

  v_is_stale := (
    (timezone('America/Bogota', v_shift.opened_at))::date
    < (timezone('America/Bogota', now()))::date
  );

  SELECT public.get_user_caja_status(v_shift.id, auth.uid())
  INTO v_user_caja_status;

  SELECT csu.*
  INTO v_user
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift.id
    AND csu.user_id = auth.uid();
  v_has_user := FOUND;

  v_max_sessions := GREATEST(1, LEAST(COALESCE(public.shift_caja_terminal_cap(v_shift.id), 1), 10));

  SELECT COALESCE(SUM(cardinality(COALESCE(csu.caja_session_slots, '{}'::text[]))), 0)::integer
  INTO v_global_used
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift.id
    AND csu.is_enabled = true
    AND csu.can_use_caja = true;

  IF v_has_user THEN
    IF COALESCE(cardinality(v_user.caja_session_slots), 0) > 0 THEN
      v_slots := v_user.caja_session_slots;
    ELSE
      v_slots := ARRAY_REMOVE(ARRAY[v_user.last_session_id, v_user.secondary_session_id], NULL);
    END IF;

    v_can_use_caja :=
      COALESCE(v_user.can_use_caja, false)
      OR (
        v_shift.primary_cashier_id IS NOT NULL
        AND v_shift.primary_cashier_id = auth.uid()
        AND COALESCE(v_user.is_enabled, false)
      );

    v_is_secondary :=
      v_can_use_caja
      AND v_shift.primary_cashier_id IS NOT NULL
      AND v_shift.primary_cashier_id <> auth.uid();
  END IF;

  IF v_is_branch_admin THEN
    RETURN QUERY SELECT
      v_shift.id,
      true,
      true,
      COALESCE(v_shift.active_tables_count, 0),
      COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
      true, true, true, true, true, true, true, true, true, true, true,
      v_shift.cashier_id,
      v_shift.capture_user_id,
      v_shift.primary_cashier_id,
      v_shift.opened_at,
      v_is_stale,
      v_user.last_session_id,
      v_user.secondary_session_id,
      COALESCE(v_slots, ARRAY[]::text[]),
      false,
      false,
      false,
      v_max_sessions,
      COALESCE(v_global_used, 0),
      false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_shift.id,
    true,
    COALESCE(v_user.is_enabled, false),
    COALESCE(v_shift.active_tables_count, 0),
    COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
    COALESCE(v_user.can_serve_tables, false),
    COALESCE(v_user.can_access_orders, COALESCE(v_user.can_serve_tables, false), false),
    COALESCE(v_user.can_edit_orders, false),
    COALESCE(v_user.can_dispatch_orders, false),
    COALESCE(v_user.can_manage_products, COALESCE(v_user.can_dispatch_orders, false), false),
    v_can_use_caja,
    COALESCE(v_user.can_pack_orders, false),
    COALESCE(v_user.can_serve_plates, false),
    COALESCE(v_user.can_authorize_order_cancel, false),
    COALESCE(v_user.can_double_session, false),
    COALESCE(v_user.is_supervisor, false),
    v_shift.cashier_id,
    v_shift.capture_user_id,
    v_shift.primary_cashier_id,
    v_shift.opened_at,
    v_is_stale,
    v_user.last_session_id,
    v_user.secondary_session_id,
    COALESCE(v_slots, ARRAY[]::text[]),
    CASE WHEN v_is_secondary THEN COALESCE(v_user.secondary_caja_takeout_enabled, false) ELSE false END,
    CASE WHEN v_is_secondary THEN COALESCE(v_user.secondary_caja_express_enabled, false) ELSE false END,
    v_is_secondary,
    v_max_sessions,
    COALESCE(v_global_used, 0),
    false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate_v2(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
