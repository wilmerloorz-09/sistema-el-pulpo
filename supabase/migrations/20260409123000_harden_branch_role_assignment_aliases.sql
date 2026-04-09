BEGIN;

UPDATE public.roles
SET name = 'Administrador Global',
    is_active = true,
    updated_at = now()
WHERE code = 'administrador';

UPDATE public.roles
SET name = 'Supervisor de Sucursal',
    scope = 'BRANCH'::public.role_scope,
    is_active = true,
    updated_at = now()
WHERE code = 'supervisor';

INSERT INTO public.roles (code, name, scope, is_system, is_active)
VALUES ('usuario_operativo', 'Usuario Operativo', 'BRANCH', true, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    scope = EXCLUDED.scope,
    is_system = true,
    is_active = true,
    updated_at = now();

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
  v_role_code_normalized text := lower(trim(coalesce(p_role_code, '')));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede asignar roles por sucursal';
  END IF;

  SELECT r.id
  INTO v_role_id
  FROM public.roles r
  WHERE r.code = v_role_code_normalized
    AND r.scope = 'BRANCH'::public.role_scope
    AND r.is_active = true
  LIMIT 1;

  IF v_role_id IS NULL AND v_role_code_normalized IN (
    'usuario_operativo',
    'usuario operativo',
    'operativo',
    'mesero',
    'cajero',
    'despachador',
    'despachador_mesas',
    'despachador_para_llevar'
  ) THEN
    SELECT r.id
    INTO v_role_id
    FROM public.roles r
    WHERE r.scope = 'BRANCH'::public.role_scope
      AND r.is_active = true
      AND r.code IN (
        'usuario_operativo',
        'mesero',
        'cajero',
        'despachador',
        'despachador_mesas',
        'despachador_para_llevar'
      )
    ORDER BY CASE r.code
      WHEN 'usuario_operativo' THEN 0
      WHEN 'mesero' THEN 1
      WHEN 'cajero' THEN 2
      WHEN 'despachador' THEN 3
      WHEN 'despachador_mesas' THEN 4
      WHEN 'despachador_para_llevar' THEN 5
      ELSE 99
    END
    LIMIT 1;
  END IF;

  IF v_role_id IS NULL AND v_role_code_normalized IN (
    'supervisor',
    'supervisor de sucursal'
  ) THEN
    SELECT r.id
    INTO v_role_id
    FROM public.roles r
    WHERE r.scope = 'BRANCH'::public.role_scope
      AND r.is_active = true
      AND r.code = 'supervisor'
    LIMIT 1;
  END IF;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol de sucursal invalido';
  END IF;

  DELETE FROM public.user_branch_roles
  WHERE user_id = p_target_user_id;

  DELETE FROM public.user_branches
  WHERE user_id = p_target_user_id;

  INSERT INTO public.user_branches (user_id, branch_id)
  VALUES (p_target_user_id, p_branch_id);

  INSERT INTO public.user_branch_roles (user_id, branch_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, p_branch_id, v_role_id, true, v_actor);

  UPDATE public.profiles
  SET active_branch_id = p_branch_id,
      updated_at = now()
  WHERE id = p_target_user_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_user_branch_role(uuid, uuid, text, text) TO authenticated;

COMMIT;
