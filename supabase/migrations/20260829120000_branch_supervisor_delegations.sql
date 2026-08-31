-- Supervisor temporal por sucursal (vigencia: día civil America/Guayaquil).
-- Solo admin global asigna/revoca. Coexiste con el supervisor permanente.

CREATE TABLE IF NOT EXISTS public.branch_supervisor_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_supervisor_delegations_active_day
  ON public.branch_supervisor_delegations (branch_id, effective_date)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_branch_supervisor_delegations_delegate_day
  ON public.branch_supervisor_delegations (delegate_user_id, effective_date)
  WHERE revoked_at IS NULL;

ALTER TABLE public.branch_supervisor_delegations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.branch_local_date(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (timezone('America/Guayaquil', p_at))::date;
$$;

CREATE OR REPLACE FUNCTION public.user_is_branch_supervisor_permanent(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_branch_roles ubr
    JOIN public.roles r
      ON r.id = ubr.role_id
    WHERE ubr.user_id = p_user_id
      AND ubr.branch_id = p_branch_id
      AND ubr.is_active = true
      AND r.is_active = true
      AND r.code = 'supervisor'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_supervisor_delegation(
  p_user_id uuid,
  p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branch_supervisor_delegations d
    WHERE d.delegate_user_id = p_user_id
      AND d.branch_id = p_branch_id
      AND d.effective_date = public.branch_local_date(p_at)
      AND d.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_supervisor_delegation_to_open_shift(
  p_branch_id uuid,
  p_delegate_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL OR p_delegate_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN;
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
    can_serve_plates
  )
  VALUES (
    v_shift_id,
    p_delegate_user_id,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    true,
    true,
    true
  )
  ON CONFLICT (shift_id, user_id)
  DO UPDATE SET
    is_enabled = true,
    is_supervisor = true,
    can_serve_tables = true,
    can_access_orders = true,
    can_edit_orders = true,
    can_dispatch_orders = true,
    can_manage_products = true,
    can_use_caja = true,
    can_authorize_order_cancel = true,
    can_pack_orders = true,
    can_serve_plates = true,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_branch_supervisor_for_shift_gate(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_branch_supervisor_permanent(p_user_id, p_branch_id)
    OR public.can_manage_shift_admin(p_user_id, p_branch_id)
    OR public.has_active_supervisor_delegation(p_user_id, p_branch_id);
$$;

CREATE OR REPLACE FUNCTION public.is_payment_void_authorizer(
  p_user_id uuid,
  p_shift_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    public.can_manage_branch_admin(p_user_id, p_branch_id)
    OR public.has_active_supervisor_delegation(p_user_id, p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_user_id
        AND csu.is_enabled = true
        AND COALESCE(csu.is_supervisor, false) = true
        AND (
          public.user_is_branch_supervisor_permanent(p_user_id, p_branch_id)
          OR public.has_active_supervisor_delegation(p_user_id, p_branch_id)
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_branch_supervisor_delegation_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.branch_local_date();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo administrador global puede consultar supervision temporal';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY branch_name)
    FROM (
      SELECT jsonb_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'permanent_supervisor_user_id', perm.user_id,
        'permanent_supervisor_name', perm.display_name,
        'delegation_id', d.id,
        'delegate_user_id', d.delegate_user_id,
        'delegate_name', delegate_profile.display_name,
        'effective_date', d.effective_date,
        'assigned_at', d.created_at,
        'assigned_by_name', assigner.display_name,
        'reason', d.reason
      ) AS row_data,
      b.name AS branch_name
      FROM public.branches b
      LEFT JOIN LATERAL (
        SELECT
          p.id AS user_id,
          COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.username) AS display_name
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        JOIN public.profiles p
          ON p.id = ubr.user_id
        WHERE ubr.branch_id = b.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
        LIMIT 1
      ) perm ON true
      LEFT JOIN public.branch_supervisor_delegations d
        ON d.branch_id = b.id
       AND d.effective_date = v_today
       AND d.revoked_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.username) AS display_name
        FROM public.profiles p
        WHERE p.id = d.delegate_user_id
      ) delegate_profile ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.username) AS display_name
        FROM public.profiles p
        WHERE p.id = d.assigned_by
      ) assigner ON true
      WHERE b.is_active = true
    ) q
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_branch_supervisor_delegation(
  p_branch_id uuid,
  p_delegate_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := public.branch_local_date();
  v_delegation_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede asignar supervisor temporal';
  END IF;

  IF p_branch_id IS NULL OR p_delegate_user_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal y usuario suplente son obligatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'La sucursal no existe o no esta activa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_delegate_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'El usuario suplente no existe o no esta activo';
  END IF;

  UPDATE public.branch_supervisor_delegations d
  SET
    revoked_at = now(),
    revoked_by = v_actor
  WHERE d.branch_id = p_branch_id
    AND d.effective_date = v_today
    AND d.revoked_at IS NULL;

  INSERT INTO public.branch_supervisor_delegations (
    branch_id,
    delegate_user_id,
    assigned_by,
    effective_date,
    reason
  )
  VALUES (
    p_branch_id,
    p_delegate_user_id,
    v_actor,
    v_today,
    NULLIF(trim(p_reason), '')
  )
  RETURNING id INTO v_delegation_id;

  PERFORM public.apply_supervisor_delegation_to_open_shift(p_branch_id, p_delegate_user_id);

  RETURN jsonb_build_object(
    'delegation_id', v_delegation_id,
    'branch_id', p_branch_id,
    'delegate_user_id', p_delegate_user_id,
    'effective_date', v_today
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_branch_supervisor_delegation(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := public.branch_local_date();
  v_delegate_user_id uuid;
  v_delegation_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede revocar supervisor temporal';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal obligatoria';
  END IF;

  UPDATE public.branch_supervisor_delegations d
  SET
    revoked_at = now(),
    revoked_by = v_actor
  WHERE d.branch_id = p_branch_id
    AND d.effective_date = v_today
    AND d.revoked_at IS NULL
  RETURNING d.id, d.delegate_user_id
  INTO v_delegation_id, v_delegate_user_id;

  IF v_delegation_id IS NULL THEN
    RAISE EXCEPTION 'No hay supervisor temporal activo para esta sucursal hoy';
  END IF;

  UPDATE public.cash_shift_users csu
  SET
    is_supervisor = false,
    updated_at = now()
  FROM public.cash_shifts cs
  WHERE cs.id = csu.shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND csu.user_id = v_delegate_user_id
    AND NOT public.user_is_branch_supervisor_permanent(v_delegate_user_id, p_branch_id);

  RETURN jsonb_build_object(
    'delegation_id', v_delegation_id,
    'branch_id', p_branch_id,
    'delegate_user_id', v_delegate_user_id,
    'effective_date', v_today
  );
END;
$$;

-- Gate v2: supervisor temporal con acceso operativo completo mientras dure la delegacion.
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
      );

    v_is_secondary :=
      v_can_use_caja
      AND v_shift.primary_cashier_id IS NOT NULL
      AND v_shift.primary_cashier_id <> auth.uid();
  END IF;

  IF v_is_branch_admin OR v_is_delegated_supervisor THEN
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

-- Abrir turno: permitir marcar supervisor a delegados temporales.
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
      OR public.user_is_branch_supervisor_for_shift_gate(enabled_user.user_id, p_branch_id)
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
      COALESCE(v_user_input.can_double_session, false),
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

REVOKE ALL ON FUNCTION public.branch_local_date(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branch_local_date(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.user_is_branch_supervisor_permanent(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_branch_supervisor_permanent(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_active_supervisor_delegation(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_supervisor_delegation(uuid, uuid, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_supervisor_delegation_to_open_shift(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_supervisor_delegation_to_open_shift(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_is_branch_supervisor_for_shift_gate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_branch_supervisor_for_shift_gate(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_payment_void_authorizer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payment_void_authorizer(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_branch_supervisor_delegation_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_branch_supervisor_delegation_status() TO authenticated;

REVOKE ALL ON FUNCTION public.assign_branch_supervisor_delegation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_branch_supervisor_delegation(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_branch_supervisor_delegation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_branch_supervisor_delegation(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
