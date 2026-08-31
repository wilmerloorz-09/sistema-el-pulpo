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
