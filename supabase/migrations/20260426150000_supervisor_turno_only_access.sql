-- Separa el acceso de Turno de la Administracion general de sucursal.
-- El supervisor conserva la capacidad de abrir/cerrar/configurar turno,
-- pero deja de recibir el modulo admin_sucursal por defecto.

INSERT INTO public.modules (code, name, description, is_active)
VALUES ('turno', 'Turno', 'Apertura, cierre y configuracion del turno operativo', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

DELETE FROM public.role_permissions rp
USING public.roles r, public.modules m
WHERE rp.role_id = r.id
  AND rp.module_id = m.id
  AND r.code = 'supervisor'
  AND m.code = 'admin_sucursal';

INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT r.id, m.id, 'MANAGE'::public.access_level
FROM public.roles r
JOIN public.modules m ON m.code = 'turno'
WHERE r.code IN ('administrador', 'supervisor')
ON CONFLICT (role_id, module_id)
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now();

CREATE OR REPLACE FUNCTION public.can_manage_shift_admin(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'turno', 'MANAGE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_sucursal', 'MANAGE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_global', 'MANAGE'::public.access_level);
$$;

DROP POLICY IF EXISTS "Shift users can be managed by branch admins" ON public.cash_shift_users;
CREATE POLICY "Shift users can be managed by branch admins"
ON public.cash_shift_users
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_users.shift_id
      AND public.can_manage_shift_admin(auth.uid(), cs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_users.shift_id
      AND public.can_manage_shift_admin(auth.uid(), cs.branch_id)
  )
);

DROP POLICY IF EXISTS "Dispatch config can be viewed by branch dispatch users" ON public.dispatch_config;
DROP POLICY IF EXISTS "Dispatch config can be managed by branch admins" ON public.dispatch_config;

CREATE POLICY "Dispatch config can be viewed by branch dispatch users"
ON public.dispatch_config
FOR SELECT
TO authenticated
USING (
  public.can_manage_shift_admin(auth.uid(), branch_id)
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_total', 'VIEW')
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_mesa', 'VIEW')
  OR public.has_branch_permission(auth.uid(), branch_id, 'despacho_para_llevar', 'VIEW')
);

CREATE POLICY "Dispatch config can be managed by branch admins"
ON public.dispatch_config
FOR ALL
TO authenticated
USING (public.can_manage_shift_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_shift_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Dispatch assignments can be viewed by branch dispatch users" ON public.dispatch_assignments;
DROP POLICY IF EXISTS "Dispatch assignments can be managed by branch admins" ON public.dispatch_assignments;

CREATE POLICY "Dispatch assignments can be viewed by branch dispatch users"
ON public.dispatch_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND (
        public.can_manage_shift_admin(auth.uid(), dc.branch_id)
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_total', 'VIEW')
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_mesa', 'VIEW')
        OR public.has_branch_permission(auth.uid(), dc.branch_id, 'despacho_para_llevar', 'VIEW')
      )
  )
);

CREATE POLICY "Dispatch assignments can be managed by branch admins"
ON public.dispatch_assignments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND public.can_manage_shift_admin(auth.uid(), dc.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.dispatch_config dc
    WHERE dc.id = dispatch_assignments.dispatch_config_id
      AND public.can_manage_shift_admin(auth.uid(), dc.branch_id)
  )
);

