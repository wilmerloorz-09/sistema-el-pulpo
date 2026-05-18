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

-- open_cash_register se redefine en 20260522120000_per_cashier_caja_register.sql (RETURNS uuid).
-- No recrear aqui con RETURNS void: falla 42P13 si ya existe la version uuid.

NOTIFY pgrst, 'reload schema';
