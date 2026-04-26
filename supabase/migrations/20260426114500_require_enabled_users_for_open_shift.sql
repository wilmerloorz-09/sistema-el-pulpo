-- Un turno abierto nunca debe quedar sin usuarios habilitados.
-- La validacion vive en la RPC y en triggers diferidos para cubrir tambien
-- rutas antiguas, cambios manuales o escrituras directas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.typrelid = a.attrelid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'shift_user_input'
      AND a.attname = 'can_edit_orders'
      AND a.attisdropped = false
  ) THEN
    ALTER TYPE public.shift_user_input ADD ATTRIBUTE can_edit_orders boolean;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.typrelid = a.attrelid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'shift_user_input'
      AND a.attname = 'can_double_session'
      AND a.attisdropped = false
  ) THEN
    ALTER TYPE public.shift_user_input ADD ATTRIBUTE can_double_session boolean;
  END IF;
END;
$$;

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

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
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
      OR COALESCE(enabled_user.is_supervisor, false)
    )
    AND (
      COALESCE(enabled_user.is_supervisor, false) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_branches ub
        JOIN public.roles r
          ON r.id = ub.role_id
        WHERE ub.user_id = enabled_user.user_id
          AND ub.branch_id = p_branch_id
          AND ub.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
    );

  IF v_enabled_user_count = 0 THEN
    RAISE EXCEPTION 'No se puede abrir el turno sin al menos un usuario habilitado con rol operativo';
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
      COALESCE(v_user_input.can_double_session, false) AND COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.is_supervisor, false)
    );
  END LOOP;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_open_shift_has_enabled_user(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.status = 'OPEN'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    JOIN public.profiles p
      ON p.id = csu.user_id
     AND p.is_active = true
    WHERE csu.shift_id = p_shift_id
      AND csu.is_enabled = true
      AND (
        COALESCE(csu.can_serve_tables, false)
        OR COALESCE(csu.can_access_orders, false)
        OR COALESCE(csu.can_edit_orders, false)
        OR COALESCE(csu.can_dispatch_orders, false)
        OR COALESCE(csu.can_manage_products, false)
        OR COALESCE(csu.can_use_caja, false)
        OR COALESCE(csu.is_supervisor, false)
      )
  ) THEN
    RAISE EXCEPTION 'No se puede guardar un turno abierto sin usuarios habilitados';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_open_shift_has_enabled_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'cash_shifts' THEN
    PERFORM public.assert_open_shift_has_enabled_user(COALESCE(NEW.id, OLD.id));
  ELSIF TG_TABLE_NAME = 'cash_shift_users' THEN
    PERFORM public.assert_open_shift_has_enabled_user(COALESCE(NEW.shift_id, OLD.shift_id));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_shifts_require_enabled_user ON public.cash_shifts;
CREATE CONSTRAINT TRIGGER trg_cash_shifts_require_enabled_user
AFTER INSERT OR UPDATE ON public.cash_shifts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_open_shift_has_enabled_user();

DROP TRIGGER IF EXISTS trg_cash_shift_users_require_enabled_user ON public.cash_shift_users;
CREATE CONSTRAINT TRIGGER trg_cash_shift_users_require_enabled_user
AFTER INSERT OR UPDATE OR DELETE ON public.cash_shift_users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_open_shift_has_enabled_user();

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_open_shift_has_enabled_user(uuid) TO authenticated;