CREATE OR REPLACE FUNCTION public.get_user_open_shift_conflict(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  shift_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_shift_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_current_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    b.id AS branch_id,
    b.name AS branch_name,
    cs.id AS shift_id
  FROM public.cash_shift_users csu
  JOIN public.cash_shifts cs
    ON cs.id = csu.shift_id
  JOIN public.branches b
    ON b.id = cs.branch_id
  WHERE csu.user_id = p_user_id
    AND csu.is_enabled = true
    AND cs.status = 'OPEN'
    AND (v_current_shift_id IS NULL OR cs.id <> v_current_shift_id)
  ORDER BY cs.opened_at DESC
  LIMIT 1;
END;
$$;

DROP FUNCTION IF EXISTS public.list_shift_users_for_branch(uuid);
CREATE OR REPLACE FUNCTION public.list_shift_users_for_branch(
  p_branch_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  is_profile_active boolean,
  is_enabled boolean,
  can_serve_tables boolean,
  can_access_orders boolean,
  can_edit_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  can_double_session boolean,
  is_supervisor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH branch_members AS (
    SELECT ub.user_id
    FROM public.user_branches ub
    WHERE ub.branch_id = p_branch_id

    UNION

    SELECT ugr.user_id
    FROM public.user_global_roles ugr
    JOIN public.roles r
      ON r.id = ugr.role_id
    WHERE ugr.is_active = true
      AND r.is_active = true
      AND r.scope = 'GLOBAL'::public.role_scope
      AND r.code = 'administrador'

    UNION

    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.is_active = true
      AND NOT public.is_global_admin(p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
  )
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_edit_orders, false) AS can_edit_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_manage_products, COALESCE(csu.can_dispatch_orders, false), false) AS can_manage_products,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.can_double_session, false) AS can_double_session,
    COALESCE(csu.is_supervisor, false) AS is_supervisor
  FROM branch_members bm
  JOIN public.profiles p
    ON p.id = bm.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = bm.user_id
  ORDER BY p.full_name, p.username;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_enabled_users public.shift_user_input[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_user_input public.shift_user_input;
  v_enabled_user_count integer := 0;
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir turno con tu propio usuario autenticado';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para abrir turno en esta sucursal';
  END IF;

  SELECT COUNT(*)
  INTO v_enabled_user_count
  FROM unnest(COALESCE(p_enabled_users, ARRAY[]::public.shift_user_input[])) AS enabled_user
  JOIN public.profiles p
    ON p.id = enabled_user.user_id
   AND p.is_active = true
  WHERE enabled_user.user_id IS NOT NULL
    AND (
      COALESCE(enabled_user.can_serve_tables, false)
      OR COALESCE(enabled_user.can_access_orders, false)
      OR COALESCE(enabled_user.can_edit_orders, false)
      OR COALESCE(enabled_user.can_dispatch_orders, false)
      OR COALESCE(enabled_user.can_manage_products, false)
      OR COALESCE(enabled_user.can_use_caja, false)
      OR COALESCE(enabled_user.can_authorize_order_cancel, false)
      OR COALESCE(enabled_user.is_supervisor, false)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.cash_shift_users other_user
      JOIN public.cash_shifts other_shift
        ON other_shift.id = other_user.shift_id
      WHERE other_user.user_id = enabled_user.user_id
        AND other_user.is_enabled = true
        AND other_shift.status = 'OPEN'
    )
    AND (
      COALESCE(enabled_user.is_supervisor, false) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = enabled_user.user_id
          AND ubr.branch_id = p_branch_id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )
    );

  IF v_enabled_user_count = 0 THEN
    RAISE EXCEPTION 'No se puede abrir el turno sin al menos un usuario habilitado con rol operativo disponible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto en la sucursal activa';
  END IF;

  INSERT INTO public.cash_shifts (
    id,
    cashier_id,
    branch_id,
    active_tables_count,
    status,
    caja_status,
    opened_at
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    'UNOPENED',
    v_now
  );

  PERFORM public.configure_shift_active_tables(
    p_branch_id,
    v_shift_id,
    p_active_tables_count
  );

  FOREACH v_user_input IN ARRAY p_enabled_users
  LOOP
    IF v_user_input.user_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.cash_shift_users (
      shift_id,
      user_id,
      is_enabled,
      can_serve_tables,
      can_access_orders,
      can_edit_orders,
      can_dispatch_orders,
      can_manage_products,
      can_use_caja,
      can_authorize_order_cancel,
      can_double_session,
      is_supervisor
    )
    VALUES (
      v_shift_id,
      v_user_input.user_id,
      true,
      COALESCE(v_user_input.can_serve_tables, false),
      COALESCE(v_user_input.can_serve_tables, false) OR COALESCE(v_user_input.can_access_orders, false),
      COALESCE(v_user_input.can_edit_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false),
      COALESCE(v_user_input.can_dispatch_orders, false) OR COALESCE(v_user_input.can_manage_products, false),
      COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.can_authorize_order_cancel, false),
      COALESCE(v_user_input.can_double_session, false) AND COALESCE(v_user_input.can_use_caja, false),
      COALESCE(v_user_input.is_supervisor, false)
    );
  END LOOP;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL,
  p_closed_from_device text DEFAULT NULL,
  p_closed_from_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_pending_orders_count integer := 0;
  v_pending_orders_preview text := '';
  v_actor_id uuid := auth.uid();
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'No puedes cerrar el turno porque la caja esta abierta. Cierra la caja en el modulo Caja y vuelve a intentarlo.';
  END IF;

  PERFORM public.cancel_empty_draft_orders_for_branch(p_branch_id);

  SELECT COUNT(*)
  INTO v_pending_orders_count
  FROM public.list_branch_closure_blocking_orders(p_branch_id);

  IF v_pending_orders_count > 0 THEN
    SELECT COALESCE(string_agg(reference_label, ', '), '')
    INTO v_pending_orders_preview
    FROM (
      SELECT reference_label
      FROM public.list_branch_closure_blocking_orders(p_branch_id)
      LIMIT 5
    ) AS pending_refs;

    RAISE EXCEPTION
      'No puedes cerrar el turno porque aun existen ordenes o cobros pendientes. Finaliza o cobra esas ordenes primero.%s',
      CASE
        WHEN v_pending_orders_preview <> '' THEN ' Referencias: ' || v_pending_orders_preview
        ELSE ''
      END;
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes,
      closed_by = v_actor_id,
      closed_from_device = NULLIF(btrim(COALESCE(p_closed_from_device, '')), ''),
      closed_from_user_agent = NULLIF(btrim(COALESCE(p_closed_from_user_agent, '')), '')
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

