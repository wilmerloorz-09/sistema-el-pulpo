-- lote-04-reemplazo-cajero
-- Ejecutar en Supabase SQL Editor (produccion)
-- Fecha: 2026-08-30

-- ===== 20260828120000_replace_shift_cashier.sql =====
-- Reemplazo operativo de cajero mid-turno: transfiere la caja abierta (apertura,
-- denominaciones, sesiÃ³n) a otro usuario habilitado sin otra caja. El cajero saliente
-- conserva el resto de permisos del turno; los cobros histÃ³ricos mantienen created_by.

CREATE OR REPLACE FUNCTION public.cash_register_opening_has_activity(
  p_opening_id uuid,
  p_cashier_id uuid,
  p_shift_id uuid,
  p_opened_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.shift_id = p_shift_id
        AND p.created_by = p_cashier_id
        AND p.created_at >= p_opened_at
        AND p.status <> 'voided'
    )
    OR EXISTS (
      SELECT 1
      FROM public.cash_register_movements crm
      WHERE crm.shift_id = p_shift_id
        AND crm.recorded_by = p_cashier_id
        AND crm.created_at >= p_opened_at
    )
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_denoms csd
      WHERE csd.opening_id = p_opening_id
        AND csd.qty_current IS DISTINCT FROM csd.qty_initial
    );
$$;

