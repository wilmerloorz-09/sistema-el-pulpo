BEGIN;

DROP INDEX IF EXISTS public.ux_user_branch_roles_single_active_branch_per_user;
DROP INDEX IF EXISTS public.ux_user_branches_single_branch_per_user;

WITH ranked_assignments AS (
  SELECT
    ubr.id,
    ubr.user_id,
    ubr.branch_id,
    ROW_NUMBER() OVER (
      PARTITION BY ubr.user_id
      ORDER BY
        CASE WHEN p.active_branch_id = ubr.branch_id THEN 0 ELSE 1 END,
        CASE WHEN r.code = 'supervisor' THEN 0 ELSE 1 END,
        ubr.updated_at DESC,
        ubr.created_at DESC,
        ubr.id DESC
    ) AS rn
  FROM public.user_branch_roles ubr
  JOIN public.profiles p ON p.id = ubr.user_id
  JOIN public.roles r ON r.id = ubr.role_id
  WHERE ubr.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      JOIN public.roles gr ON gr.id = ugr.role_id
      WHERE ugr.user_id = ubr.user_id
        AND ugr.is_active = true
        AND gr.code = 'administrador'
    )
)
DELETE FROM public.user_branch_roles ubr
WHERE EXISTS (
  SELECT 1
  FROM ranked_assignments ra
  WHERE ra.id = ubr.id
    AND ra.rn > 1
);

DELETE FROM public.user_branch_roles ubr
WHERE EXISTS (
  SELECT 1
  FROM public.user_global_roles ugr
  JOIN public.roles gr ON gr.id = ugr.role_id
  WHERE ugr.user_id = ubr.user_id
    AND ugr.is_active = true
    AND gr.code = 'administrador'
);

DELETE FROM public.user_branches ub
WHERE EXISTS (
  SELECT 1
  FROM public.user_global_roles ugr
  JOIN public.roles gr ON gr.id = ugr.role_id
  WHERE ugr.user_id = ub.user_id
    AND ugr.is_active = true
    AND gr.code = 'administrador'
);

DELETE FROM public.user_branches ub
WHERE EXISTS (
  SELECT 1
  FROM public.user_branch_roles ubr
  WHERE ubr.user_id = ub.user_id
    AND ubr.is_active = true
)
AND NOT EXISTS (
  SELECT 1
  FROM public.user_branch_roles ubr
  WHERE ubr.user_id = ub.user_id
    AND ubr.branch_id = ub.branch_id
    AND ubr.is_active = true
);

WITH ranked_branches AS (
  SELECT
    ub.id,
    ub.user_id,
    ub.branch_id,
    ROW_NUMBER() OVER (
      PARTITION BY ub.user_id
      ORDER BY
        CASE WHEN p.active_branch_id = ub.branch_id THEN 0 ELSE 1 END,
        ub.id DESC
    ) AS rn
  FROM public.user_branches ub
  JOIN public.profiles p ON p.id = ub.user_id
)
DELETE FROM public.user_branches ub
WHERE EXISTS (
  SELECT 1
  FROM ranked_branches rb
  WHERE rb.id = ub.id
    AND rb.rn > 1
);

INSERT INTO public.user_branches (user_id, branch_id)
SELECT DISTINCT ubr.user_id, ubr.branch_id
FROM public.user_branch_roles ubr
WHERE ubr.is_active = true
ON CONFLICT (user_id, branch_id) DO NOTHING;

WITH kept_assignment AS (
  SELECT DISTINCT ON (ubr.user_id)
    ubr.user_id,
    ubr.branch_id
  FROM public.user_branch_roles ubr
  JOIN public.profiles p ON p.id = ubr.user_id
  JOIN public.roles r ON r.id = ubr.role_id
  WHERE ubr.is_active = true
  ORDER BY
    ubr.user_id,
    CASE WHEN p.active_branch_id = ubr.branch_id THEN 0 ELSE 1 END,
    CASE WHEN r.code = 'supervisor' THEN 0 ELSE 1 END,
    ubr.updated_at DESC,
    ubr.created_at DESC,
    ubr.id DESC
)
UPDATE public.profiles p
SET active_branch_id = kept_assignment.branch_id,
    updated_at = now()
FROM kept_assignment
WHERE p.id = kept_assignment.user_id
  AND p.active_branch_id IS DISTINCT FROM kept_assignment.branch_id;

UPDATE public.profiles p
SET active_branch_id = NULL,
    updated_at = now()
WHERE p.active_branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_branch_roles ubr
    WHERE ubr.user_id = p.id
      AND ubr.is_active = true
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_global_roles ugr
    JOIN public.roles r ON r.id = ugr.role_id
    WHERE ugr.user_id = p.id
      AND ugr.is_active = true
      AND r.code = 'administrador'
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_branches_single_branch_per_user
  ON public.user_branches (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_branch_roles_single_active_branch_per_user
  ON public.user_branch_roles (user_id)
  WHERE is_active = true;

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
    AND branch_id = p_branch_id;

  UPDATE public.profiles
  SET active_branch_id = NULL,
      updated_at = now()
  WHERE id = p_target_user_id
    AND active_branch_id = p_branch_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'username', p.username,
    'email', p.email,
    'is_active', p.is_active,
    'active_branch_id', p.active_branch_id,
    'avatar_url', p.avatar_url,
    'is_protected_superadmin', COALESCE(p.is_protected_superadmin, false),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p.id AND ugr.is_active = true
    ),
    'branch_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', x.branch_id, 'branch_name', x.branch_name, 'role_code', x.role_code, 'role_name', x.role_name) ORDER BY x.branch_name), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (ubr.user_id)
          ubr.branch_id,
          b.name AS branch_name,
          r.code AS role_code,
          r.name AS role_name
        FROM public.user_branch_roles ubr
        JOIN public.roles r ON r.id = ubr.role_id
        JOIN public.branches b ON b.id = ubr.branch_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
        ORDER BY
          ubr.user_id,
          CASE WHEN p.active_branch_id = ubr.branch_id THEN 0 ELSE 1 END,
          CASE WHEN r.code = 'supervisor' THEN 0 ELSE 1 END,
          ubr.updated_at DESC,
          ubr.created_at DESC,
          ubr.id DESC
      ) AS x
    )
  ) ORDER BY p.full_name), '[]'::jsonb)
  FROM public.profiles p
  WHERE public.is_global_admin(auth.uid())
     OR public.has_branch_permission(
       auth.uid(),
       (SELECT active_branch_id FROM public.profiles WHERE id = auth.uid()),
       'admin_sucursal',
       'MANAGE'::public.access_level
     );
$$;

GRANT EXECUTE ON FUNCTION public.assign_user_branch_role(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_branch_role(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_access() TO authenticated;

COMMIT;
