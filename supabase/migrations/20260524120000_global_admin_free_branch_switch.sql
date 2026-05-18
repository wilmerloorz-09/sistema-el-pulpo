-- Administrador general: puede elegir cualquier sucursal activa sin redireccion por turno
-- ni auto-reasignacion en get_my_access_context.

CREATE OR REPLACE FUNCTION public.set_my_active_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF public.is_global_admin(auth.uid()) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = p_branch_id
        AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'La sucursal seleccionada no existe o no esta activa';
    END IF;

    UPDATE public.profiles
    SET active_branch_id = p_branch_id,
        updated_at = now()
    WHERE id = auth.uid();

    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.branches b ON b.id = ub.branch_id
    WHERE ub.user_id = auth.uid()
      AND ub.branch_id = p_branch_id
      AND b.is_active = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    JOIN public.branches b
      ON b.id = cs.branch_id
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Sucursal no disponible para el usuario';
  END IF;

  UPDATE public.profiles
  SET active_branch_id = p_branch_id,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_branch uuid;
  v_branches jsonb := '[]'::jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_shift_permissions jsonb := '{}'::jsonb;
  v_shift_branch uuid;
  v_has_shift_at_current boolean;
  v_is_global_admin boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_is_global_admin := public.is_global_admin(v_user_id);

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT cs.branch_id INTO v_shift_branch
  FROM public.cash_shifts cs
  JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
  WHERE cs.status = 'OPEN'
    AND csu.user_id = v_user_id
    AND csu.is_enabled = true
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  v_has_shift_at_current := EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
    WHERE cs.branch_id = v_active_branch
      AND cs.status = 'OPEN'
      AND csu.user_id = v_user_id
      AND csu.is_enabled = true
  );

  -- Solo operativos: forzar sucursal del turno si no tienen turno en la sucursal activa.
  IF NOT v_is_global_admin
     AND v_shift_branch IS NOT NULL
     AND NOT v_has_shift_at_current
  THEN
    v_active_branch := v_shift_branch;
    UPDATE public.profiles
    SET active_branch_id = v_active_branch, updated_at = now()
    WHERE id = v_user_id;
  END IF;

  IF v_is_global_admin THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    WHERE b.is_active = true;
  ELSE
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    ),
    candidate_branch_ids AS (
      SELECT branch_id, MIN(priority) AS priority
      FROM accessible_branch_ids
      GROUP BY branch_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
    ) ORDER BY cbi.priority, b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    JOIN candidate_branch_ids cbi ON cbi.branch_id = b.id
    WHERE b.is_active = true;
  END IF;

  -- Auto-seleccion solo para no-admins globales.
  IF NOT v_is_global_admin
     AND (
       v_active_branch IS NULL
       OR NOT EXISTS (
         WITH accessible_branch_ids AS (
           SELECT ub.branch_id
           FROM public.v_user_accessible_branches ub
           WHERE ub.user_id = v_user_id

           UNION

           SELECT cs.branch_id
           FROM public.cash_shifts cs
           JOIN public.cash_shift_users csu
             ON csu.shift_id = cs.id
           WHERE cs.status = 'OPEN'
             AND csu.user_id = v_user_id
             AND csu.is_enabled = true
         )
         SELECT 1
         FROM accessible_branch_ids abi
         JOIN public.branches b ON b.id = abi.branch_id
         WHERE abi.branch_id = v_active_branch
           AND b.is_active = true
       )
     )
  THEN
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    )
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    JOIN accessible_branch_ids abi ON abi.branch_id = b.id
    WHERE b.is_active = true
    GROUP BY b.id, b.name
    ORDER BY MIN(abi.priority), b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  ELSIF v_is_global_admin
        AND v_active_branch IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.branches b
          WHERE b.id = v_active_branch
            AND b.is_active = true
        )
  THEN
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    WHERE b.is_active = true
    ORDER BY b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(module_code, access_level::text), '{}'::jsonb)
    INTO v_permissions
    FROM public.v_user_effective_permissions
    WHERE user_id = v_user_id
      AND branch_id = v_active_branch;

    IF NOT v_is_global_admin THEN
      SELECT COALESCE(jsonb_strip_nulls(jsonb_build_object(
        'mesas', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'ordenes', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.can_access_orders, false) OR COALESCE(csu.can_edit_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_total', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_mesa', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'despacho_para_llevar', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
        'caja', CASE WHEN bool_or(COALESCE(csu.can_use_caja, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END
      )), '{}'::jsonb)
      INTO v_shift_permissions
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.branch_id = v_active_branch
        AND cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true;

      v_permissions := COALESCE(v_shift_permissions, '{}'::jsonb) || COALESCE(v_permissions, '{}'::jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', v_is_global_admin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_active_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

NOTIFY pgrst, 'reload schema';
