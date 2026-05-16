-- Numero simultaneo de sesiones del modulo Caja (terminales/dispositivos) por usuario autorizado en el turno.

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS max_caja_sessions integer NOT NULL DEFAULT 1;

ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_max_caja_sessions_check;

ALTER TABLE public.cash_shifts
  ADD CONSTRAINT cash_shifts_max_caja_sessions_check
  CHECK (max_caja_sessions >= 1 AND max_caja_sessions <= 10);

UPDATE public.cash_shifts
SET max_caja_sessions = GREATEST(1, LEAST(max_caja_sessions, 10));

UPDATE public.cash_shifts cs
SET max_caja_sessions = GREATEST(max_caja_sessions, 2)
WHERE EXISTS (
  SELECT 1
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = cs.id
    AND COALESCE(csu.can_double_session, false) IS TRUE
);

ALTER TABLE public.cash_shift_users
  ADD COLUMN IF NOT EXISTS caja_session_slots text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.cash_shift_users csu
SET caja_session_slots =
  CASE
    WHEN csu.last_session_id IS NOT NULL
      AND NULLIF(btrim(csu.last_session_id::text), '') IS NOT NULL
      AND csu.secondary_session_id IS NOT NULL
      AND NULLIF(btrim(csu.secondary_session_id::text), '') IS NOT NULL
      AND csu.secondary_session_id IS DISTINCT FROM csu.last_session_id
    THEN ARRAY[csu.last_session_id, csu.secondary_session_id]
    WHEN csu.last_session_id IS NOT NULL AND NULLIF(btrim(csu.last_session_id::text), '') IS NOT NULL
    THEN ARRAY[csu.last_session_id]
    WHEN csu.secondary_session_id IS NOT NULL AND NULLIF(btrim(csu.secondary_session_id::text), '') IS NOT NULL
    THEN ARRAY[csu.secondary_session_id]
    ELSE '{}'::text[]
  END;

CREATE OR REPLACE FUNCTION public.sync_caja_session_legacy_columns(p_cash_shift_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slots text[];
BEGIN
  SELECT COALESCE(csu.caja_session_slots, '{}'::text[])
  INTO v_slots
  FROM public.cash_shift_users csu
  WHERE csu.id = p_cash_shift_user_id;

  IF COALESCE(cardinality(v_slots), 0) = 0 THEN
    UPDATE public.cash_shift_users
    SET
      last_session_id = NULL,
      secondary_session_id = NULL
    WHERE id = p_cash_shift_user_id;
    RETURN;
  END IF;

  UPDATE public.cash_shift_users
  SET
    last_session_id = v_slots[1],
    secondary_session_id =
      CASE
        WHEN COALESCE(cardinality(v_slots), 0) >= 2 THEN v_slots[cardinality(v_slots)]
        ELSE NULL
      END
  WHERE id = p_cash_shift_user_id;
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
  v_max integer;
  v_trim text := NULLIF(btrim(COALESCE(p_session_id, '')), '');
  v_slots text[];
  v_new text[];
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

  SELECT GREATEST(1, LEAST(COALESCE(cs.max_caja_sessions, 1), 10))
  INTO v_max
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF v_max IS NULL THEN
    v_max := 1;
  END IF;

  IF COALESCE(v_shift_user.can_double_session, false) IS NOT TRUE THEN
    v_max := 1;
  END IF;

  v_slots := COALESCE(v_shift_user.caja_session_slots, '{}'::text[]);

  IF COALESCE(cardinality(v_slots), 0) > 0 AND v_trim = ANY (v_slots) THEN
    NULL;
  ELSE
    v_new := v_slots || v_trim;

    WHILE COALESCE(cardinality(v_new), 0) > v_max LOOP
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

GRANT EXECUTE ON FUNCTION public.claim_cash_session_slot(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_shift_max_caja_sessions(
  p_branch_id uuid,
  p_shift_id uuid,
  p_max_caja_sessions integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_normalized integer := GREATEST(1, LEAST(COALESCE(p_max_caja_sessions, 1), 10));
  r record;
BEGIN
  IF p_branch_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'branch_id y shift_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar esta sucursal';
  END IF;

  SELECT cs.branch_id
  INTO v_branch
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.status = 'OPEN';

  IF v_branch IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'El turno no pertenece a la sucursal indicada';
  END IF;

  UPDATE public.cash_shifts
  SET max_caja_sessions = v_normalized
  WHERE id = p_shift_id;

  UPDATE public.cash_shift_users csu
  SET
    can_double_session = (v_normalized > 1) AND COALESCE(csu.can_use_caja, false),
    caja_session_slots =
      CASE
        WHEN COALESCE(array_length(COALESCE(csu.caja_session_slots, '{}'::text[]), 1), 0) <= v_normalized
          THEN COALESCE(csu.caja_session_slots, '{}'::text[])
        ELSE csu.caja_session_slots[
          (
            array_length(COALESCE(csu.caja_session_slots, '{}'::text[]), 1)
            - v_normalized + 1
          ):array_length(COALESCE(csu.caja_session_slots, '{}'::text[]), 1)
        ]
      END
  WHERE csu.shift_id = p_shift_id
    AND COALESCE(csu.can_use_caja, false) IS TRUE;

  FOR r IN
    SELECT id FROM public.cash_shift_users WHERE shift_id = p_shift_id
  LOOP
    PERFORM public.sync_caja_session_legacy_columns(r.id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.configure_shift_max_caja_sessions(uuid, uuid, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]);

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL,
  p_max_caja_sessions integer DEFAULT 1
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
      OR EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = enabled_user.user_id
          AND ubr.branch_id = p_branch_id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
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
    opened_at,
    max_caja_sessions
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    'UNOPENED',
    v_now,
    v_normalized_max
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
      is_supervisor
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
      (v_normalized_max > 1) AND COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.is_supervisor, false)
    );
  END LOOP;

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