DROP FUNCTION IF EXISTS public.save_branch_cancel_policy(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.save_branch_cancel_policy(
  p_branch_id uuid,
  p_policies jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_global_admin boolean := public.is_global_admin(auth.uid());
  v_entry jsonb;
  v_menu_node_id uuid;
  v_is_kitchen_plate boolean;
  v_allow_direct_cancel boolean;
  v_existing public.branch_cancel_policy%ROWTYPE;
  v_existing_kitchen boolean;
  v_is_primary_root_category boolean;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF jsonb_typeof(COALESCE(p_policies, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'policies debe ser un arreglo JSON';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar anulaciones directas en esta sucursal';
  END IF;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb))
  LOOP
    v_menu_node_id := NULLIF(v_entry->>'menu_node_id', '')::uuid;
    v_is_kitchen_plate := COALESCE((v_entry->>'is_kitchen_plate')::boolean, false);
    v_allow_direct_cancel := COALESCE((v_entry->>'allow_direct_cancel')::boolean, false);

    IF v_menu_node_id IS NULL THEN
      RAISE EXCEPTION 'Cada politica debe incluir menu_node_id';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.menu_nodes mn
      WHERE mn.id = v_menu_node_id
        AND mn.branch_id = p_branch_id
        AND mn.node_type = 'category'
        AND mn.depth = 0
        AND mn.parent_id IS NULL
        AND mn.is_active = true
    )
    INTO v_is_primary_root_category;

    IF NOT v_is_primary_root_category THEN
      CONTINUE;
    END IF;

    SELECT v_menu_node_id = root.id
    INTO v_is_primary_root_category
    FROM (
      SELECT mn.id
      FROM public.menu_nodes mn
      WHERE mn.branch_id = p_branch_id
        AND mn.node_type = 'category'
        AND mn.depth = 0
        AND mn.parent_id IS NULL
        AND mn.is_active = true
      ORDER BY mn.display_order, mn.name, mn.id
      LIMIT 1
    ) root;

    SELECT *
    INTO v_existing
    FROM public.branch_cancel_policy bcp
    WHERE bcp.branch_id = p_branch_id
      AND bcp.menu_node_id = v_menu_node_id;

    v_existing_kitchen := COALESCE(v_existing.is_kitchen_plate, false);

    IF NOT v_is_global_admin THEN
      IF COALESCE(v_is_primary_root_category, false) THEN
        RAISE EXCEPTION 'La primera categoria de nivel 0 solo puede ser editada por un administrador general';
      END IF;

      IF v_is_kitchen_plate IS DISTINCT FROM v_existing_kitchen THEN
        RAISE EXCEPTION 'Solo un administrador general puede cambiar si una categoria es plato de cocina';
      END IF;
    END IF;

    IF NOT v_is_kitchen_plate AND NOT v_allow_direct_cancel THEN
      DELETE FROM public.branch_cancel_policy
      WHERE branch_id = p_branch_id
        AND menu_node_id = v_menu_node_id;
    ELSE
      INSERT INTO public.branch_cancel_policy (
        branch_id,
        menu_node_id,
        is_kitchen_plate,
        allow_direct_cancel,
        updated_by
      )
      VALUES (
        p_branch_id,
        v_menu_node_id,
        v_is_kitchen_plate,
        v_allow_direct_cancel,
        auth.uid()
      )
      ON CONFLICT (branch_id, menu_node_id)
      DO UPDATE SET
        is_kitchen_plate = EXCLUDED.is_kitchen_plate,
        allow_direct_cancel = EXCLUDED.allow_direct_cancel,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_shift_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_open_shift_conflict(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_branch_cancel_policy(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
