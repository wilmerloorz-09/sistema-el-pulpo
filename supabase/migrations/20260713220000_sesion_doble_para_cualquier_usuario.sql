-- Sesión doble: permitir dos dispositivos a cualquier usuario del turno,
-- sin exigir can_use_caja. La UI de Admin > Turno expone el checkbox "Sesión doble".

-- 1) Normalización al insertar/actualizar cash_shift_users
CREATE OR REPLACE FUNCTION public.normalize_cash_shift_user_capabilities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_capability boolean;
BEGIN
  NEW.can_serve_tables := COALESCE(NEW.can_serve_tables, false);
  NEW.can_access_orders := COALESCE(NEW.can_access_orders, false);
  NEW.can_edit_orders := COALESCE(NEW.can_edit_orders, false);
  NEW.can_dispatch_orders := COALESCE(NEW.can_dispatch_orders, false);
  NEW.can_manage_products := COALESCE(NEW.can_manage_products, false);
  NEW.can_use_caja := COALESCE(NEW.can_use_caja, false);
  NEW.can_authorize_order_cancel := COALESCE(NEW.can_authorize_order_cancel, false);
  NEW.can_double_session := COALESCE(NEW.can_double_session, false);
  NEW.is_supervisor := COALESCE(NEW.is_supervisor, false);
  NEW.can_pack_orders := COALESCE(NEW.can_pack_orders, false);
  NEW.can_serve_plates := COALESCE(NEW.can_serve_plates, false);

  IF NEW.can_serve_tables THEN
    NEW.can_access_orders := true;
  END IF;

  IF NEW.can_dispatch_orders THEN
    NEW.can_manage_products := true;
  END IF;

  v_has_capability :=
    NEW.can_serve_tables OR
    NEW.can_access_orders OR
    NEW.can_edit_orders OR
    NEW.can_dispatch_orders OR
    NEW.can_manage_products OR
    NEW.can_use_caja OR
    NEW.can_authorize_order_cancel OR
    NEW.is_supervisor OR
    NEW.can_pack_orders OR
    NEW.can_serve_plates;

  IF COALESCE(NEW.is_enabled, false) AND NOT v_has_capability THEN
    NEW.is_enabled := false;
    NEW.can_double_session := false;
    NEW.last_session_id := NULL;
    NEW.secondary_session_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Align check with Empacador / Servir (operativos válidos)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shift_users_has_capability_chk'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
    DROP CONSTRAINT cash_shift_users_has_capability_chk;
  END IF;
END;
$$;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  is_enabled = false OR
  can_serve_tables = true OR
  can_access_orders = true OR
  can_edit_orders = true OR
  can_dispatch_orders = true OR
  can_manage_products = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true OR
  can_pack_orders = true OR
  can_serve_plates = true
);

-- 2) Permiso real de segunda sesión de app (sin exigir Caja)
CREATE OR REPLACE FUNCTION public.user_has_double_app_session_permission(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    JOIN public.cash_shifts cs
      ON cs.id = csu.shift_id
    WHERE csu.user_id = p_user_id
      AND csu.is_enabled = true
      AND csu.can_double_session = true
      AND cs.status = 'OPEN'
  );
$$;

-- 3) Configuración de caja: no tocar can_double_session (ya se define en la tarjeta del usuario)
DROP FUNCTION IF EXISTS public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[], jsonb);

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

GRANT EXECUTE ON FUNCTION public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[], jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
