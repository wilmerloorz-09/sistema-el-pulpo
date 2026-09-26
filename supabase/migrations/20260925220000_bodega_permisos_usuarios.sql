-- Permisos de bodega en módulo de usuarios:
-- - bodeguero_general (rol GLOBAL, solo uno activo a la vez)
-- - bodega_sucursal (módulo por sucursal vía user_branch_modules)

INSERT INTO public.modules (code, name, description, is_active)
VALUES
  (
    'bodega_general',
    'Bodega general',
    'Operar inventario de la bodega general (compras e ingresos a bodegas de sucursal)',
    true
  ),
  (
    'bodega_sucursal',
    'Bodeguero de sucursal',
    'Operar inventario de la bodega de la sucursal asignada',
    true
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

INSERT INTO public.roles (code, name, scope, is_system, is_active)
VALUES (
  'bodeguero_general',
  'Bodeguero general',
  'GLOBAL'::public.role_scope,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  scope = 'GLOBAL'::public.role_scope,
  is_system = true,
  is_active = true,
  updated_at = now();

-- Vincular el rol global al módulo para catálogo/permisos.
INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT r.id, m.id, 'OPERATE'::public.access_level
FROM public.roles r
CROSS JOIN public.modules m
WHERE r.code = 'bodeguero_general'
  AND m.code = 'bodega_general'
ON CONFLICT (role_id, module_id) DO UPDATE SET
  access_level = EXCLUDED.access_level,
  updated_at = now();

-- Solo un bodeguero general activo a la vez.
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = 'bodeguero_general';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro el rol bodeguero_general';
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_bodeguero_general
     ON public.user_global_roles (role_id)
     WHERE is_active = true AND role_id = %L::uuid',
    v_role_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.can_operate_bodega_general(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p_user_id
        AND ugr.is_active = true
        AND r.code = 'bodeguero_general'
        AND r.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.can_operate_bodega_general(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_operate_bodega_general(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_operate_bodega_sucursal(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.can_manage_branch_admin(p_user_id, p_branch_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'bodega_sucursal', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'bodega_sucursal', 'MANAGE'::public.access_level)
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_modules ubm
      JOIN public.modules m ON m.id = ubm.module_id
      WHERE ubm.user_id = p_user_id
        AND ubm.branch_id = p_branch_id
        AND ubm.is_active = true
        AND m.code = 'bodega_sucursal'
        AND m.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.can_operate_bodega_sucursal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_operate_bodega_sucursal(uuid, uuid) TO authenticated;

-- Asignación de rol global con mensaje claro si ya hay otro bodeguero general.
CREATE OR REPLACE FUNCTION public.assign_user_global_role(p_target_user_id uuid, p_role_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role_id uuid;
  v_existing_user_id uuid;
  v_existing_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_global_admin(v_actor) THEN
    RAISE EXCEPTION 'Solo administrador global puede asignar roles globales';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = p_role_code
    AND scope = 'GLOBAL'::public.role_scope
    AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rol global invalido';
  END IF;

  IF p_role_code = 'bodeguero_general' THEN
    SELECT ugr.user_id
    INTO v_existing_user_id
    FROM public.user_global_roles ugr
    WHERE ugr.role_id = v_role_id
      AND ugr.is_active = true
      AND ugr.user_id <> p_target_user_id
    LIMIT 1;

    IF v_existing_user_id IS NOT NULL THEN
      SELECT COALESCE(
        NULLIF(btrim(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
        NULLIF(btrim(p.alias), ''),
        NULLIF(btrim(p.username), ''),
        'otro usuario'
      )
      INTO v_existing_name
      FROM public.profiles p
      WHERE p.id = v_existing_user_id;

      RAISE EXCEPTION
        'Ya existe un bodeguero general asignado: %. Solo puede haber uno a la vez.',
        v_existing_name;
    END IF;
  END IF;

  INSERT INTO public.user_global_roles (user_id, role_id, is_active, assigned_by)
  VALUES (p_target_user_id, v_role_id, true, v_actor)
  ON CONFLICT (user_id, role_id)
  DO UPDATE SET is_active = true, assigned_by = v_actor, updated_at = now();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_user_global_role(uuid, text) TO authenticated;

-- Exponer permisos de bodega en el contexto de acceso del frontend.
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
  v_delegation_branch uuid;
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

  SELECT d.branch_id
  INTO v_delegation_branch
  FROM public.branch_supervisor_delegations d
  WHERE d.delegate_user_id = v_user_id
    AND d.effective_date = public.branch_local_date()
    AND d.revoked_at IS NULL
  ORDER BY d.created_at DESC
  LIMIT 1;

  IF v_delegation_branch IS NOT NULL
     AND (
       v_active_branch IS NULL
       OR NOT public.has_active_supervisor_delegation(v_user_id, v_active_branch)
     )
  THEN
    v_active_branch := v_delegation_branch;
    UPDATE public.profiles
    SET active_branch_id = v_active_branch, updated_at = now()
    WHERE id = v_user_id;
  END IF;

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
      SELECT d.branch_id, 0 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL

      UNION

      SELECT ub.branch_id, 1 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 2 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    ),
    ranked AS (
      SELECT DISTINCT ON (branch_id) branch_id
      FROM accessible_branch_ids
      ORDER BY branch_id, priority
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
      SELECT d.branch_id, 0 AS priority
      FROM public.branch_supervisor_delegations d
      WHERE d.delegate_user_id = v_user_id
        AND d.effective_date = public.branch_local_date()
        AND d.revoked_at IS NULL

      UNION

      SELECT ub.branch_id, 1 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 2 AS priority
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

    IF v_is_delegated_supervisor THEN
      PERFORM public.apply_supervisor_delegation_to_open_shift(v_active_branch, v_user_id);
    END IF;

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
          'turno', 'MANAGE',
          'mesas', 'OPERATE',
          'ordenes', 'OPERATE',
          'despacho_mesa', 'OPERATE',
          'despacho_para_llevar', 'OPERATE',
          'despacho_total', 'OPERATE',
          'caja', 'VIEW'
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

    IF public.can_operate_bodega_sucursal(v_user_id, v_active_branch) THEN
      v_permissions := COALESCE(v_permissions, '{}'::jsonb)
        || jsonb_build_object('bodega_sucursal', 'OPERATE');
    END IF;
  END IF;

  IF public.can_operate_bodega_general(v_user_id) THEN
    v_permissions := COALESCE(v_permissions, '{}'::jsonb)
      || jsonb_build_object('bodega_general', 'OPERATE');
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', v_is_global_admin,
    'is_temporary_supervisor', v_is_delegated_supervisor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

NOTIFY pgrst, 'reload schema';
