-- Bloqueo de plantilla tras el primer cobro/actividad de la caja abierta.
-- Sin actividad: permitir cambio y reaplicar desglose/monto inicial desde la nueva plantilla.

CREATE OR REPLACE FUNCTION public.reapply_cash_opening_denoms_from_template(
  p_opening_id uuid,
  p_template_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening public.cash_register_openings%ROWTYPE;
  v_initial_total numeric(12,2) := 0;
BEGIN
  IF p_opening_id IS NULL OR p_template_id IS NULL THEN
    RAISE EXCEPTION 'opening_id y template_id son obligatorios';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.id = p_opening_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la apertura de caja';
  END IF;

  IF v_opening.status <> 'abierta' THEN
    RAISE EXCEPTION 'Solo se puede reaplicar plantilla en una caja abierta';
  END IF;

  IF public.cash_register_opening_has_activity(
    v_opening.id,
    v_opening.cashier_id,
    v_opening.shift_id,
    v_opening.opened_at
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la plantilla porque la caja ya tuvo cobros o movimientos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_denomination_exchanges cde
    WHERE cde.auxiliary_opening_id = v_opening.id
       OR cde.target_opening_id = v_opening.id
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la plantilla porque la caja ya tuvo cambios de denominaciones';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = p_template_id
      AND crt.branch_id = v_opening.branch_id
      AND crt.is_active = true
  ) THEN
    RAISE EXCEPTION 'La plantilla no pertenece a la sucursal o esta inactiva';
  END IF;

  DELETE FROM public.cash_shift_denoms
  WHERE opening_id = v_opening.id;

  INSERT INTO public.cash_shift_denoms (
    id, shift_id, cashier_id, opening_id, denomination_id, qty_initial, qty_current
  )
  SELECT
    gen_random_uuid(),
    v_opening.shift_id,
    v_opening.cashier_id,
    v_opening.id,
    d.id,
    GREATEST(0, COALESCE(crtd.qty, 0)),
    GREATEST(0, COALESCE(crtd.qty, 0))
  FROM public.denominations d
  LEFT JOIN public.cash_register_template_denoms crtd
    ON crtd.denomination_id = d.id
   AND crtd.template_id = p_template_id
  WHERE d.is_active = true;

  SELECT COALESCE(SUM(d.value * csd.qty_initial), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.opening_id = v_opening.id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total,
      updated_at = now()
  WHERE id = v_opening.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_shift_caja_configuration(
  p_shift_id uuid,
  p_branch_id uuid,
  p_primary_cashier_id uuid,
  p_secondary_cajas_enabled boolean,
  p_secondary_caja_template_id uuid,
  p_secondary_cashier_ids uuid[],
  p_secondary_caja_config jsonb DEFAULT NULL
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
  v_entry jsonb;
  v_config_user_id uuid;
  v_takeout_enabled boolean;
  v_express_enabled boolean;
  v_user_template_id uuid;
  v_target_template_id uuid;
  v_cashier_count integer := 0;
  v_prev_template_id uuid;
  v_opening_id uuid;
  v_opening_opened_at timestamptz;
  v_opening_cashier_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar caja en este turno';
  END IF;

  IF p_primary_cashier_id IS NOT NULL THEN
    v_cashier_count := v_cashier_count + 1;
  END IF;

  IF v_secondary_enabled THEN
    v_cashier_count := v_cashier_count + COALESCE(array_length(v_cashier_ids, 1), 0);
  ELSE
    v_cashier_ids := ARRAY[]::uuid[];
  END IF;

  IF v_cashier_count < 1 THEN
    RAISE EXCEPTION 'Debe habilitar al menos un cajero en la configuracion de caja (principal o secundario)';
  END IF;

  IF p_primary_cashier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_primary_cashier_id
      AND csu.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'El cajero principal debe estar habilitado en el turno';
  END IF;

  IF p_primary_cashier_id IS NOT NULL AND p_primary_cashier_id = ANY(v_cashier_ids) THEN
    RAISE EXCEPTION 'El cajero principal no puede ser tambien caja secundaria';
  END IF;

  IF (SELECT COUNT(DISTINCT x) FROM unnest(v_cashier_ids) AS x) <> COALESCE(array_length(v_cashier_ids, 1), 0) THEN
    RAISE EXCEPTION 'No puede repetir el mismo cajero en cajas secundarias';
  END IF;

  IF v_secondary_enabled
     AND COALESCE(array_length(v_cashier_ids, 1), 0) > 0
     AND v_template_id IS NULL THEN
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
  END IF;

  -- Validar / reaplicar plantillas de cajas ya abiertas antes de mutar asignaciones.
  IF COALESCE(jsonb_array_length(COALESCE(p_secondary_caja_config, '[]'::jsonb)), 0) > 0 THEN
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_secondary_caja_config, '[]'::jsonb))
    LOOP
      v_config_user_id := NULLIF(v_entry ->> 'user_id', '')::uuid;
      v_user_template_id := NULLIF(v_entry ->> 'template_id', '')::uuid;

      IF v_config_user_id IS NULL OR v_user_template_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT cro.id, cro.opened_at, cro.cashier_id, csu.secondary_caja_template_id
      INTO v_opening_id, v_opening_opened_at, v_opening_cashier_id, v_prev_template_id
      FROM public.cash_register_openings cro
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cro.shift_id
       AND csu.user_id = cro.cashier_id
      WHERE cro.shift_id = p_shift_id
        AND cro.cashier_id = v_config_user_id
        AND cro.status = 'abierta'
        AND COALESCE(cro.register_role, 'standard') <> 'auxiliary'
      ORDER BY cro.opened_at DESC
      LIMIT 1;

      IF v_opening_id IS NULL THEN
        CONTINUE;
      END IF;

      IF v_prev_template_id IS NOT DISTINCT FROM v_user_template_id THEN
        CONTINUE;
      END IF;

      IF public.cash_register_opening_has_activity(
        v_opening_id,
        v_opening_cashier_id,
        p_shift_id,
        v_opening_opened_at
      )
      OR EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.shift_id = p_shift_id
          AND p.created_by = v_opening_cashier_id
          AND p.created_at >= v_opening_opened_at
      ) THEN
        RAISE EXCEPTION 'No se puede cambiar la plantilla porque la caja ya tuvo cobros';
      END IF;

      PERFORM public.reapply_cash_opening_denoms_from_template(
        v_opening_id,
        v_user_template_id
      );
    END LOOP;
  END IF;

  UPDATE public.cash_shifts
  SET
    primary_cashier_id = p_primary_cashier_id,
    secondary_cajas_enabled = v_secondary_enabled,
    secondary_caja_template_id = CASE
      WHEN v_secondary_enabled AND COALESCE(array_length(v_cashier_ids, 1), 0) > 0 THEN v_template_id
      ELSE NULL
    END
  WHERE id = p_shift_id;

  -- Solo gestiona can_use_caja / alcance de caja. Preserva can_double_session.
  UPDATE public.cash_shift_users
  SET can_use_caja = false,
      secondary_caja_takeout_enabled = false,
      secondary_caja_express_enabled = false,
      secondary_caja_template_id = NULL
  WHERE shift_id = p_shift_id;

  IF p_primary_cashier_id IS NOT NULL THEN
    UPDATE public.cash_shift_users
    SET can_use_caja = true
    WHERE shift_id = p_shift_id
      AND user_id = p_primary_cashier_id;
  END IF;

  IF COALESCE(array_length(v_cashier_ids, 1), 0) > 0 THEN
    UPDATE public.cash_shift_users csu
    SET can_use_caja = true
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = ANY(v_cashier_ids);
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_secondary_caja_config, '[]'::jsonb)), 0) > 0 THEN
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_secondary_caja_config, '[]'::jsonb))
    LOOP
      v_config_user_id := NULLIF(v_entry ->> 'user_id', '')::uuid;
      v_takeout_enabled := COALESCE((v_entry ->> 'takeout_enabled')::boolean, false);
      v_express_enabled := COALESCE((v_entry ->> 'express_enabled')::boolean, false);
      v_user_template_id := NULLIF(v_entry ->> 'template_id', '')::uuid;

      IF v_config_user_id IS NULL THEN
        CONTINUE;
      END IF;

      IF p_primary_cashier_id IS NOT NULL AND v_config_user_id = p_primary_cashier_id THEN
        UPDATE public.cash_shift_users csu
        SET secondary_caja_template_id = v_user_template_id
        WHERE csu.shift_id = p_shift_id
          AND csu.user_id = v_config_user_id
          AND csu.can_use_caja = true;
      ELSE
        UPDATE public.cash_shift_users csu
        SET
          secondary_caja_takeout_enabled = v_takeout_enabled,
          secondary_caja_express_enabled = v_express_enabled,
          secondary_caja_template_id = v_user_template_id
        WHERE csu.shift_id = p_shift_id
          AND csu.user_id = v_config_user_id
          AND csu.can_use_caja = true
          AND (p_primary_cashier_id IS NULL OR csu.user_id <> p_primary_cashier_id);
      END IF;
    END LOOP;
  END IF;

  IF p_primary_cashier_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = p_shift_id
        AND cro.cashier_id = p_primary_cashier_id
        AND cro.status = 'abierta'
    ) THEN
      SELECT secondary_caja_template_id INTO v_target_template_id
      FROM public.cash_shift_users
      WHERE shift_id = p_shift_id AND user_id = p_primary_cashier_id;

      IF v_target_template_id IS NULL THEN
        v_target_template_id := v_template_id;
      END IF;

      IF v_target_template_id IS NOT NULL THEN
        v_denoms := public.template_denoms_to_jsonb(v_target_template_id);
      ELSE
        v_denoms := '[]'::jsonb;
      END IF;

      PERFORM public.internal_open_cash_register_for_cashier(
        p_shift_id,
        p_branch_id,
        p_primary_cashier_id,
        v_denoms,
        'primary'
      );
    END IF;
  END IF;

  IF v_secondary_enabled AND COALESCE(array_length(v_cashier_ids, 1), 0) > 0 THEN
    FOREACH v_secondary_id IN ARRAY v_cashier_ids
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.cash_register_openings cro
        WHERE cro.shift_id = p_shift_id
          AND cro.cashier_id = v_secondary_id
          AND cro.status = 'abierta'
      ) THEN
        SELECT secondary_caja_template_id INTO v_target_template_id
        FROM public.cash_shift_users
        WHERE shift_id = p_shift_id AND user_id = v_secondary_id;

        IF v_target_template_id IS NULL THEN
          v_target_template_id := v_template_id;
        END IF;

        IF v_target_template_id IS NOT NULL THEN
          v_denoms := public.template_denoms_to_jsonb(v_target_template_id);
        ELSE
          v_denoms := '[]'::jsonb;
        END IF;

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

