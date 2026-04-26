-- Permite que un usuario operativo tenga como sucursal activa una sucursal
-- donde esta habilitado en el turno abierto, aunque no tenga user_branches.
-- Los administradores globales siguen pudiendo activar cualquier sucursal activa.
-- Los supervisores siguen requiriendo asignacion de sucursal fija.

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
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = NEW.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'La sucursal activa debe estar habilitada para el usuario';
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_validate_active_branch ON public.profiles;
CREATE TRIGGER trg_profiles_validate_active_branch
BEFORE INSERT OR UPDATE OF active_branch_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.ensure_active_branch_membership();

NOTIFY pgrst, 'reload schema';
