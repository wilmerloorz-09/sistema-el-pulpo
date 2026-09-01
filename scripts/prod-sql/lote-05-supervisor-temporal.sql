-- lote-05-supervisor-temporal
-- Ejecutar en Supabase SQL Editor (produccion)
-- Fecha: 2026-08-30

-- ===== 20260829120000_branch_supervisor_delegations.sql =====
-- Supervisor temporal por sucursal (vigencia: dÃ­a civil America/Guayaquil).
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



-- ===== 20260829130000_fix_supervisor_delegation_branch_access.sql =====
-- Corrige asignacion de supervisor temporal:
-- 1) No insertar en user_branches (unica sucursal por usuario).
-- 2) Permitir cambiar a sucursal delegada y operar alli ese dia.

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

CREATE OR REPLACE FUNCTION public.set_my_active_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF public.is_global_admin(auth.uid()) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = p_branch_id
        AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'La sucursal seleccionada no existe o no esta activa';
    END IF;

    UPDATE public.profiles
    SET active_branch_id = p_branch_id,
        updated_at = now()
    WHERE id = auth.uid();

    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.branches b ON b.id = ub.branch_id
    WHERE ub.user_id = auth.uid()
      AND ub.branch_id = p_branch_id
      AND b.is_active = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    JOIN public.branches b
      ON b.id = cs.branch_id
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
      AND b.is_active = true
  ) AND NOT public.has_active_supervisor_delegation(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'Sucursal no disponible para el usuario';
  END IF;

  UPDATE public.profiles
  SET active_branch_id = p_branch_id,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_branch uuid;
  v_branches jsonb := '[]'::jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_shift_permissions jsonb := '{}'::jsonb;
  v_shift_branch uuid;
  v_has_shift_at_current boolean;
  v_is_global_admin boolean := false;
  v_is_delegated_supervisor boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_is_global_admin := public.is_global_admin(v_user_id);

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT cs.branch_id INTO v_shift_branch
  FROM public.cash_shifts cs
  JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
  WHERE cs.status = 'OPEN'
    AND csu.user_id = v_user_id
    AND csu.is_enabled = true
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  v_has_shift_at_current := EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
    WHERE cs.branch_id = v_active_branch
      AND cs.status = 'OPEN'
      AND csu.user_id = v_user_id
      AND csu.is_enabled = true
  );

  IF NOT v_is_global_admin
     AND v_shift_branch IS NOT NULL
     AND NOT v_has_shift_at_current
     AND NOT public.has_active_supervisor_delegation(v_user_id, v_active_branch)
  THEN
    v_active_branch := v_shift_branch;
    UPDATE public.profiles
    SET active_branch_id = v_active_branch, updated_at = now()
    WHERE id = v_user_id;
  END IF;

  IF v_is_global_admin THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    WHERE b.is_active = true;
  ELSE
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true

      UNION

      SELECT d.branch_id, 2 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL
    ),
    ranked AS (
      SELECT branch_id,
        row_number() OVER (ORDER BY priority, branch_id) AS rn
      FROM accessible_branch_ids
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    JOIN ranked r ON r.branch_id = b.id
    WHERE b.is_active = true;
  END IF;

  IF v_active_branch IS NULL
     OR NOT EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id = v_active_branch
          AND b.is_active = true
     )
  THEN
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true

      UNION

      SELECT d.branch_id, 2 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL
    )
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    JOIN accessible_branch_ids abi ON abi.branch_id = b.id
    WHERE b.is_active = true
    ORDER BY abi.priority, b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    v_is_delegated_supervisor := public.has_active_supervisor_delegation(v_user_id, v_active_branch);

    SELECT COALESCE(jsonb_object_agg(module_code, access_level::text), '{}'::jsonb)
    INTO v_permissions
    FROM public.v_user_effective_permissions
    WHERE user_id = v_user_id
      AND branch_id = v_active_branch;

    IF NOT v_is_global_admin THEN
      SELECT COALESCE(jsonb_strip_nulls(jsonb_build_object(
        'mesas', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'ordenes', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.can_access_orders, false) OR COALESCE(csu.can_edit_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_total', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_mesa', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_para_llevar', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'caja', CASE WHEN bool_or(COALESCE(csu.can_use_caja, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END
      )), '{}'::jsonb)
      INTO v_shift_permissions
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.branch_id = v_active_branch
        AND cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true;

      v_permissions := COALESCE(v_shift_permissions, '{}'::jsonb) || COALESCE(v_permissions, '{}'::jsonb);

      IF v_is_delegated_supervisor THEN
        v_permissions := jsonb_build_object(
          'mesas', 'OPERATE',
          'ordenes', 'OPERATE',
          'despacho_total', 'OPERATE',
          'despacho_mesa', 'OPERATE',
          'despacho_para_llevar', 'OPERATE',
          'caja', 'OPERATE'
        ) || COALESCE(v_permissions, '{}'::jsonb);
      END IF;
    END IF;

    IF public.can_operate_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'OPERATE');
    ELSIF public.can_view_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'VIEW');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', v_is_global_admin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_branch_supervisor_delegation(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_active_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

NOTIFY pgrst, 'reload schema';




