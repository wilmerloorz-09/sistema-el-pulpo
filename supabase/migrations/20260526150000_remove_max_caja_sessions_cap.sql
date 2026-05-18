-- El cupo de cajas viene de la configuracion principal + secundarias (can_use_caja en turno),
-- no del campo legacy max_caja_sessions ni del trigger por terminales.

DROP TRIGGER IF EXISTS trg_enforce_shift_caja_user_terminal_cap_insert ON public.cash_shift_users;
DROP TRIGGER IF EXISTS trg_enforce_shift_caja_user_terminal_cap_update ON public.cash_shift_users;
DROP FUNCTION IF EXISTS public.enforce_shift_caja_user_terminal_cap();

CREATE OR REPLACE FUNCTION public.shift_caja_terminal_cap(p_shift_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    1,
    LEAST(
      COALESCE((
        SELECT COUNT(*)::integer
        FROM public.cash_shift_users csu
        WHERE csu.shift_id = p_shift_id
          AND COALESCE(csu.is_enabled, false)
          AND COALESCE(csu.can_use_caja, false)
      ), 1),
      10
    )
  );
$$;

REVOKE ALL ON FUNCTION public.shift_caja_terminal_cap(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_caja_terminal_cap(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_caja_shift_terminal_usage(p_branch_id uuid)
RETURNS TABLE (
  shift_id uuid,
  shift_max integer,
  global_sessions_used integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT cs.id AS sid,
           public.shift_caja_terminal_cap(cs.id) AS cap
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  usage AS (
    SELECT COALESCE(SUM(cardinality(COALESCE(csu.caja_session_slots, '{}'::text[]))), 0)::integer AS n
    FROM public.cash_shift_users csu
    INNER JOIN s ON csu.shift_id = s.sid
    WHERE csu.is_enabled = true
      AND csu.can_use_caja = true
  )
  SELECT s.sid,
         s.cap::integer,
         COALESCE(usage.n, 0)::integer
  FROM s
  CROSS JOIN usage;
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

DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], integer, uuid, boolean, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], integer);
DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]);

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL,
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
  v_operational_user_count integer := 0;
  v_blocked_users text;
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
    p_secondary_cashier_ids := COALESCE(p_secondary_cashier_ids, ARRAY[]::uuid[])
  );

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cash_session_slot(
  p_shift_id uuid,
  p_session_id text
)
RETURNS TABLE (
  last_session_id text,
  secondary_session_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shift_user public.cash_shift_users%ROWTYPE;
  v_shift_cap integer;
  v_global_used integer;
  v_trim text := NULLIF(btrim(COALESCE(p_session_id, '')), '');
  v_slots text[];
  v_new text[];
  v_per_user_max integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para tomar el control de Caja.';
  END IF;

  IF p_shift_id IS NULL OR v_trim IS NULL THEN
    RAISE EXCEPTION 'El turno y la sesion son obligatorios.';
  END IF;

  SELECT csu.*
  INTO v_shift_user
  FROM public.cash_shift_users csu
  INNER JOIN public.cash_shifts cs
    ON cs.id = csu.shift_id
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = v_actor_id
    AND cs.status = 'OPEN'
    AND csu.is_enabled = true
    AND csu.can_use_caja = true
  FOR UPDATE OF csu;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu usuario no tiene permiso de Caja en este turno.';
  END IF;

  v_shift_cap := public.shift_caja_terminal_cap(p_shift_id);

  SELECT COALESCE(SUM(cardinality(COALESCE(csu.caja_session_slots, '{}'::text[]))), 0)::integer
  INTO v_global_used
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = p_shift_id
    AND csu.is_enabled = true
    AND csu.can_use_caja = true;

  v_slots := COALESCE(v_shift_user.caja_session_slots, '{}'::text[]);

  IF COALESCE(cardinality(v_slots), 0) > 0 AND v_trim = ANY (v_slots) THEN
    NULL;
  ELSE
    IF v_global_used >= v_shift_cap THEN
      RAISE EXCEPTION 'No hay cupo para mas terminales de Caja en este turno.';
    END IF;

    v_new := v_slots || v_trim;

    IF COALESCE(v_shift_user.can_double_session, false) IS TRUE THEN
      v_per_user_max := LEAST(v_shift_cap, 2);
    ELSE
      v_per_user_max := 1;
    END IF;

    WHILE COALESCE(cardinality(v_new), 0) > v_per_user_max LOOP
      IF COALESCE(cardinality(v_new), 0) <= 1 THEN
        v_new := '{}'::text[];
      ELSE
        v_new := v_new[2:array_upper(v_new, 1)];
      END IF;
    END LOOP;

    UPDATE public.cash_shift_users
    SET caja_session_slots = v_new
    WHERE id = v_shift_user.id;

    PERFORM public.sync_caja_session_legacy_columns(v_shift_user.id);
  END IF;

  RETURN QUERY
  SELECT csu.last_session_id, csu.secondary_session_id
  FROM public.cash_shift_users csu
  WHERE csu.id = v_shift_user.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], uuid, boolean, uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
