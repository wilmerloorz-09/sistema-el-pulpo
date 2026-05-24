-- Valida unicidad de supervisor por sucursal en assign_user_branch_role
-- Una sucursal solo puede tener un supervisor activo a la vez.

CREATE OR REPLACE FUNCTION public.assign_user_branch_role(
  p_target_user_id uuid,
  p_branch_id uuid,
  p_role_code text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role_id uuid;
  v_existing_supervisor_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede asignar roles por sucursal';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = p_role_code
    AND scope = 'BRANCH'::public.role_scope
    AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol de sucursal invalido';
  END IF;

  -- Validar unicidad de supervisor por sucursal
  IF p_role_code = 'supervisor' THEN
    SELECT COALESCE(p.first_name || ' ' || p.last_name, p.username)
    INTO v_existing_supervisor_name
    FROM public.user_branch_roles ubr
    JOIN public.profiles p ON p.id = ubr.user_id
    WHERE ubr.branch_id = p_branch_id
      AND ubr.role_id = v_role_id
      AND ubr.is_active = true
      AND ubr.user_id <> p_target_user_id
    LIMIT 1;

    IF v_existing_supervisor_name IS NOT NULL THEN
      RAISE EXCEPTION 'Esta sucursal ya tiene un supervisor asignado: %. Solo puede haber un supervisor por sucursal.',
        v_existing_supervisor_name;
    END IF;
  END IF;

  INSERT INTO public.user_branches (user_id, branch_id)
  VALUES (p_target_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  INSERT INTO public.user_branch_roles (user_id, branch_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, p_branch_id, v_role_id, true, v_actor)
  ON CONFLICT (user_id, branch_id, role_id)
  DO UPDATE SET
    is_active = true,
    assigned_by = v_actor,
    updated_at = now();

  UPDATE public.profiles
  SET active_branch_id = COALESCE(active_branch_id, p_branch_id),
      updated_at = now()
  WHERE id = p_target_user_id;

  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';