CREATE OR REPLACE FUNCTION public.get_shift_cashier_replace_eligibility(
  p_shift_id uuid,
  p_branch_id uuid
)
RETURNS TABLE (
  cashier_id uuid,
  opening_id uuid,
  has_activity boolean,
  can_replace boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar este turno';
  END IF;

  RETURN QUERY
  SELECT
    cro.cashier_id,
    cro.id AS opening_id,
    public.cash_register_opening_has_activity(
      cro.id,
      cro.cashier_id,
      cro.shift_id,
      cro.opened_at
    ) AS has_activity,
    (
      csu.can_use_caja = true
      AND public.cash_register_opening_has_activity(
        cro.id,
        cro.cashier_id,
        cro.shift_id,
        cro.opened_at
      )
    ) AS can_replace
  FROM public.cash_register_openings cro
  JOIN public.cash_shift_users csu
    ON csu.shift_id = cro.shift_id
   AND csu.user_id = cro.cashier_id
   AND csu.is_enabled = true
  WHERE cro.shift_id = p_shift_id
    AND cro.branch_id = p_branch_id
    AND cro.status = 'abierta';
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_shift_cashier(
  p_shift_id uuid,
  p_branch_id uuid,
  p_outgoing_cashier_id uuid,
  p_incoming_cashier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening public.cash_register_openings%ROWTYPE;
  v_outgoing_csu public.cash_shift_users%ROWTYPE;
  v_incoming_csu public.cash_shift_users%ROWTYPE;
  v_was_primary boolean := false;
  v_actor_id uuid := auth.uid();
  v_outgoing_name text;
  v_incoming_name text;
  v_actor_name text;
BEGIN
  IF p_shift_id IS NULL
     OR p_branch_id IS NULL
     OR p_outgoing_cashier_id IS NULL
     OR p_incoming_cashier_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, branch_id, cajero saliente y cajero entrante son obligatorios';
  END IF;

  IF p_outgoing_cashier_id = p_incoming_cashier_id THEN
    RAISE EXCEPTION 'El cajero entrante debe ser distinto al cajero saliente';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para reemplazar cajeros en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Solo se puede reemplazar cajero en un turno abierto';
  END IF;

  SELECT *
  INTO v_outgoing_csu
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = p_outgoing_cashier_id
  FOR UPDATE;

  IF NOT FOUND OR v_outgoing_csu.is_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero saliente no esta habilitado en este turno';
  END IF;

  IF v_outgoing_csu.can_use_caja IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero saliente no tiene una caja asignada en este turno';
  END IF;

  SELECT *
  INTO v_incoming_csu
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = p_incoming_cashier_id
  FOR UPDATE;

  IF NOT FOUND OR v_incoming_csu.is_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero entrante debe estar habilitado en el turno';
  END IF;

  IF v_incoming_csu.can_use_caja IS TRUE THEN
    RAISE EXCEPTION 'El cajero entrante ya tiene otra caja en este turno';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_incoming_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'El cajero entrante ya tiene una caja abierta en este turno';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.branch_id = p_branch_id
    AND cro.cashier_id = p_outgoing_cashier_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cajero saliente no tiene una caja abierta';
  END IF;

  IF NOT public.cash_register_opening_has_activity(
    v_opening.id,
    v_opening.cashier_id,
    v_opening.shift_id,
    v_opening.opened_at
  ) THEN
    RAISE EXCEPTION 'Solo se puede reemplazar una caja abierta que haya tenido actividad';
  END IF;

  SELECT (cs.primary_cashier_id = p_outgoing_cashier_id)
  INTO v_was_primary
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
  FOR UPDATE;

  UPDATE public.cash_register_openings
  SET cashier_id = p_incoming_cashier_id,
      updated_at = now()
  WHERE id = v_opening.id;

  UPDATE public.cash_shift_denoms
  SET cashier_id = p_incoming_cashier_id
  WHERE opening_id = v_opening.id
     OR (
       shift_id = p_shift_id
       AND cashier_id = p_outgoing_cashier_id
       AND opening_id IS NULL
     );

  UPDATE public.cash_shift_users
  SET
    can_use_caja = true,
    secondary_caja_template_id = v_outgoing_csu.secondary_caja_template_id,
    secondary_caja_takeout_enabled = v_outgoing_csu.secondary_caja_takeout_enabled,
    secondary_caja_express_enabled = v_outgoing_csu.secondary_caja_express_enabled,
    caja_session_slots = v_outgoing_csu.caja_session_slots,
    last_session_id = v_outgoing_csu.last_session_id,
    secondary_session_id = v_outgoing_csu.secondary_session_id
  WHERE id = v_incoming_csu.id;

  UPDATE public.cash_shift_users
  SET
    can_use_caja = false,
    secondary_caja_template_id = NULL,
    secondary_caja_takeout_enabled = false,
    secondary_caja_express_enabled = false,
    caja_session_slots = '{}'::text[],
    last_session_id = NULL,
    secondary_session_id = NULL
  WHERE id = v_outgoing_csu.id;

  PERFORM public.sync_caja_session_legacy_columns(v_incoming_csu.id);
  PERFORM public.sync_caja_session_legacy_columns(v_outgoing_csu.id);

  IF v_was_primary THEN
    UPDATE public.cash_shifts
    SET primary_cashier_id = p_incoming_cashier_id
    WHERE id = p_shift_id;
  END IF;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_outgoing_name
  FROM public.profiles p
  WHERE p.id = p_outgoing_cashier_id;

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_incoming_name
  FROM public.profiles p
  WHERE p.id = p_incoming_cashier_id;

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.audit_log (
    user_id,
    action,
    entity,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    v_actor_id,
    'SHIFT_CASHIER_REPLACED',
    'cash_shifts',
    p_shift_id::text,
    jsonb_build_object(
      'cashier_id', p_outgoing_cashier_id,
      'cashier_name', v_outgoing_name,
      'opening_id', v_opening.id,
      'can_use_caja', true,
      'was_primary', v_was_primary
    ),
    jsonb_build_object(
      'shift_id', p_shift_id,
      'branch_id', p_branch_id,
      'opening_id', v_opening.id,
      'outgoing_cashier_id', p_outgoing_cashier_id,
      'outgoing_cashier_name', v_outgoing_name,
      'incoming_cashier_id', p_incoming_cashier_id,
      'incoming_cashier_name', v_incoming_name,
      'was_primary', v_was_primary,
      'replaced_at', now(),
      'actor_auth_uid', v_actor_id,
      'actor_name', v_actor_name
    )
  );

  RETURN jsonb_build_object(
    'opening_id', v_opening.id,
    'outgoing_cashier_id', p_outgoing_cashier_id,
    'incoming_cashier_id', p_incoming_cashier_id,
    'was_primary', v_was_primary
  );
END;
$$;

CREATE OR REPLACE VIEW public.v_audit_shifts AS
SELECT
  al.id          AS audit_id,
  al.created_at  AS event_at,
  al.action,
  al.entity_id   AS shift_id,
  p.full_name    AS actor_name,
  p.username     AS actor_username,
  p.email        AS actor_email,
  b.name         AS branch_name,
  al.before_data,
  al.after_data
FROM public.audit_log al
LEFT JOIN public.profiles p ON p.id = al.user_id
LEFT JOIN public.branches b ON b.id = (al.after_data->>'branch_id')::uuid
WHERE al.entity = 'cash_shifts'
  AND al.action IN ('SHIFT_OPENED', 'SHIFT_CLOSED', 'SHIFT_CASHIER_REPLACED')
ORDER BY al.created_at DESC;

GRANT SELECT ON public.v_audit_shifts TO authenticated;

CREATE OR REPLACE FUNCTION public.list_shift_cashier_replacement_audit(
  p_shift_id uuid,
  p_branch_id uuid
)
RETURNS TABLE (
  audit_id uuid,
  event_at timestamptz,
  actor_name text,
  outgoing_cashier_name text,
  incoming_cashier_name text,
  was_primary boolean,
  opening_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para consultar la auditoria de este turno';
  END IF;

  RETURN QUERY
  SELECT
    al.id AS audit_id,
    al.created_at AS event_at,
    COALESCE(
      al.after_data->>'actor_name',
      NULLIF(TRIM(actor.full_name), ''),
      actor.alias,
      actor.username,
      'Sin nombre'
    )::text AS actor_name,
    COALESCE(
      al.before_data->>'cashier_name',
      al.after_data->>'outgoing_cashier_name',
      'Sin nombre'
    )::text AS outgoing_cashier_name,
    COALESCE(
      al.after_data->>'incoming_cashier_name',
      'Sin nombre'
    )::text AS incoming_cashier_name,
    COALESCE((al.after_data->>'was_primary')::boolean, false) AS was_primary,
    NULLIF(al.after_data->>'opening_id', '')::uuid AS opening_id
  FROM public.audit_log al
  LEFT JOIN public.profiles actor ON actor.id = al.user_id
  WHERE al.entity = 'cash_shifts'
    AND al.action = 'SHIFT_CASHIER_REPLACED'
    AND al.after_data->>'shift_id' = p_shift_id::text
    AND al.after_data->>'branch_id' = p_branch_id::text
  ORDER BY al.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_cashier_replacement_audit(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.cash_register_opening_has_activity(uuid, uuid, uuid, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_cashier_replace_eligibility(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_shift_cashier(uuid, uuid, uuid, uuid)
  TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;



-- ===== 20260828220000_replace_shift_cashier_clearer_errors.sql =====
-- Mensajes de error mas claros al reemplazar cajero.

CREATE OR REPLACE FUNCTION public.replace_shift_cashier(
  p_shift_id uuid,
  p_branch_id uuid,
  p_outgoing_cashier_id uuid,
  p_incoming_cashier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening public.cash_register_openings%ROWTYPE;
  v_outgoing_csu public.cash_shift_users%ROWTYPE;
  v_incoming_csu public.cash_shift_users%ROWTYPE;
  v_was_primary boolean := false;
  v_actor_id uuid := auth.uid();
  v_outgoing_name text;
  v_incoming_name text;
  v_actor_name text;
BEGIN
  IF p_shift_id IS NULL
     OR p_branch_id IS NULL
     OR p_outgoing_cashier_id IS NULL
     OR p_incoming_cashier_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, branch_id, cajero saliente y cajero entrante son obligatorios';
  END IF;

  IF p_outgoing_cashier_id = p_incoming_cashier_id THEN
    RAISE EXCEPTION 'El cajero entrante debe ser distinto al cajero saliente';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para reemplazar cajeros en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Solo se puede reemplazar cajero en un turno abierto';
  END IF;

  SELECT *
  INTO v_outgoing_csu
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = p_outgoing_cashier_id
  FOR UPDATE;

  IF NOT FOUND OR v_outgoing_csu.is_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero saliente no esta habilitado en este turno';
  END IF;

  IF v_outgoing_csu.can_use_caja IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero saliente no tiene una caja asignada en este turno';
  END IF;

  SELECT *
  INTO v_incoming_csu
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = p_shift_id
    AND csu.user_id = p_incoming_cashier_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'El cajero entrante no esta registrado en el turno. Guarda la configuracion del turno e intenta de nuevo.';
  END IF;

  IF v_incoming_csu.is_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El cajero entrante no esta habilitado en el turno';
  END IF;

  IF v_incoming_csu.can_use_caja IS TRUE THEN
    RAISE EXCEPTION 'El cajero entrante ya tiene otra caja en este turno';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_incoming_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'El cajero entrante ya tiene una caja abierta en este turno';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.branch_id = p_branch_id
    AND cro.cashier_id = p_outgoing_cashier_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cajero saliente no tiene una caja abierta';
  END IF;

  IF NOT public.cash_register_opening_has_activity(
    v_opening.id,
    v_opening.cashier_id,
    v_opening.shift_id,
    v_opening.opened_at
  ) THEN
    RAISE EXCEPTION 'Solo se puede reemplazar una caja abierta que haya tenido actividad';
  END IF;

  SELECT (cs.primary_cashier_id = p_outgoing_cashier_id)
  INTO v_was_primary
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
  FOR UPDATE;

  UPDATE public.cash_register_openings
  SET cashier_id = p_incoming_cashier_id,
      updated_at = now()
  WHERE id = v_opening.id;

  UPDATE public.cash_shift_denoms
  SET cashier_id = p_incoming_cashier_id
  WHERE opening_id = v_opening.id
     OR (
       shift_id = p_shift_id
       AND cashier_id = p_outgoing_cashier_id
       AND opening_id IS NULL
     );

  UPDATE public.cash_shift_users
  SET
    can_use_caja = true,
    secondary_caja_template_id = v_outgoing_csu.secondary_caja_template_id,
    secondary_caja_takeout_enabled = v_outgoing_csu.secondary_caja_takeout_enabled,
    secondary_caja_express_enabled = v_outgoing_csu.secondary_caja_express_enabled,
    caja_session_slots = v_outgoing_csu.caja_session_slots,
    last_session_id = v_outgoing_csu.last_session_id,
    secondary_session_id = v_outgoing_csu.secondary_session_id
  WHERE id = v_incoming_csu.id;

  UPDATE public.cash_shift_users
  SET
    can_use_caja = false,
    secondary_caja_template_id = NULL,
    secondary_caja_takeout_enabled = false,
    secondary_caja_express_enabled = false,
    caja_session_slots = '{}'::text[],
    last_session_id = NULL,
    secondary_session_id = NULL
  WHERE id = v_outgoing_csu.id;

  PERFORM public.sync_caja_session_legacy_columns(v_incoming_csu.id);
  PERFORM public.sync_caja_session_legacy_columns(v_outgoing_csu.id);

  IF v_was_primary THEN
    UPDATE public.cash_shifts
    SET primary_cashier_id = p_incoming_cashier_id
    WHERE id = p_shift_id;
  END IF;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_outgoing_name
  FROM public.profiles p
  WHERE p.id = p_outgoing_cashier_id;

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_incoming_name
  FROM public.profiles p
  WHERE p.id = p_incoming_cashier_id;

  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'Sin nombre')
  INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.audit_log (
    user_id,
    action,
    entity,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    v_actor_id,
    'SHIFT_CASHIER_REPLACED',
    'cash_shifts',
    p_shift_id::text,
    jsonb_build_object(
      'cashier_id', p_outgoing_cashier_id,
      'cashier_name', v_outgoing_name,
      'opening_id', v_opening.id,
      'can_use_caja', true,
      'was_primary', v_was_primary
    ),
    jsonb_build_object(
      'shift_id', p_shift_id,
      'branch_id', p_branch_id,
      'opening_id', v_opening.id,
      'outgoing_cashier_id', p_outgoing_cashier_id,
      'outgoing_cashier_name', v_outgoing_name,
      'incoming_cashier_id', p_incoming_cashier_id,
      'incoming_cashier_name', v_incoming_name,
      'was_primary', v_was_primary,
      'replaced_at', now(),
      'actor_auth_uid', v_actor_id,
      'actor_name', v_actor_name
    )
  );

  RETURN jsonb_build_object(
    'opening_id', v_opening.id,
    'outgoing_cashier_id', p_outgoing_cashier_id,
    'incoming_cashier_id', p_incoming_cashier_id,
    'was_primary', v_was_primary
  );
END;
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;



-- ===== 20260828230000_opening_payment_count_after_cashier_replace.sql =====
-- Conteo de cobros por apertura: incluye pagos del cajero anterior tras reemplazo.

CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  RETURN QUERY
  SELECT
    cro.id,
    cro.shift_id,
    cro.status,
    cro.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    cro.notes,
    cro.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    cro.anulada_at,
    cro.motivo_anulacion,
    (cro.cashier_id = auth.uid() AND cro.status = 'abierta') AS is_current,
    (
      SELECT COUNT(*)::integer
      FROM public.payments p
      WHERE p.created_at >= cro.opened_at
        AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = p_shift_id
        )
        AND (
          p.created_by = cro.cashier_id
          OR NOT EXISTS (
            SELECT 1
            FROM public.cash_register_openings cro_other
            WHERE cro_other.shift_id = p_shift_id
              AND cro_other.status = 'abierta'
              AND cro_other.cashier_id = p.created_by
              AND cro_other.id <> cro.id
          )
        )
    ) AS payment_count
  FROM public.cash_register_openings cro
  JOIN public.profiles cashier
    ON cashier.id = cro.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = cro.anulada_por
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC;
END;
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;



-- ===== 20260828240000_get_register_opening_collected_payments.sql =====
-- Cobros del resumen de caja por apertura (incluye cajero anterior tras reemplazo).

CREATE OR REPLACE FUNCTION public.payment_belongs_to_register_opening(
  p_payment_id uuid,
  p_opening_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    JOIN public.payments p ON p.id = p_payment_id
    WHERE cro.id = p_opening_id
      AND p.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
      AND COALESCE(p.status, '') NOT IN ('voided', 'reversed')
      AND (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = cro.shift_id
        )
        OR p.shift_id = cro.shift_id
        OR EXISTS (
          SELECT 1
          FROM public.cash_movements cm
          WHERE cm.payment_id = p.id
            AND cm.shift_id = cro.shift_id
        )
      )
      AND (
        p.created_by = cro.cashier_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.cash_register_openings cro_other
          WHERE cro_other.shift_id = cro.shift_id
            AND cro_other.status = 'abierta'
            AND cro_other.cashier_id = p.created_by
            AND cro_other.id <> cro.id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_register_opening_collected_payments(
  p_opening_id uuid
)
RETURNS TABLE (
  id uuid,
  amount numeric,
  payment_method_id uuid,
  created_at timestamptz,
  created_by uuid,
  notes text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening public.cash_register_openings%ROWTYPE;
BEGIN
  IF p_opening_id IS NULL THEN
    RAISE EXCEPTION 'opening_id es obligatorio';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.id = p_opening_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la apertura de caja solicitada';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_opening.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = v_opening.shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver los cobros de esta apertura';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.amount,
    p.payment_method_id,
    p.created_at,
    p.created_by,
    p.notes,
    p.status
  FROM public.payments p
  WHERE public.payment_belongs_to_register_opening(p.id, p_opening_id)
  ORDER BY p.created_at ASC, p.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_belongs_to_register_opening(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_belongs_to_register_opening(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_register_opening_collected_payments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_opening_collected_payments(uuid) TO authenticated;

-- payment_count: mismo criterio ampliado (orden, shift_id o movimiento de caja).
CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  RETURN QUERY
  SELECT
    cro.id,
    cro.shift_id,
    cro.status,
    cro.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    cro.notes,
    cro.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    cro.anulada_at,
    cro.motivo_anulacion,
    (cro.cashier_id = auth.uid() AND cro.status = 'abierta') AS is_current,
    (
      SELECT COUNT(*)::integer
      FROM public.payments p
      WHERE public.payment_belongs_to_register_opening(p.id, cro.id)
    ) AS payment_count
  FROM public.cash_register_openings cro
  JOIN public.profiles cashier
    ON cashier.id = cro.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = cro.anulada_por
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC;
END;
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;



-- ===== 20260828250000_opening_payment_exclude_only_after_other_open.sql =====
-- Cobros del cajero saliente: no excluir por su nueva caja si el pago fue ANTES de esa apertura.

CREATE OR REPLACE FUNCTION public.payment_belongs_to_register_opening(
  p_payment_id uuid,
  p_opening_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    JOIN public.payments p ON p.id = p_payment_id
    WHERE cro.id = p_opening_id
      AND p.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
      AND COALESCE(p.status, '') NOT IN ('voided', 'reversed')
      AND (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = cro.shift_id
        )
        OR p.shift_id = cro.shift_id
        OR EXISTS (
          SELECT 1
          FROM public.cash_movements cm
          WHERE cm.payment_id = p.id
            AND cm.shift_id = cro.shift_id
        )
      )
      AND (
        p.created_by = cro.cashier_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.cash_register_openings cro_other
          WHERE cro_other.shift_id = cro.shift_id
            AND cro_other.status = 'abierta'
            AND cro_other.cashier_id = p.created_by
            AND cro_other.id <> cro.id
            AND p.created_at >= cro_other.opened_at
        )
      )
  );
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;




