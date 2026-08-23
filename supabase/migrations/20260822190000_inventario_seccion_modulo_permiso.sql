-- Sección Inventario: módulo movimientos, permiso por sucursal (user_branch_modules) y RPC/RLS.

INSERT INTO public.modules (code, name, description, is_active)
VALUES (
  'inventario_movimientos',
  'Movimientos de inventario',
  'Registrar ingresos, salidas y ajustes de stock por sucursal',
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true;

CREATE OR REPLACE FUNCTION public.can_operate_inventario_movimientos(
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
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'MANAGE'::public.access_level)
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_modules ubm
      JOIN public.modules m ON m.id = ubm.module_id
      WHERE ubm.user_id = p_user_id
        AND ubm.branch_id = p_branch_id
        AND ubm.is_active = true
        AND m.code = 'inventario_movimientos'
        AND m.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.can_operate_inventario_movimientos(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_operate_inventario_movimientos(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_inventario_movimientos(
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
    public.can_operate_inventario_movimientos(p_user_id, p_branch_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'inventario_movimientos', 'VIEW'::public.access_level);
$$;

REVOKE ALL ON FUNCTION public.can_view_inventario_movimientos(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_inventario_movimientos(uuid, uuid) TO authenticated;

-- Actualizar RPC de movimientos: permiso dedicado (no solo admin).
CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_sucursal_id uuid,
  p_tipo_movimiento public.tipo_movimiento_inventario,
  p_cantidad numeric,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  movimiento_id uuid,
  producto_id uuid,
  sucursal_id uuid,
  tipo_movimiento public.tipo_movimiento_inventario,
  cantidad_movimiento numeric,
  cantidad_anterior numeric,
  cantidad_nueva numeric,
  motivo text,
  registrado_por uuid,
  registrado_por_nombre text,
  creado_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_movimiento_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_producto_id IS NULL OR p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'producto_id y sucursal_id son obligatorios';
  END IF;

  IF p_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es obligatorio';
  END IF;

  IF v_motivo IS NULL AND p_tipo_movimiento <> 'INGRESO' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para el movimiento';
  END IF;

  IF v_motivo IS NULL THEN
    v_motivo := 'Ingreso';
  END IF;

  IF NOT public.can_operate_inventario_movimientos(v_actor_id, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos en esta sucursal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_producto_id) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_sucursal_id) THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);

  IF p_tipo_movimiento IN ('INGRESO', 'SALIDA') AND v_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento debe ser mayor a 0';
  END IF;

  IF p_tipo_movimiento = 'AJUSTE' AND v_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad de ajuste no puede ser negativa';
  END IF;

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      activo
    )
    VALUES (p_producto_id, p_sucursal_id, 0, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'INGRESO' THEN
    v_nueva := v_anterior + v_cantidad;
  ELSIF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
  ELSE
    v_nueva := v_cantidad;
  END IF;

  UPDATE public.inventario_productos
  SET cantidad_disponible = v_nueva
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.movimientos_inventario (
    producto_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_producto_id,
    p_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    v_registrado_nombre
  )
  RETURNING id INTO v_movimiento_id;

  RETURN QUERY
  SELECT
    v_movimiento_id,
    p_producto_id,
    p_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    v_registrado_nombre,
    now();
END;
$$;

DROP POLICY IF EXISTS "Movimientos inventario select por sucursal" ON public.movimientos_inventario;
CREATE POLICY "Movimientos inventario select por sucursal"
ON public.movimientos_inventario
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.can_view_inventario_movimientos(auth.uid(), sucursal_id)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'VIEW'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'VIEW'::public.access_level)
);

-- Exponer inventario_movimientos en permisos efectivos del frontend.
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
      'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH'),
      'printer_ip', b.printer_ip,
      'printer_port', b.printer_port
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
      'printer_port', b.printer_port
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

NOTIFY pgrst, 'reload schema';
