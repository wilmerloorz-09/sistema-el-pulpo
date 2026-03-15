CREATE TABLE IF NOT EXISTS public.cash_shift_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, user_id)
);

ALTER TABLE public.cash_shift_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shift users can be managed by branch admins" ON public.cash_shift_users;
CREATE POLICY "Shift users can be managed by branch admins"
ON public.cash_shift_users
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_users.shift_id
      AND public.can_manage_branch_admin(auth.uid(), cs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_users.shift_id
      AND public.can_manage_branch_admin(auth.uid(), cs.branch_id)
  )
);

DROP POLICY IF EXISTS "Users can view own shift enablement" ON public.cash_shift_users;
CREATE POLICY "Users can view own shift enablement"
ON public.cash_shift_users
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_cash_shift_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_cash_shift_users_updated_at ON public.cash_shift_users;
CREATE TRIGGER trg_touch_cash_shift_users_updated_at
BEFORE UPDATE ON public.cash_shift_users
FOR EACH ROW
EXECUTE FUNCTION public.touch_cash_shift_users_updated_at();

CREATE OR REPLACE FUNCTION public.list_shift_users_for_branch(
  p_branch_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  is_profile_active boolean,
  is_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, true) AS is_enabled
  FROM public.user_branches ub
  JOIN public.profiles p
    ON p.id = ub.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = ub.user_id
  WHERE ub.branch_id = p_branch_id
  ORDER BY p.full_name, p.username;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_shift_user_enabled(
  p_shift_id uuid,
  p_user_id uuid,
  p_is_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y user_id son obligatorios';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.status = 'OPEN';

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar usuarios de este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branches ub
    JOIN public.profiles p ON p.id = ub.user_id
    WHERE ub.branch_id = v_branch_id
      AND ub.user_id = p_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'El usuario no pertenece a la sucursal activa o no esta activo';
  END IF;

  INSERT INTO public.cash_shift_users (
    shift_id,
    user_id,
    is_enabled
  )
  VALUES (
    p_shift_id,
    p_user_id,
    COALESCE(p_is_enabled, true)
  )
  ON CONFLICT (shift_id, user_id)
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate(
  p_branch_id uuid
)
RETURNS TABLE (
  shift_id uuid,
  shift_open boolean,
  user_enabled boolean,
  active_tables_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_active_tables_count integer := 0;
  v_user_enabled boolean := false;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0;
    RETURN;
  END IF;

  SELECT cs.id, COALESCE(cs.active_tables_count, 0)
  INTO v_shift_id, v_active_tables_count
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0;
    RETURN;
  END IF;

  SELECT COALESCE(csu.is_enabled, false)
  INTO v_user_enabled
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift_id
    AND csu.user_id = auth.uid();

  RETURN QUERY
  SELECT v_shift_id, true, COALESCE(v_user_enabled, false), v_active_tables_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_denoms jsonb DEFAULT '[]'::jsonb,
  p_enabled_user_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_enabled_ids uuid[] := COALESCE(p_enabled_user_ids, ARRAY[]::uuid[]);
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
    opened_at
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    v_now
  );

  PERFORM public.configure_shift_active_tables(
    p_branch_id,
    v_shift_id,
    p_active_tables_count
  );

  INSERT INTO public.cash_shift_users (
    shift_id,
    user_id,
    is_enabled
  )
  SELECT
    v_shift_id,
    p.id,
    CASE
      WHEN COALESCE(array_length(v_enabled_ids, 1), 0) = 0 THEN true
      ELSE p.id = ANY(v_enabled_ids)
    END
  FROM public.user_branches ub
  JOIN public.profiles p
    ON p.id = ub.user_id
  WHERE ub.branch_id = p_branch_id
    AND p.is_active = true;

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      v_shift_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.branch_id = p_branch_id
      AND d.is_active = true;
  ELSE
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.cash_shift_denoms (
        id,
        shift_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        v_shift_id,
        v_denomination_id,
        v_qty,
        v_qty
      );

      IF v_qty > 0 THEN
        INSERT INTO public.cash_movements (
          id,
          shift_id,
          denomination_id,
          movement_type,
          qty_delta,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          v_shift_id,
          v_denomination_id,
          'OPENING',
          v_qty,
          v_now
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shift_user_enabled(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text) TO authenticated;
