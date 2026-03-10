-- Incremental fix: allow multiple roles in the same branch for a user

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
  INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'user_branch_roles'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) LIKE '%(user_id, branch_id)%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_branch_roles DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'user_branch_roles'
      AND indexname = 'user_branch_roles_user_id_branch_id_role_id_key'
  ) THEN
    ALTER TABLE public.user_branch_roles
      ADD CONSTRAINT user_branch_roles_user_id_branch_id_role_id_key
      UNIQUE (user_id, branch_id, role_id);
  END IF;
END
$$;

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

CREATE OR REPLACE FUNCTION public.remove_user_branch_role(
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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador puede remover roles por sucursal';
  END IF;

  DELETE FROM public.user_branch_roles ubr
  USING public.roles r
  WHERE ubr.user_id = p_target_user_id
    AND ubr.branch_id = p_branch_id
    AND ubr.role_id = r.id
    AND r.code = p_role_code;

  DELETE FROM public.user_branches
  WHERE user_id = p_target_user_id
    AND branch_id = p_branch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      WHERE ubr.user_id = p_target_user_id
        AND ubr.branch_id = p_branch_id
        AND ubr.is_active = true
    );

  UPDATE public.profiles
  SET active_branch_id = (
    SELECT ubr.branch_id
    FROM public.user_branch_roles ubr
    WHERE ubr.user_id = p_target_user_id
      AND ubr.is_active = true
    ORDER BY ubr.created_at
    LIMIT 1
  ),
  updated_at = now()
  WHERE id = p_target_user_id
    AND active_branch_id = p_branch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      WHERE ubr.user_id = p_target_user_id
        AND ubr.branch_id = p_branch_id
        AND ubr.is_active = true
    );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_user_branch_role(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_branch_role(uuid, uuid, text, text) TO authenticated;
