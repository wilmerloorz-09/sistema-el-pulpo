-- Varios usuarios pueden tener permiso de Caja en el mismo turno, hasta cash_shifts.max_caja_sessions
-- (terminales configuradas). Se elimina el indice que forzaba un solo usuario con Caja por turno.
-- open_cash_register acepta a cualquier usuario habilitado con Caja, no solo a uno maximo por UUID arbitrario.

DROP INDEX IF EXISTS public.ux_cash_shift_users_one_enabled_cashier_per_shift;

CREATE OR REPLACE FUNCTION public.enforce_shift_caja_user_terminal_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  cap integer;
  cnt integer;
BEGIN
  sid := COALESCE(NEW.shift_id, OLD.shift_id);

  SELECT cs.max_caja_sessions
  INTO cap
  FROM public.cash_shifts cs
  WHERE cs.id = sid;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  cap := GREATEST(1, LEAST(COALESCE(cap, 1), 10));

  SELECT COUNT(*)::integer
  INTO cnt
  FROM public.cash_shift_users
  WHERE shift_id = sid
    AND COALESCE(is_enabled, false)
    AND COALESCE(can_use_caja, false);

  IF cnt > cap THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'Hay %s usuarios con permiso de Caja y solo se permiten %s (terminales del turno).',
        cnt,
        cap
      ),
      ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shift_caja_user_terminal_cap_insert ON public.cash_shift_users;
CREATE CONSTRAINT TRIGGER trg_enforce_shift_caja_user_terminal_cap_insert
AFTER INSERT ON public.cash_shift_users
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION public.enforce_shift_caja_user_terminal_cap();

DROP TRIGGER IF EXISTS trg_enforce_shift_caja_user_terminal_cap_update ON public.cash_shift_users;
CREATE CONSTRAINT TRIGGER trg_enforce_shift_caja_user_terminal_cap_update
AFTER UPDATE OF shift_id, is_enabled, can_use_caja ON public.cash_shift_users
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION public.enforce_shift_caja_user_terminal_cap();

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_caja_status public.caja_status;
  v_initial_total numeric(12,2) := 0;
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

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'La caja ya fue abierta anteriormente en este turno';
  END IF;

  DELETE FROM public.cash_shift_denoms
  WHERE shift_id = p_shift_id;

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
      p_shift_id,
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
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d
    ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id;

  INSERT INTO public.cash_register_openings (
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total
  )
  VALUES (
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    v_initial_total
  );

  UPDATE public.cash_shifts
  SET caja_status = 'OPEN',
      cashier_id = p_cashier_id,
      capture_user_id = p_cashier_id,
      capture_device_label = NULL
  WHERE id = p_shift_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
