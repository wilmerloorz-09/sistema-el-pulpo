-- Actualizar max_caja_sessions ANTES de asignar can_use_caja (evita falso error del trigger).

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
  v_total_registers integer;
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

  v_total_registers := 1 + COALESCE(array_length(v_cashier_ids, 1), 0);

  UPDATE public.cash_shifts
  SET
    primary_cashier_id = p_primary_cashier_id,
    secondary_cajas_enabled = v_secondary_enabled,
    secondary_caja_template_id = CASE WHEN v_secondary_enabled THEN v_template_id ELSE NULL END,
    max_caja_sessions = GREATEST(1, LEAST(v_total_registers, 10))
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

NOTIFY pgrst, 'reload schema';
