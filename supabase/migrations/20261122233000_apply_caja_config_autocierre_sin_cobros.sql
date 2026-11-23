-- Paso 1 prevención cajas huérfanas:
-- Al reconfigurar caja del turno, si un cajero pierde can_use_caja y tiene
-- apertura abierta sin cobros/movimientos → auto-cerrar.
-- Si ya hubo actividad → bloquear y exigir reemplazo o cierre formal.

CREATE OR REPLACE FUNCTION public.apply_shift_caja_configuration(
  p_shift_id uuid,
  p_branch_id uuid,
  p_primary_cashier_id uuid,
  p_secondary_cajas_enabled boolean,
  p_secondary_caja_template_id uuid,
  p_secondary_cashier_ids uuid[],
  p_secondary_caja_config jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_keep_ids uuid[] := ARRAY[]::uuid[];
  v_cashier_name text;
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

  -- Cajeros que conservan caja en la nueva configuración.
  IF p_primary_cashier_id IS NOT NULL THEN
    v_keep_ids := array_append(v_keep_ids, p_primary_cashier_id);
  END IF;
  IF COALESCE(array_length(v_cashier_ids, 1), 0) > 0 THEN
    v_keep_ids := v_keep_ids || v_cashier_ids;
  END IF;

  -- Aperturas de quienes salen: sin actividad → auto-cierre; con cobros → bloquear.
  FOR v_opening_id, v_opening_opened_at, v_opening_cashier_id IN
    SELECT cro.id, cro.opened_at, cro.cashier_id
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.status = 'abierta'
      AND COALESCE(cro.register_role, 'standard') <> 'auxiliary'
      AND (
        COALESCE(array_length(v_keep_ids, 1), 0) = 0
        OR NOT (cro.cashier_id = ANY (v_keep_ids))
      )
  LOOP
    IF public.cash_register_opening_has_activity(
      v_opening_id,
      v_opening_cashier_id,
      p_shift_id,
      v_opening_opened_at
    ) THEN
      SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.alias, p.username, 'cajero')
      INTO v_cashier_name
      FROM public.profiles p
      WHERE p.id = v_opening_cashier_id;

      RAISE EXCEPTION
        'No se puede quitar a % de caja: su apertura ya tuvo cobros o movimientos. Usa reemplazo de cajero o cierra la caja formalmente.',
        COALESCE(v_cashier_name, 'el cajero');
    END IF;

    UPDATE public.cash_register_openings cro
    SET status = 'cerrada',
        closed_at = COALESCE(cro.closed_at, now()),
        notes = CASE
          WHEN COALESCE(btrim(cro.notes), '') = '' THEN
            'Auto-cierre: cajero removido de configuración sin cobros'
          WHEN cro.notes ILIKE '%Auto-cierre: cajero removido%' THEN cro.notes
          ELSE cro.notes || ' | Auto-cierre: cajero removido de configuración sin cobros'
        END,
        updated_at = now()
    WHERE cro.id = v_opening_id;
  END LOOP;

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
$function$;
