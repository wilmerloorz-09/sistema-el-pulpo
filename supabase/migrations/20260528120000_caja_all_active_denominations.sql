-- Las cajas abiertas con plantilla parcial solo insertaban las denominaciones del template.
-- El cobro necesita todas las denominaciones activas (qty 0 si no van en la plantilla).

CREATE OR REPLACE FUNCTION public.internal_open_cash_register_for_cashier(
  p_shift_id uuid,
  p_branch_id uuid,
  p_cashier_id uuid,
  p_denoms jsonb,
  p_register_role text DEFAULT 'secondary'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2) := 0;
  v_role text := COALESCE(NULLIF(btrim(p_register_role), ''), 'secondary');
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF v_role NOT IN ('standard', 'primary', 'secondary') THEN
    RAISE EXCEPTION 'register_role invalido';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_cashier_id
      AND csu.is_enabled = true
      AND csu.can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'El cajero debe estar habilitado con Caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Este cajero ya tiene una caja abierta en el turno';
  END IF;

  INSERT INTO public.cash_register_openings (
    id,
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total,
    register_role
  )
  VALUES (
    v_opening_id,
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    0,
    v_role
  );

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true;
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
        cashier_id,
        opening_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        p_cashier_id,
        v_opening_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;

    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_denoms csd
        WHERE csd.shift_id = p_shift_id
          AND csd.cashier_id = p_cashier_id
          AND csd.opening_id = v_opening_id
          AND csd.denomination_id = d.id
      );
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id
    AND csd.cashier_id = p_cashier_id
    AND csd.opening_id = v_opening_id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  RETURN v_opening_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2) := 0;
  v_register_role text := 'primary';
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users
    WHERE shift_id = p_shift_id
      AND user_id = p_cashier_id
      AND is_enabled = true
      AND can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'Tu usuario debe estar habilitado con permiso de Caja en este turno para abrir caja.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una caja abierta en este turno. Cierrala antes de abrir otra apertura.';
  END IF;

  INSERT INTO public.cash_register_openings (
    id,
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total,
    register_role
  )
  VALUES (
    v_opening_id,
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    0,
    v_register_role
  );

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true;
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
        cashier_id,
        opening_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        p_cashier_id,
        v_opening_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;

    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_denoms csd
        WHERE csd.shift_id = p_shift_id
          AND csd.cashier_id = p_cashier_id
          AND csd.opening_id = v_opening_id
          AND csd.denomination_id = d.id
      );
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id
    AND csd.cashier_id = p_cashier_id
    AND csd.opening_id = v_opening_id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  RETURN v_opening_id;
END;
$$;

-- Cajas ya abiertas con plantilla parcial: completar denominaciones activas faltantes.
INSERT INTO public.cash_shift_denoms (
  id,
  shift_id,
  cashier_id,
  opening_id,
  denomination_id,
  qty_initial,
  qty_current
)
SELECT
  gen_random_uuid(),
  cro.shift_id,
  cro.cashier_id,
  cro.id,
  d.id,
  0,
  0
FROM public.cash_register_openings cro
CROSS JOIN public.denominations d
WHERE cro.status = 'abierta'
  AND d.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_denoms csd
    WHERE csd.shift_id = cro.shift_id
      AND csd.cashier_id = cro.cashier_id
      AND csd.denomination_id = d.id
  );

NOTIFY pgrst, 'reload schema';
