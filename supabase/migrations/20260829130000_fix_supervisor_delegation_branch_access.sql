-- Corrige asignacion de supervisor temporal:
-- 1) No insertar en user_branches (unica sucursal por usuario).
-- 2) Permitir cambiar a sucursal delegada y operar alli ese dia.

CREATE OR REPLACE FUNCTION public.assign_branch_supervisor_delegation(
  p_branch_id uuid,
  p_delegate_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := public.branch_local_date();
  v_delegation_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede asignar supervisor temporal';
  END IF;

  IF p_branch_id IS NULL OR p_delegate_user_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal y usuario suplente son obligatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'La sucursal no existe o no esta activa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_delegate_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'El usuario suplente no existe o no esta activo';
  END IF;

  UPDATE public.branch_supervisor_delegations d
  SET
    revoked_at = now(),
    revoked_by = v_actor
  WHERE d.branch_id = p_branch_id
    AND d.effective_date = v_today
    AND d.revoked_at IS NULL;

  INSERT INTO public.branch_supervisor_delegations (
    branch_id,
    delegate_user_id,
    assigned_by,
    effective_date,
    reason
  )
  VALUES (
    p_branch_id,
    p_delegate_user_id,
    v_actor,
    v_today,
    NULLIF(trim(p_reason), '')
  )
  RETURNING id INTO v_delegation_id;

  PERFORM public.apply_supervisor_delegation_to_open_shift(p_branch_id, p_delegate_user_id);

  RETURN jsonb_build_object(
    'delegation_id', v_delegation_id,
    'branch_id', p_branch_id,
    'delegate_user_id', p_delegate_user_id,
    'effective_date', v_today
  );
END;
$$;

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
  ) AND NOT public.has_active_supervisor_delegation(auth.uid(), p_branch_id) THEN
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
  v_is_delegated_supervisor boolean := false;
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

  IF NOT v_is_global_admin
     AND v_shift_branch IS NOT NULL
     AND NOT v_has_shift_at_current
     AND NOT public.has_active_supervisor_delegation(v_user_id, v_active_branch)
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
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
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

      UNION

      SELECT d.branch_id, 2 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL
    ),
    ranked AS (
      SELECT branch_id,
        row_number() OVER (ORDER BY priority, branch_id) AS rn
      FROM accessible_branch_ids
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'address', b.address,
      'is_active', b.is_active,
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port,
      'usa_catalogo_global', COALESCE(b.usa_catalogo_global, false)
    ) ORDER BY b.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    JOIN ranked r ON r.branch_id = b.id
    WHERE b.is_active = true;
  END IF;

  IF v_active_branch IS NULL
     OR NOT EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id = v_active_branch
          AND b.is_active = true
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

      UNION

      SELECT d.branch_id, 2 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL
    )
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    JOIN accessible_branch_ids abi ON abi.branch_id = b.id
    WHERE b.is_active = true
    ORDER BY abi.priority, b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    v_is_delegated_supervisor := public.has_active_supervisor_delegation(v_user_id, v_active_branch);

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

      IF v_is_delegated_supervisor THEN
        v_permissions := jsonb_build_object(
          'mesas', 'OPERATE',
          'ordenes', 'OPERATE',
          'despacho_total', 'OPERATE',
          'despacho_mesa', 'OPERATE',
          'despacho_para_llevar', 'OPERATE',
          'caja', 'OPERATE'
        ) || COALESCE(v_permissions, '{}'::jsonb);
      END IF;
    END IF;

    IF public.can_operate_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'OPERATE');
    ELSIF public.can_view_inventario_movimientos(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('inventario_movimientos', 'VIEW');
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

GRANT EXECUTE ON FUNCTION public.assign_branch_supervisor_delegation(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_active_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

NOTIFY pgrst, 'reload schema';
