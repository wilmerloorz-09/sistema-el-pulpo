-- =============================================================================
-- Fix: record "v_node" is not assigned yet en add_dine_in_order_item
-- =============================================================================
-- Con p_menu_node_id NULL, PL/pgSQL evaluaba v_node.name dentro del COALESCE/CASE
-- y fallaba al aumentar cantidad de una linea ya enviada ("Enviar a cocina").
-- =============================================================================

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
  v_node_loaded boolean := false;
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

    v_node_loaded := true;

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
  ELSE
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

  -- Evitar COALESCE/CASE sobre v_node cuando no fue asignado (error PL/pgSQL).
  v_description := NULLIF(trim(COALESCE(p_description_snapshot, '')), '');
  IF v_description IS NULL AND v_node_loaded THEN
    v_description := NULLIF(trim(COALESCE(v_node.name, '')), '');
  END IF;
  IF v_description IS NULL THEN
    v_description := NULLIF(trim(COALESCE(v_product.description, '')), '');
  END IF;
  IF v_description IS NULL THEN
    v_description := 'Producto';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.add_dine_in_order_item(uuid, uuid, uuid, integer, numeric, text, text, uuid[], char, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
