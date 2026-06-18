-- Cajeros secundarios: flags Para llevar / Express por usuario en cash_shift_users.
-- Extra siempre aplica (solo ordenes propias); el filtro de created_by vive en el cliente.

ALTER TABLE public.cash_shift_users
  ADD COLUMN IF NOT EXISTS secondary_caja_takeout_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS secondary_caja_express_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cash_shift_users.secondary_caja_takeout_enabled IS
  'Cajero secundario: puede cobrar sus propias ordenes TAKEOUT.';
COMMENT ON COLUMN public.cash_shift_users.secondary_caja_express_enabled IS
  'Cajero secundario: puede cobrar sus propias ordenes EXPRESS despachadas.';

DROP FUNCTION IF EXISTS public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[]);

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
      can_double_session = false,
      secondary_caja_takeout_enabled = false,
      secondary_caja_express_enabled = false
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

  IF COALESCE(jsonb_array_length(COALESCE(p_secondary_caja_config, '[]'::jsonb)), 0) > 0 THEN
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_secondary_caja_config, '[]'::jsonb))
    LOOP
      v_config_user_id := NULLIF(v_entry ->> 'user_id', '')::uuid;
      v_takeout_enabled := COALESCE((v_entry ->> 'takeout_enabled')::boolean, false);
      v_express_enabled := COALESCE((v_entry ->> 'express_enabled')::boolean, false);

      IF v_config_user_id IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.cash_shift_users csu
      SET
        secondary_caja_takeout_enabled = v_takeout_enabled,
        secondary_caja_express_enabled = v_express_enabled
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = v_config_user_id
        AND csu.can_use_caja = true
        AND csu.user_id <> p_primary_cashier_id;
    END LOOP;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.apply_shift_caja_configuration(uuid, uuid, uuid, boolean, uuid, uuid[], jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], uuid, boolean, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL,
  p_primary_cashier_id uuid DEFAULT NULL,
  p_secondary_cajas_enabled boolean DEFAULT false,
  p_secondary_caja_template_id uuid DEFAULT NULL,
  p_secondary_cashier_ids uuid[] DEFAULT NULL,
  p_secondary_caja_config jsonb DEFAULT NULL
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
    p_secondary_cashier_ids := COALESCE(p_secondary_cashier_ids, ARRAY[]::uuid[]),
    p_secondary_caja_config := COALESCE(p_secondary_caja_config, '[]'::jsonb)
  );

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[], uuid, boolean, uuid, uuid[], jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