CREATE OR REPLACE FUNCTION public.configure_auxiliary_cash_register(
  p_shift_id uuid,
  p_branch_id uuid,
  p_auxiliary_cashier_id uuid,
  p_auxiliary_template_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_cashier_id uuid;
  v_previous_template_id uuid;
  v_opening_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL
    OR p_auxiliary_cashier_id IS NULL OR p_auxiliary_template_id IS NULL
  THEN
    RAISE EXCEPTION 'Debe configurar responsable y plantilla para la caja auxiliar';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar la caja auxiliar';
  END IF;

  SELECT cs.auxiliary_cashier_id, cs.auxiliary_caja_template_id
  INTO v_previous_cashier_id, v_previous_template_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_auxiliary_cashier_id
      AND csu.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar debe estar habilitado en el turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = p_auxiliary_template_id
      AND crt.branch_id = p_branch_id
      AND crt.is_active = true
  ) THEN
    RAISE EXCEPTION 'La plantilla de la caja auxiliar no pertenece a la sucursal o está inactiva';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_auxiliary_cashier_id
      AND csu.can_use_caja = true
  ) OR EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.primary_cashier_id = p_auxiliary_cashier_id
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar no puede ser cajero del turno';
  END IF;

  IF v_previous_cashier_id IS DISTINCT FROM p_auxiliary_cashier_id
    AND EXISTS (
      SELECT 1
      FROM public.cash_denomination_exchanges cde
      WHERE cde.shift_id = p_shift_id
        AND cde.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'No se puede cambiar el responsable auxiliar mientras existan cambios activos';
  END IF;

  IF v_previous_cashier_id = p_auxiliary_cashier_id
    AND v_previous_template_id IS NOT NULL
    AND v_previous_template_id IS DISTINCT FROM p_auxiliary_template_id
  THEN
    SELECT cro.id
    INTO v_opening_id
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_auxiliary_cashier_id
      AND cro.register_role = 'auxiliary'
      AND cro.status = 'abierta'
    ORDER BY cro.created_at DESC
    LIMIT 1;

    IF v_opening_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.cash_denomination_exchanges cde
        WHERE cde.auxiliary_opening_id = v_opening_id
           OR cde.target_opening_id = v_opening_id
      ) THEN
        RAISE EXCEPTION 'No se puede cambiar la plantilla porque la caja auxiliar ya tuvo cambios';
      END IF;

      PERFORM public.reapply_cash_opening_denoms_from_template(
        v_opening_id,
        p_auxiliary_template_id
      );
    END IF;
  END IF;

  IF v_previous_cashier_id IS DISTINCT FROM p_auxiliary_cashier_id THEN
    UPDATE public.cash_register_openings
    SET status = 'cerrada',
        closed_at = COALESCE(closed_at, now()),
        notes = COALESCE(notes, 'Cierre por cambio de responsable auxiliar')
    WHERE shift_id = p_shift_id
      AND cashier_id = v_previous_cashier_id
      AND register_role = 'auxiliary'
      AND status = 'abierta';
  END IF;

  UPDATE public.cash_shift_users
  SET can_exchange_cash = false
  WHERE shift_id = p_shift_id;

  UPDATE public.cash_shift_users
  SET can_exchange_cash = true,
      can_use_caja = false,
      can_double_session = false
  WHERE shift_id = p_shift_id
    AND user_id = p_auxiliary_cashier_id;

  UPDATE public.cash_shifts
  SET auxiliary_cashier_id = p_auxiliary_cashier_id,
      auxiliary_caja_template_id = p_auxiliary_template_id
  WHERE id = p_shift_id;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_auxiliary_cashier_id
    AND cro.register_role = 'auxiliary'
    AND (
      v_previous_cashier_id = p_auxiliary_cashier_id
      OR cro.status = 'abierta'
    )
  ORDER BY cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    v_opening_id := public.internal_open_auxiliary_cash_register(
      p_shift_id,
      p_branch_id,
      p_auxiliary_cashier_id,
      p_auxiliary_template_id
    );
  END IF;

  RETURN v_opening_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reapply_cash_opening_denoms_from_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_auxiliary_cash_register(uuid, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
