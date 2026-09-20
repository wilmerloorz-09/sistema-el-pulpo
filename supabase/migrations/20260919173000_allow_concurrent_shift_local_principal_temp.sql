-- Excepcion TEMPORAL (pruebas): en Local Principal un usuario puede estar
-- habilitado aunque ya tenga turno abierto en otra sucursal.
-- Destino definitivo previsto: El Pulpo 1 Tarde (P1T).

CREATE OR REPLACE FUNCTION public.allows_concurrent_open_shift(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true
      AND (
        upper(COALESCE(b.branch_code, '')) = 'C01'
        OR lower(b.name) LIKE 'local principal%'
      )
  );
$$;

COMMENT ON FUNCTION public.allows_concurrent_open_shift(uuid) IS
  'TEMPORAL pruebas: True solo para Local Principal. Permite habilitar usuarios con otro turno abierto.';

CREATE OR REPLACE FUNCTION public.assert_user_single_open_shift(p_user_id uuid, p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_branch_id uuid;
  v_conflict_branch_name text;
BEGIN
  IF p_user_id IS NULL OR p_shift_id IS NULL THEN
    RETURN;
  END IF;

  SELECT current_shift.branch_id
  INTO v_target_branch_id
  FROM public.cash_shifts current_shift
  WHERE current_shift.id = p_shift_id
    AND current_shift.status = 'OPEN';

  IF v_target_branch_id IS NULL THEN
    RETURN;
  END IF;

  -- Solo Local Principal (pruebas) puede recibir usuarios ya habilitados en otra sucursal.
  IF public.allows_concurrent_open_shift(v_target_branch_id) THEN
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

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  -- En Local Principal (pruebas) no se reporta conflicto por otro turno abierto.
  IF public.allows_concurrent_open_shift(p_branch_id) THEN
    RETURN;
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

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL,
  p_primary_cashier_id uuid DEFAULT NULL,
  p_secondary_cajas_enabled boolean DEFAULT false,
  p_secondary_caja_template_id uuid DEFAULT NULL,
  p_secondary_cashier_ids uuid[] DEFAULT NULL,
  p_secondary_caja_config jsonb DEFAULT NULL
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
  v_operational_user_count integer := 0;
  v_blocked_users text;
  v_allow_concurrent boolean := public.allows_concurrent_open_shift(p_branch_id);
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF p_primary_cashier_id IS NULL THEN
    RAISE EXCEPTION 'Debe asignar un cajero a la caja principal';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir turno con tu propio usuario autenticado';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para abrir turno en esta sucursal';
  END IF;

  SELECT COUNT(*)
  INTO v_operational_user_count
  FROM unnest(COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])) AS enabled_user
  JOIN public.profiles p ON p.id = enabled_user.user_id AND p.is_active = true
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
    )
    AND (
      COALESCE(enabled_user.is_supervisor, false) = false
      OR public.user_is_branch_supervisor_for_shift_gate(enabled_user.user_id, p_branch_id)
    );

  SELECT COUNT(*)
  INTO v_enabled_user_count
  FROM unnest(COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])) AS enabled_user
  JOIN public.profiles p ON p.id = enabled_user.user_id AND p.is_active = true
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
    )
    AND (
      v_allow_concurrent
      OR NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_users other_user
        JOIN public.cash_shifts other_shift ON other_shift.id = other_user.shift_id
        WHERE other_user.user_id = enabled_user.user_id
          AND other_user.is_enabled = true
          AND other_shift.status = 'OPEN'
      )
    )
    AND (
      COALESCE(enabled_user.is_supervisor, false) = false
      OR public.user_is_branch_supervisor_for_shift_gate(enabled_user.user_id, p_branch_id)
    );

  IF v_enabled_user_count = 0 THEN
    IF v_operational_user_count > 0 THEN
      SELECT string_agg(
        COALESCE(p.full_name, p.username, 'Usuario')
        || ' (turno abierto en '
        || COALESCE(b.name, 'otra sucursal')
        || ')',
        ', '
        ORDER BY COALESCE(p.full_name, p.username)
      )
      INTO v_blocked_users
      FROM unnest(COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])) AS enabled_user
      JOIN public.profiles p ON p.id = enabled_user.user_id AND p.is_active = true
      JOIN public.cash_shift_users other_user
        ON other_user.user_id = enabled_user.user_id
       AND other_user.is_enabled = true
      JOIN public.cash_shifts other_shift
        ON other_shift.id = other_user.shift_id
       AND other_shift.status = 'OPEN'
      JOIN public.branches b ON b.id = other_shift.branch_id
      WHERE enabled_user.user_id IS NOT NULL;

      RAISE EXCEPTION
        'Ninguno de los usuarios del turno puede abrirse aqui porque ya estan en otro turno abierto: %',
        COALESCE(v_blocked_users, 'revisa turnos abiertos en otras sucursales');
    END IF;

    RAISE EXCEPTION 'No se puede abrir el turno sin al menos un usuario habilitado con rol operativo disponible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto en la sucursal activa';
  END IF;

  INSERT INTO public.cash_shifts (
    id, cashier_id, branch_id, active_tables_count, status, caja_status, opened_at,
    primary_cashier_id, secondary_cajas_enabled, secondary_caja_template_id
  )
  VALUES (
    v_shift_id, p_cashier_id, p_branch_id, GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN', 'UNOPENED', v_now,
    p_primary_cashier_id, COALESCE(p_secondary_cajas_enabled, false), p_secondary_caja_template_id
  );

  PERFORM public.configure_shift_active_tables(p_branch_id, v_shift_id, p_active_tables_count);

  FOREACH v_user_input IN ARRAY COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])
  LOOP
    IF v_user_input.user_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.cash_shift_users (
      shift_id, user_id, is_enabled,
      can_serve_tables, can_access_orders, can_edit_orders,
      can_dispatch_orders, can_manage_products,
      can_use_caja, can_authorize_order_cancel, can_double_session, is_supervisor
    )
    VALUES (
      v_shift_id, v_user_input.user_id, true,
      COALESCE(v_user_input.can_serve_tables, false),
      COALESCE(v_user_input.can_serve_tables, false) OR COALESCE(v_user_input.can_access_orders, false),
      COALESCE(v_user_input.can_edit_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false) OR COALESCE(v_user_input.can_manage_products, false),
      false,
      COALESCE(v_user_input.can_authorize_order_cancel, false),
      false,
      COALESCE(v_user_input.is_supervisor, false)
    );
  END LOOP;

  PERFORM public.apply_shift_caja_configuration(
    p_shift_id := v_shift_id,
    p_branch_id := p_branch_id,
    p_primary_cashier_id := p_primary_cashier_id,
    p_secondary_cajas_enabled := COALESCE(p_secondary_cajas_enabled, false),
    p_secondary_caja_template_id := p_secondary_caja_template_id,
    p_secondary_cashier_ids := COALESCE(p_secondary_cashier_ids, ARRAY[]::uuid[]),
    p_secondary_caja_config := COALESCE(p_secondary_caja_config, '[]'::jsonb)
  );

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allows_concurrent_open_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_user_single_open_shift(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_open_shift_conflict(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], uuid, boolean, uuid, uuid[], jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
