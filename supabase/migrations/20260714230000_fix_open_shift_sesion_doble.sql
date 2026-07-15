-- Corrige sesion doble al abrir turno.
-- open_cash_shift_with_tables exigia can_use_caja=true al persistir can_double_session,
-- pero el cliente siempre envia can_use_caja=false (la caja se aplica despues).
-- Resultado: el check "Sesión doble" se guardaba como false y el segundo dispositivo
-- desplazaba al primero via register_my_single_session.
--
-- Tambien reafirma normalize + permiso (idempotente con 20260713220000).

-- 1) Trigger: can_double_session independiente de can_use_caja
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

-- 2) Permiso de segunda sesion de app (sin exigir Caja)
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

-- 3) Abrir turno: persistir can_double_session tal cual (sin AND can_use_caja)
CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL
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
      OR COALESCE(enabled_user.can_pack_orders, false)
      OR COALESCE(enabled_user.can_serve_plates, false)
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
    opened_at
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    'UNOPENED',
    v_now
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
      is_supervisor,
      can_pack_orders,
      secondary_caja_takeout_enabled,
      secondary_caja_express_enabled,
      secondary_caja_template_id,
      can_serve_plates
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
      COALESCE(v_user_input.can_double_session, false),
      COALESCE(v_user_input.is_supervisor, false),
      COALESCE(v_user_input.can_pack_orders, false),
      COALESCE(v_user_input.secondary_caja_takeout_enabled, false),
      COALESCE(v_user_input.secondary_caja_express_enabled, false),
      v_user_input.secondary_caja_template_id,
      COALESCE(v_user_input.can_serve_plates, false)
    );
  END LOOP;

  RETURN v_shift_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
