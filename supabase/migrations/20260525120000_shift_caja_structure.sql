-- Estructura de caja por turno: caja principal (arqueo en /caja) + cajas secundarias (arqueo al abrir turno).

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS primary_cashier_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_cajas_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS secondary_caja_template_id uuid REFERENCES public.cash_register_templates(id) ON DELETE SET NULL;

ALTER TABLE public.cash_register_openings
  ADD COLUMN IF NOT EXISTS register_role text NOT NULL DEFAULT 'standard';

ALTER TABLE public.cash_register_openings
  DROP CONSTRAINT IF EXISTS cash_register_openings_register_role_check;

ALTER TABLE public.cash_register_openings
  ADD CONSTRAINT cash_register_openings_register_role_check
  CHECK (register_role IN ('standard', 'primary', 'secondary'));

COMMENT ON COLUMN public.cash_shifts.primary_cashier_id IS 'Cajero de la caja principal del turno; abre arqueo en modulo Caja.';
COMMENT ON COLUMN public.cash_shifts.secondary_cajas_enabled IS 'Si true, el turno admite cajas secundarias configuradas al abrir.';
COMMENT ON COLUMN public.cash_register_openings.register_role IS 'primary: arqueo en Caja; secondary: abierta al configurar turno; standard: legacy.';

CREATE OR REPLACE FUNCTION public.internal_open_cash_register_for_cashier(
  p_shift_id uuid,
  p_branch_id uuid,
  p_cashier_id uuid,
  p_denoms jsonb,
  p_register_role text DEFAULT 'secondary'
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
  v_role text := COALESCE(NULLIF(btrim(p_register_role), ''), 'secondary');
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF v_role NOT IN ('standard', 'primary', 'secondary') THEN
    RAISE EXCEPTION 'register_role invalido';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_cashier_id
      AND csu.is_enabled = true
      AND csu.can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'El cajero debe estar habilitado con Caja en este turno';
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
    RAISE EXCEPTION 'Este cajero ya tiene una caja abierta en el turno';
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
    v_role
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

CREATE OR REPLACE FUNCTION public.template_denoms_to_jsonb(p_template_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'denomination_id', crtd.denomination_id,
        'qty', GREATEST(0, COALESCE(crtd.qty, 0))
      )
    ),
    '[]'::jsonb
  )
  FROM public.cash_register_template_denoms crtd
  WHERE crtd.template_id = p_template_id;
$$;

CREATE OR REPLACE FUNCTION public.apply_shift_caja_configuration(
  p_shift_id uuid,
  p_branch_id uuid,
  p_primary_cashier_id uuid,
  p_secondary_cajas_enabled boolean,
  p_secondary_caja_template_id uuid,
  p_secondary_cashier_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secondary_enabled boolean := COALESCE(p_secondary_cajas_enabled, false);
  v_template_id uuid := p_secondary_caja_template_id;
  v_secondary_id uuid;
  v_denoms jsonb;
  v_cashier_ids uuid[] := COALESCE(p_secondary_cashier_ids, ARRAY[]::uuid[]);
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL OR p_primary_cashier_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, branch_id y primary_cashier_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_primary_cashier_id
      AND csu.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'El cajero principal debe estar habilitado en el turno';
  END IF;

  IF p_primary_cashier_id = ANY(v_cashier_ids) THEN
    RAISE EXCEPTION 'El cajero principal no puede ser tambien caja secundaria';
  END IF;

  IF (SELECT COUNT(DISTINCT x) FROM unnest(v_cashier_ids) AS x) <> COALESCE(array_length(v_cashier_ids, 1), 0) THEN
    RAISE EXCEPTION 'No puede repetir el mismo cajero en cajas secundarias';
  END IF;

  IF v_secondary_enabled AND v_template_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar una plantilla para las cajas secundarias';
  END IF;

  IF v_secondary_enabled THEN
    FOREACH v_secondary_id IN ARRAY v_cashier_ids
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_users csu
        WHERE csu.shift_id = p_shift_id
          AND csu.user_id = v_secondary_id
          AND csu.is_enabled = true
      ) THEN
        RAISE EXCEPTION 'Todos los cajeros secundarios deben estar habilitados en el turno';
      END IF;
    END LOOP;
  ELSE
    v_cashier_ids := ARRAY[]::uuid[];
  END IF;

  UPDATE public.cash_shifts
  SET
    primary_cashier_id = p_primary_cashier_id,
    secondary_cajas_enabled = v_secondary_enabled,
    secondary_caja_template_id = CASE WHEN v_secondary_enabled THEN v_template_id ELSE NULL END
  WHERE id = p_shift_id;

  UPDATE public.cash_shift_users
  SET can_use_caja = false,
      can_double_session = false
  WHERE shift_id = p_shift_id;

  UPDATE public.cash_shift_users
  SET can_use_caja = true,
      can_double_session = false
  WHERE shift_id = p_shift_id
    AND user_id = p_primary_cashier_id;

  UPDATE public.cash_shift_users csu
  SET can_use_caja = true,
      can_double_session = false
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = ANY(v_cashier_ids);

  IF v_secondary_enabled AND COALESCE(array_length(v_cashier_ids, 1), 0) > 0 THEN
    v_denoms := public.template_denoms_to_jsonb(v_template_id);

    FOREACH v_secondary_id IN ARRAY v_cashier_ids
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.cash_register_openings cro
        WHERE cro.shift_id = p_shift_id
          AND cro.cashier_id = v_secondary_id
          AND cro.status = 'abierta'
      ) THEN
        PERFORM public.internal_open_cash_register_for_cashier(
          p_shift_id,
          p_branch_id,
          v_secondary_id,
          v_denoms,
          'secondary'
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$$;

DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], integer);

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL,
  p_max_caja_sessions integer DEFAULT 1,
  p_primary_cashier_id uuid DEFAULT NULL,
  p_secondary_cajas_enabled boolean DEFAULT false,
  p_secondary_caja_template_id uuid DEFAULT NULL,
  p_secondary_cashier_ids uuid[] DEFAULT NULL
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
  v_normalized_max integer := GREATEST(1, LEAST(COALESCE(p_max_caja_sessions, 1), 10));
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
    AND NOT EXISTS (
      SELECT 1
      FROM public.cash_shift_users other_user
      JOIN public.cash_shifts other_shift ON other_shift.id = other_user.shift_id
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
    SELECT 1 FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto en la sucursal activa';
  END IF;

  INSERT INTO public.cash_shifts (
    id, cashier_id, branch_id, active_tables_count, status, caja_status, opened_at, max_caja_sessions,
    primary_cashier_id, secondary_cajas_enabled, secondary_caja_template_id
  )
  VALUES (
    v_shift_id, p_cashier_id, p_branch_id, GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN', 'UNOPENED', v_now, v_normalized_max,
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
    p_secondary_cashier_ids := COALESCE(p_secondary_cashier_ids, ARRAY[]::uuid[])
  );

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.internal_open_cash_register_for_cashier(uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.template_denoms_to_jsonb(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], integer, uuid, boolean, uuid, uuid[]) TO authenticated;

DROP FUNCTION IF EXISTS public.open_cash_register(uuid, uuid, uuid, jsonb);

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
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

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

NOTIFY pgrst, 'reload schema';
