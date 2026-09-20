-- Si el usuario esta habilitado en el turno abierto de la sucursal, puede
-- dejarla como activa aunque sea supervisor en otra sucursal.

CREATE OR REPLACE FUNCTION public.ensure_active_branch_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_global_admin(NEW.id) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = NEW.active_branch_id
        AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'La sucursal activa no es valida para el administrador global';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_branches ub
    JOIN public.branches b
      ON b.id = ub.branch_id
    WHERE ub.user_id = NEW.id
      AND ub.branch_id = NEW.active_branch_id
      AND b.is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Supervisor temporal del dia: puede fijar esa sucursal como activa.
  IF public.has_active_supervisor_delegation(NEW.id, NEW.active_branch_id) THEN
    IF EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = NEW.active_branch_id
        AND b.is_active = true
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Habilitado en el turno abierto de esa sucursal: puede activarla.
  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    JOIN public.branches b
      ON b.id = cs.branch_id
    WHERE cs.branch_id = NEW.active_branch_id
      AND cs.status = 'OPEN'
      AND csu.user_id = NEW.id
      AND csu.is_enabled = true
      AND b.is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'La sucursal activa debe estar habilitada para el usuario';
END;
$$;

NOTIFY pgrst, 'reload schema';
