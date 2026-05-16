-- Cupo global de terminales Caja (suma de sesiones activas) alineado con max_caja_sessions del turno.

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
           GREATEST(1, LEAST(COALESCE(cs.max_caja_sessions, 1), 10)) AS cap
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

GRANT EXECUTE ON FUNCTION public.get_caja_shift_terminal_usage(uuid) TO authenticated;

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

  SELECT GREATEST(1, LEAST(COALESCE(cs.max_caja_sessions, 1), 10))
  INTO v_shift_cap
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF v_shift_cap IS NULL THEN
    v_shift_cap := 1;
  END IF;

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

  WITH keeper_ids AS (
    SELECT csu.id
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND COALESCE(csu.can_use_caja, false)
    ORDER BY csu.user_id
    LIMIT v_normalized
  ),
  to_strip AS (
    SELECT csu.id
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND COALESCE(csu.can_use_caja, false)
      AND NOT EXISTS (SELECT 1 FROM keeper_ids k WHERE k.id = csu.id)
  )
  UPDATE public.cash_shift_users u
  SET
    can_use_caja = false,
    can_double_session = false,
    caja_session_slots = '{}'::text[],
    last_session_id = NULL,
    secondary_session_id = NULL,
    updated_at = now()
  FROM to_strip t
  WHERE u.id = t.id;

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

NOTIFY pgrst, 'reload schema';
