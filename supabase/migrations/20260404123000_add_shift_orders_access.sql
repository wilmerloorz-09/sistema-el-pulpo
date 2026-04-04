ALTER TABLE public.cash_shift_users
ADD COLUMN IF NOT EXISTS can_access_orders boolean NOT NULL DEFAULT false;

UPDATE public.cash_shift_users
SET can_access_orders = true
WHERE can_serve_tables = true
  AND can_access_orders = false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shift_users_has_capability_chk'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
    DROP CONSTRAINT cash_shift_users_has_capability_chk;
  END IF;
END;
$$;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  can_serve_tables = true OR
  can_access_orders = true OR
  can_dispatch_orders = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.shift_user_input'::regtype
      AND attname = 'can_access_orders'
      AND NOT attisdropped
  ) THEN
ALTER TYPE public.shift_user_input
    ADD ATTRIBUTE can_access_orders boolean;
  END IF;
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
  can_dispatch_orders boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
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

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
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
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.is_supervisor, false) AS is_supervisor
  FROM public.v_user_accessible_branches ub
  JOIN public.profiles p
    ON p.id = ub.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = ub.user_id
  WHERE ub.branch_id = p_branch_id
  ORDER BY p.full_name, p.username;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_my_branch_shift_gate(uuid);
CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate(
  p_branch_id uuid
)
RETURNS TABLE (
  shift_id uuid,
  shift_open boolean,
  user_enabled boolean,
  active_tables_count integer,
  caja_status public.caja_status,
  can_serve_tables boolean,
  can_access_orders boolean,
  can_dispatch_orders boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  is_supervisor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_active_tables_count integer := 0;
  v_caja_status public.caja_status;
  v_user_row record;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT cs.id, COALESCE(cs.active_tables_count, 0), cs.caja_status
  INTO v_shift_id, v_active_tables_count, v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT
    csu.is_enabled,
    csu.can_serve_tables,
    csu.can_access_orders,
    csu.can_dispatch_orders,
    csu.can_use_caja,
    csu.can_authorize_order_cancel,
    csu.is_supervisor
  INTO v_user_row
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift_id
    AND csu.user_id = auth.uid();

  RETURN QUERY
  SELECT
    v_shift_id,
    true,
    COALESCE(v_user_row.is_enabled, false),
    v_active_tables_count,
    v_caja_status,
    COALESCE(v_user_row.can_serve_tables, false),
    COALESCE(v_user_row.can_access_orders, COALESCE(v_user_row.can_serve_tables, false), false),
    COALESCE(v_user_row.can_dispatch_orders, false),
    COALESCE(v_user_row.can_use_caja, false),
    COALESCE(v_user_row.can_authorize_order_cancel, false),
    COALESCE(v_user_row.is_supervisor, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_shift_user_enabled(
  p_shift_id uuid,
  p_user_id uuid,
  p_is_enabled boolean,
  p_can_serve_tables boolean DEFAULT false,
  p_can_access_orders boolean DEFAULT false,
  p_can_dispatch_orders boolean DEFAULT false,
  p_can_use_caja boolean DEFAULT false,
  p_can_authorize_order_cancel boolean DEFAULT false,
  p_is_supervisor boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y user_id son obligatorios';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.status = 'OPEN';

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar usuarios de este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v_user_accessible_branches ub
    JOIN public.profiles p ON p.id = ub.user_id
    WHERE ub.branch_id = v_branch_id
      AND ub.user_id = p_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'El usuario no pertenece a la sucursal activa o no esta activo';
  END IF;

  INSERT INTO public.cash_shift_users (
    shift_id,
    user_id,
    is_enabled,
    can_serve_tables,
    can_access_orders,
    can_dispatch_orders,
    can_use_caja,
    can_authorize_order_cancel,
    is_supervisor
  )
  VALUES (
    p_shift_id,
    p_user_id,
    COALESCE(p_is_enabled, true),
    COALESCE(p_can_serve_tables, false),
    COALESCE(p_can_serve_tables, false) OR COALESCE(p_can_access_orders, false),
    COALESCE(p_can_dispatch_orders, false),
    COALESCE(p_can_use_caja, false),
    COALESCE(p_can_authorize_order_cancel, false),
    COALESCE(p_is_supervisor, false)
  )
  ON CONFLICT (shift_id, user_id)
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    can_serve_tables = EXCLUDED.can_serve_tables,
    can_access_orders = EXCLUDED.can_access_orders,
    can_dispatch_orders = EXCLUDED.can_dispatch_orders,
    can_use_caja = EXCLUDED.can_use_caja,
    can_authorize_order_cancel = EXCLUDED.can_authorize_order_cancel,
    is_supervisor = EXCLUDED.is_supervisor,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_shift_user_enabled(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;

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
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir turno con tu propio usuario autenticado';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para abrir turno en esta sucursal';
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

  IF p_enabled_users IS NOT NULL THEN
    FOREACH v_user_input IN ARRAY p_enabled_users
    LOOP
      INSERT INTO public.cash_shift_users (
        shift_id,
        user_id,
        is_enabled,
        can_serve_tables,
        can_access_orders,
        can_dispatch_orders,
        can_use_caja,
        can_authorize_order_cancel,
        is_supervisor
      )
      VALUES (
        v_shift_id,
        v_user_input.user_id,
        true,
        v_user_input.can_serve_tables,
        COALESCE(v_user_input.can_serve_tables, false) OR COALESCE(v_user_input.can_access_orders, false),
        v_user_input.can_dispatch_orders,
        v_user_input.can_use_caja,
        v_user_input.can_authorize_order_cancel,
        v_user_input.is_supervisor
      );
    END LOOP;
  ELSE
    INSERT INTO public.cash_shift_users (
      shift_id,
      user_id,
      is_enabled,
      can_serve_tables,
      can_access_orders,
      can_dispatch_orders,
      can_use_caja,
      can_authorize_order_cancel,
      is_supervisor
    )
    SELECT
      v_shift_id,
      p.id,
      true,
      true,
      true,
      true,
      true,
      true,
      p.id = p_cashier_id
    FROM public.v_user_accessible_branches ub
    JOIN public.profiles p
      ON p.id = ub.user_id
    WHERE ub.branch_id = p_branch_id
      AND p.is_active = true;
  END IF;

  RETURN v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, public.shift_user_input[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_dine_in_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid DEFAULT NULL,
  p_is_special boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shift_id uuid;
  v_order_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_table_branch_id uuid;
  v_table_is_active boolean := false;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'created_by es obligatorio';
  END IF;

  IF v_actor_id IS NULL OR v_actor_id <> p_created_by THEN
    RAISE EXCEPTION 'Usuario no autenticado o inconsistente';
  END IF;

  IF COALESCE(p_is_special, false) IS NOT TRUE AND p_table_id IS NULL THEN
    RAISE EXCEPTION 'La mesa es obligatoria para abrir una orden de mesa';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_shift_id,
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, p_branch_id)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para abrir ordenes de mesa en este turno.';
  END IF;

  IF p_table_id IS NOT NULL THEN
    SELECT rt.branch_id, rt.is_active
    INTO v_table_branch_id, v_table_is_active
    FROM public.restaurant_tables rt
    WHERE rt.id = p_table_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La mesa no existe.';
    END IF;

    IF v_table_branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'La mesa no pertenece a la sucursal activa.';
    END IF;

    IF v_table_is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'La mesa no esta habilitada en el turno actual.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id = p_table_id
        AND o.status NOT IN ('PAID', 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'La mesa ya tiene una orden activa.';
    END IF;
  END IF;

  INSERT INTO public.orders (
    branch_id,
    table_id,
    order_type,
    menu_scope,
    status,
    is_special,
    special_marked_at,
    special_marked_by,
    created_by
  )
  VALUES (
    p_branch_id,
    CASE WHEN COALESCE(p_is_special, false) THEN NULL ELSE p_table_id END,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    COALESCE(p_is_special, false),
    CASE WHEN COALESCE(p_is_special, false) THEN now() ELSE NULL END,
    CASE WHEN COALESCE(p_is_special, false) THEN v_actor_id ELSE NULL END,
    v_actor_id
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_dine_in_order(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dine_in_order(uuid, uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_dine_in_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_menu_node_id uuid DEFAULT NULL,
  p_quantity integer DEFAULT 1,
  p_unit_price numeric DEFAULT NULL,
  p_description_snapshot text DEFAULT NULL,
  p_item_note text DEFAULT NULL,
  p_modifier_ids uuid[] DEFAULT NULL,
  p_tray_item_type char DEFAULT NULL,
  p_tray_container_cost numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_product record;
  v_node record;
  v_item_id uuid;
  v_description text;
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_modifier_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'La orden y el producto son obligatorios';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  IF p_tray_item_type IS NOT NULL AND p_tray_item_type NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'Tipo de item no valido.';
  END IF;

  IF COALESCE(p_tray_container_cost, 0) < 0 THEN
    RAISE EXCEPTION 'El costo adicional no puede ser negativo.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.is_tray_order IS TRUE THEN
    RAISE EXCEPTION 'Esta orden debe usar el flujo de Orden Bandeja.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden agregar items a una orden cerrada.';
  END IF;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  SELECT p.id, p.description, p.is_active
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El producto no existe o esta inactivo.';
  END IF;

  IF p_menu_node_id IS NOT NULL THEN
    SELECT
      mn.id,
      mn.branch_id,
      mn.menu_scope,
      mn.node_type,
      mn.name,
      mn.is_active,
      mn.legacy_product_id
    INTO v_node
    FROM public.menu_nodes mn
    WHERE mn.id = p_menu_node_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado ya no existe en el arbol activo.';
    END IF;

    IF v_node.branch_id IS DISTINCT FROM v_order.branch_id THEN
      RAISE EXCEPTION 'El producto seleccionado no pertenece a la sucursal activa.';
    END IF;

    IF v_node.node_type <> 'product' OR v_node.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'El producto seleccionado ya no esta disponible para vender.';
    END IF;

    IF COALESCE(v_node.legacy_product_id, v_node.id) IS DISTINCT FROM p_product_id
       AND v_node.id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'El producto seleccionado no coincide con el catalogo operativo.';
    END IF;

    IF p_tray_item_type = 'C' AND v_node.menu_scope <> 'BULK' THEN
      RAISE EXCEPTION 'Los items a granel solo pueden salir del arbol BULK.';
    END IF;

    IF COALESCE(p_tray_item_type, '') <> 'C' AND v_node.menu_scope = 'BULK' THEN
      RAISE EXCEPTION 'Los productos BULK deben agregarse como item a granel.';
    END IF;
  END IF;

  IF p_menu_node_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.menu_nodes mn
      WHERE mn.branch_id = v_order.branch_id
        AND mn.node_type = 'product'
        AND mn.is_active = true
        AND (
          mn.legacy_product_id = p_product_id
          OR mn.id = p_product_id
        )
    ) THEN
      RAISE EXCEPTION 'El producto no pertenece al arbol activo de la sucursal.';
    END IF;
  END IF;

  IF COALESCE(p_tray_item_type, '') <> 'B' AND COALESCE(p_tray_container_cost, 0) <> 0 THEN
    RAISE EXCEPTION 'Solo los items tipo B pueden tener costo de tarrina.';
  END IF;

  v_description := COALESCE(
    NULLIF(trim(COALESCE(p_description_snapshot, '')), ''),
    NULLIF(trim(COALESCE(v_node.name, '')), ''),
    NULLIF(trim(COALESCE(v_product.description, '')), ''),
    'Producto'
  );

  INSERT INTO public.order_items (
    order_id,
    product_id,
    description_snapshot,
    quantity,
    unit_price,
    total,
    status,
    item_note,
    tray_item_type,
    tray_container_cost
  )
  VALUES (
    p_order_id,
    p_product_id,
    v_description,
    p_quantity,
    p_unit_price,
    ((p_quantity * p_unit_price) + COALESCE(p_tray_container_cost, 0))::numeric(10,2),
    'DRAFT',
    NULLIF(trim(COALESCE(p_item_note, '')), ''),
    p_tray_item_type,
    COALESCE(p_tray_container_cost, 0)
  )
  RETURNING id INTO v_item_id;

  IF COALESCE(array_length(p_modifier_ids, 1), 0) > 0 THEN
    FOREACH v_modifier_id IN ARRAY p_modifier_ids LOOP
      IF v_modifier_id IS NULL THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.modifiers m
        WHERE m.id = v_modifier_id
          AND m.branch_id = v_order.branch_id
          AND m.is_active = true
      ) THEN
        RAISE EXCEPTION 'Uno de los modificadores seleccionados no existe o esta inactivo.';
      END IF;

      INSERT INTO public.order_item_modifiers (
        id,
        order_item_id,
        modifier_id
      )
      VALUES (
        gen_random_uuid(),
        v_item_id,
        v_modifier_id
      );
    END LOOP;
  END IF;

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_dine_in_order_item(uuid, uuid, uuid, integer, numeric, text, text, uuid[], char, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_dine_in_order_item(uuid, uuid, uuid, integer, numeric, text, text, uuid[], char, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_order_draft_items(
  p_order_id uuid
)
RETURNS TABLE (
  order_id uuid,
  order_status public.order_status,
  submitted_item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_next_status := CASE
    WHEN v_order.order_type = 'TAKEOUT' THEN 'KITCHEN_DISPATCHED'::public.order_status
    ELSE 'SENT_TO_KITCHEN'::public.order_status
  END;

  UPDATE public.orders o
  SET
    status = v_next_status,
    sent_to_kitchen_at = CASE
      WHEN v_next_status = 'SENT_TO_KITCHEN' THEN COALESCE(o.sent_to_kitchen_at, v_now)
      ELSE o.sent_to_kitchen_at
    END,
    dispatched_at = CASE
      WHEN v_next_status = 'KITCHEN_DISPATCHED' THEN COALESCE(o.dispatched_at, v_now)
      ELSE o.dispatched_at
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order_draft_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_draft_items(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
