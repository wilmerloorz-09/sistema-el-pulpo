-- Quién puede entrar a Extra / Extra Empaquetador: empaquetador del turno OPEN o admin.

CREATE OR REPLACE FUNCTION public.extra_acceso_can_use_station(p_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_global_admin(_user_id => v_uid) THEN
    RETURN true;
  END IF;

  IF public.can_manage_branch_admin(v_uid, p_branch_id) THEN
    RETURN true;
  END IF;

  IF public.has_branch_permission(v_uid, p_branch_id, 'admin_global', 'VIEW')
     OR public.has_branch_permission(v_uid, p_branch_id, 'admin_sucursal', 'VIEW') THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
      AND csu.user_id = v_uid
      AND csu.is_enabled IS TRUE
      AND csu.can_pack_orders IS TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.extra_acceso_can_use_station(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extra_acceso_can_use_station(uuid) TO authenticated;
