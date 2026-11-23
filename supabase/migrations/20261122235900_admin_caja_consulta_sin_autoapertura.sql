-- Paso 3 opción C: admins/supervisores ven Caja en consulta.
-- El gate ya no fuerza can_use_caja=true; reporta el permiso real del turno.
-- open_cash_register exige cajero asignado (no bypass admin) y asigna
-- register_role primary solo si es el cajero principal del turno.

CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate_v2(p_branch_id uuid)
 RETURNS TABLE(shift_id uuid, shift_open boolean, user_enabled boolean, active_tables_count integer, caja_status caja_status, can_serve_tables boolean, can_access_orders boolean, can_edit_orders boolean, can_dispatch_orders boolean, can_manage_products boolean, can_use_caja boolean, can_pack_orders boolean, can_serve_plates boolean, can_authorize_order_cancel boolean, can_double_session boolean, is_supervisor boolean, cashier_id uuid, capture_user_id uuid, primary_cashier_id uuid, opened_at timestamp with time zone, is_stale_shift boolean, last_session_id text, secondary_session_id text, caja_session_slots text[], secondary_caja_takeout_enabled boolean, secondary_caja_express_enabled boolean, is_secondary_cashier boolean, max_caja_sessions integer, global_caja_sessions_used integer, legacy_fallback_applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_user public.cash_shift_users%ROWTYPE;
  v_has_user boolean := false;
  v_user_caja_status public.caja_status := 'UNOPENED';
  v_is_branch_admin boolean := false;
  v_is_delegated_supervisor boolean := false;
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
  v_is_delegated_supervisor := public.has_active_supervisor_delegation(auth.uid(), p_branch_id);

  IF v_is_delegated_supervisor THEN
    PERFORM public.apply_supervisor_delegation_to_open_shift(p_branch_id, auth.uid());
  END IF;

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
    (timezone('America/Guayaquil', v_shift.opened_at))::date
    < public.branch_local_date()
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
      )
      OR COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status) = 'OPEN'::public.caja_status;

    v_is_secondary :=
      v_can_use_caja
      AND v_shift.primary_cashier_id IS NOT NULL
      AND v_shift.primary_cashier_id <> auth.uid();
  END IF;

  -- Admin/supervisor: operativa completa, pero can_use_caja refleja asignación real
  -- (consulta Recaudar vía bypass del cliente; cobrar solo si es cajero asignado).
  IF v_is_branch_admin OR v_is_delegated_supervisor THEN
    RETURN QUERY SELECT
      v_shift.id,
      true,
      true,
      COALESCE(v_shift.active_tables_count, 0),
      COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
      true, true, true, true, true,
      v_can_use_caja,
      true, true, true, true, true,
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
$function$;

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2) := 0;
  v_register_role text := 'secondary';
  v_is_primary boolean := false;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  -- Sin bypass de admin: solo cajeros asignados abren caja (admins consultan).
  IF NOT EXISTS (
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

  SELECT (cs.primary_cashier_id IS NOT DISTINCT FROM p_cashier_id)
  INTO v_is_primary
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  v_register_role := CASE WHEN COALESCE(v_is_primary, false) THEN 'primary' ELSE 'secondary' END;

  -- Evitar dos primary abiertas si este usuario abre como principal.
  IF v_register_role = 'primary' THEN
    UPDATE public.cash_register_openings cro
    SET register_role = 'secondary',
        updated_at = now()
    WHERE cro.shift_id = p_shift_id
      AND cro.status = 'abierta'
      AND COALESCE(cro.register_role, 'standard') = 'primary'
      AND cro.cashier_id IS DISTINCT FROM p_cashier_id;
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
$function$;
