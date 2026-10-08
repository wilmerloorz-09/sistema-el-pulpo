-- =============================================================================
-- Nevera: descontar al agregar el producto a la orden (no al enviar)
-- =============================================================================
-- - Agregar / subir cantidad en borrador: SALIDA. Bajar / quitar en borrador: INGRESO.
-- - Enviar solo descuenta lo que la linea aun no tenga descontado (sin doble descuento).
-- - Autopedido QR pendiente: no descuenta hasta aprobarse (aprobar -> submit).
-- - Pedidos express externos: descuentan al enviarse (antes no descontaban).
-- - Eliminar orden borrador / cierre de turno: devuelven lo descontado de los borradores.
-- - Mover items entre ordenes: el descuento viaja con el item.
-- Base: definiciones vigentes en produccion al 2026-10-07.
-- =============================================================================

-- Neto descontado de nevera (SALIDA - INGRESO) asociado a una linea de orden.
CREATE OR REPLACE FUNCTION public.inventario_neto_descontado_item(p_order_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN mi.tipo_movimiento = 'SALIDA' THEN mi.cantidad_movimiento ELSE -mi.cantidad_movimiento END
  ), 0)
  FROM public.movimientos_inventario mi
  WHERE mi.order_item_id = p_order_item_id
    AND mi.origen_venta IS NOT NULL
    AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO');
$$;

-- Deja la nevera alineada con la cantidad de una linea en borrador.
-- Los autopedidos QR pendientes no descuentan: lo hacen al aprobarse (envio).
CREATE OR REPLACE FUNCTION public.inventario_sincronizar_item_borrador(
  p_order_item_id uuid,
  p_actor_id uuid,
  p_origen text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_diff numeric(14, 3);
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.product_id IS NULL OR v_item.status <> 'DRAFT' THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF NOT FOUND OR COALESCE(v_order.estado_aprobacion_qr::text, '') = 'PENDIENTE' THEN
    RETURN;
  END IF;

  v_diff := COALESCE(v_item.quantity, 0) - public.inventario_neto_descontado_item(p_order_item_id);

  IF v_diff > 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      v_order.branch_id, v_item.product_id, v_diff,
      'SALIDA'::public.tipo_movimiento_inventario,
      v_order.id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
    );
  ELSIF v_diff < 0 THEN
    PERFORM public.inventario_movimiento_venta_internal(
      v_order.branch_id, v_item.product_id, -v_diff,
      'INGRESO'::public.tipo_movimiento_inventario,
      v_order.id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
    );
  END IF;
END;
$$;

-- Devuelve a nevera todo lo descontado por una linea en borrador (antes de borrarla:
-- al borrar la fila, movimientos_inventario.order_item_id queda en NULL).
CREATE OR REPLACE FUNCTION public.inventario_devolver_item_borrador(
  p_order_item_id uuid,
  p_actor_id uuid,
  p_origen text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_branch_id uuid;
  v_neto numeric(14, 3);
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.product_id IS NULL THEN
    RETURN;
  END IF;

  v_neto := public.inventario_neto_descontado_item(p_order_item_id);
  IF v_neto <= 0 THEN
    RETURN;
  END IF;

  SELECT o.branch_id INTO v_branch_id FROM public.orders o WHERE o.id = v_item.order_id;

  PERFORM public.inventario_movimiento_venta_internal(
    v_branch_id, v_item.product_id, v_neto,
    'INGRESO'::public.tipo_movimiento_inventario,
    v_item.order_id, v_item.id, p_origen, p_actor_id, v_item.description_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inventario_devolver_borradores_orden(
  p_order_id uuid,
  p_actor_id uuid,
  p_origen text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oi.id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status = 'DRAFT'
  LOOP
    PERFORM public.inventario_devolver_item_borrador(r.id, p_actor_id, p_origen);
  END LOOP;
END;
$$;

-- Al mover cantidad de una linea a otra orden, el descuento viaja con ella
-- (si no, la linea destino se descontaria otra vez al enviarse y no devolveria al quitarse).
CREATE OR REPLACE FUNCTION public.inventario_trasladar_descuento_item(
  p_origen_item_id uuid,
  p_destino_item_id uuid,
  p_cantidad numeric,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src public.order_items%ROWTYPE;
  v_dst public.order_items%ROWTYPE;
  v_branch_id uuid;
  v_qty numeric(14, 3);
BEGIN
  SELECT * INTO v_src FROM public.order_items WHERE id = p_origen_item_id;
  SELECT * INTO v_dst FROM public.order_items WHERE id = p_destino_item_id;
  IF v_src.id IS NULL OR v_dst.id IS NULL OR v_src.product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.branch_id INTO v_branch_id FROM public.orders o WHERE o.id = v_src.order_id;
  IF NOT public.inventario_debe_controlar_venta(v_branch_id, v_src.product_id) THEN
    RETURN;
  END IF;

  v_qty := LEAST(COALESCE(p_cantidad, 0), public.inventario_neto_descontado_item(p_origen_item_id));
  IF v_qty <= 0 THEN
    RETURN;
  END IF;

  PERFORM public.inventario_movimiento_venta_internal(
    v_branch_id, v_src.product_id, v_qty,
    'INGRESO'::public.tipo_movimiento_inventario,
    v_src.order_id, v_src.id, 'TRASLADO', p_actor_id, v_src.description_snapshot
  );
  PERFORM public.inventario_movimiento_venta_internal(
    v_branch_id, v_src.product_id, v_qty,
    'SALIDA'::public.tipo_movimiento_inventario,
    v_dst.order_id, v_dst.id, 'TRASLADO', p_actor_id, v_src.description_snapshot
  );
END;
$$;

-- Al enviar solo se descuenta lo que la linea aun no tenga descontado
-- (autopedidos QR aprobados, pedidos express externos, borradores previos a este cambio).
CREATE OR REPLACE FUNCTION public.inventario_descontar_draft_orden(p_order_id uuid, p_sucursal_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_pendiente numeric(14, 3);
BEGIN
  FOR v_item IN
    SELECT
      oi.id,
      oi.product_id,
      oi.quantity,
      oi.description_snapshot
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status = 'DRAFT'
      AND COALESCE(oi.quantity, 0) > 0
      AND oi.product_id IS NOT NULL
  LOOP
    v_pendiente := v_item.quantity - public.inventario_neto_descontado_item(v_item.id);
    IF v_pendiente > 0 THEN
      PERFORM public.inventario_movimiento_venta_internal(
        p_sucursal_id,
        v_item.product_id,
        v_pendiente,
        'SALIDA'::public.tipo_movimiento_inventario,
        p_order_id,
        v_item.id,
        'ENVIO',
        p_actor_id,
        v_item.description_snapshot
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_dine_in_order_item(p_order_id uuid, p_product_id uuid, p_menu_node_id uuid DEFAULT NULL::uuid, p_quantity integer DEFAULT 1, p_unit_price numeric DEFAULT NULL::numeric, p_description_snapshot text DEFAULT NULL::text, p_item_note text DEFAULT NULL::text, p_modifier_ids uuid[] DEFAULT NULL::uuid[], p_tray_item_type character DEFAULT NULL::bpchar, p_tray_container_cost numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  PERFORM public.inventario_sincronizar_item_borrador(v_item_id, v_actor_id, 'AGREGAR');

  RETURN v_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_tray_order_item(p_order_id uuid, p_product_id uuid, p_quantity integer, p_unit_price numeric, p_tray_item_type character, p_tray_container_cost numeric DEFAULT 0, p_item_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_product record;
  v_can_serve_tables boolean := false;
  v_has_operate_permission boolean := false;
  v_item_id uuid;
  v_description text;
  v_expected_scope text := CASE WHEN p_tray_item_type = 'C' THEN 'BULK' ELSE 'TAKEOUT' END;
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

  IF p_tray_item_type NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'Tipo de item no valido. Debe ser A, B o C.';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  IF COALESCE(p_tray_container_cost, 0) < 0 THEN
    RAISE EXCEPTION 'El costo de tarrina no puede ser negativo.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.is_tray_order IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta orden no es una Orden Bandeja.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden agregar items a una orden cerrada.';
  END IF;

  SELECT csu.can_serve_tables
  INTO v_can_serve_tables
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

  IF COALESCE(v_can_serve_tables, false) IS NOT TRUE AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  SELECT p.id, p.description, p.is_active
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El producto no existe o esta inactivo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_order.branch_id
      AND mn.menu_scope = v_expected_scope
      AND mn.node_type = 'product'
      AND mn.legacy_product_id = p_product_id
      AND mn.is_active = true
  ) THEN
    RAISE EXCEPTION 'El producto no esta disponible en el arbol % de la sucursal activa.', v_expected_scope;
  END IF;

  IF p_tray_item_type <> 'B' AND COALESCE(p_tray_container_cost, 0) <> 0 THEN
    RAISE EXCEPTION 'Solo los items tipo B pueden tener costo de tarrina.';
  END IF;

  v_description := COALESCE(NULLIF(trim(v_product.description), ''), 'Producto');

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

  PERFORM public.inventario_sincronizar_item_borrador(v_item_id, v_actor_id, 'AGREGAR');

  RETURN v_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_tray_order_item(p_order_id uuid, p_product_id uuid, p_quantity integer, p_unit_price numeric, p_tray_item_type character, p_tray_container_cost numeric DEFAULT 0, p_item_note text DEFAULT NULL::text, p_modifier_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_product record;
  v_can_serve_tables boolean := false;
  v_has_operate_permission boolean := false;
  v_item_id uuid;
  v_description text;
  v_expected_scope text := CASE WHEN p_tray_item_type = 'C' THEN 'BULK' ELSE 'TAKEOUT' END;
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

  IF p_tray_item_type NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'Tipo de item no valido. Debe ser A, B o C.';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  IF COALESCE(p_tray_container_cost, 0) < 0 THEN
    RAISE EXCEPTION 'El costo de tarrina no puede ser negativo.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.is_tray_order IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta orden no es una Orden Bandeja.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden agregar items a una orden cerrada.';
  END IF;

  SELECT csu.can_serve_tables
  INTO v_can_serve_tables
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

  IF COALESCE(v_can_serve_tables, false) IS NOT TRUE AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  SELECT p.id, p.description, p.is_active
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El producto no existe o esta inactivo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_order.branch_id
      AND mn.menu_scope = v_expected_scope
      AND mn.node_type = 'product'
      AND mn.legacy_product_id = p_product_id
      AND mn.is_active = true
  ) THEN
    RAISE EXCEPTION 'El producto no esta disponible en el arbol % de la sucursal activa.', v_expected_scope;
  END IF;

  IF p_tray_item_type <> 'B' AND COALESCE(p_tray_container_cost, 0) <> 0 THEN
    RAISE EXCEPTION 'Solo los items tipo B pueden tener costo de tarrina.';
  END IF;

  v_description := COALESCE(NULLIF(trim(v_product.description), ''), 'Producto');

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

  PERFORM public.inventario_sincronizar_item_borrador(v_item_id, v_actor_id, 'AGREGAR');

  RETURN v_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_draft_order_item_quantity(p_item_id uuid, p_quantity integer, p_unit_price numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_effective_unit_price numeric;
  v_paid_qty integer := 0;
  v_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_dispatch_first boolean := false;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
  v_qty_to_cancel integer := 0;
  v_cancellation_id uuid;
  v_cancel_pending integer := 0;
  v_cancel_ready integer := 0;
  v_cancel_dispatched integer := 0;
  v_remaining integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
  END IF;

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_paid_qty := COALESCE(v_paid_qty, 0);

  IF v_item.status <> 'DRAFT' AND v_paid_qty > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
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

  IF v_item.status <> 'DRAFT' AND (p_quantity = 0 OR p_quantity < COALESCE(v_item.quantity, 0)) THEN
    SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
    INTO v_workflow_mode
    FROM public.branches b
    WHERE b.id = v_order.branch_id;

    v_dispatch_first :=
      v_order.order_type = 'EXPRESS'
      OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND COALESCE(v_order.order_type::text, '') <> 'TAKEOUT');

    IF v_dispatch_first THEN
      SELECT
        COALESCE(snapshot.quantity_pending_prepare, 0),
        COALESCE(snapshot.quantity_ready_available, 0),
        GREATEST(
          0,
          COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
        )
      INTO v_pending_prepare, v_ready_available, v_dispatched_net
      FROM public.get_order_operational_snapshot(v_order.id) snapshot
      WHERE snapshot.order_item_id = p_item_id;

      v_operational_active := v_pending_prepare + v_ready_available + v_dispatched_net;

      IF v_dispatched_net = 0 AND v_operational_active > 0 THEN
        IF p_quantity = 0 THEN
          v_qty_to_cancel := v_operational_active;
        ELSE
          v_qty_to_cancel := GREATEST(0, v_operational_active - p_quantity);
        END IF;

        IF v_qty_to_cancel <= 0 THEN
          RETURN;
        END IF;

        IF v_qty_to_cancel > v_operational_active THEN
          RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para este item.';
        END IF;

        INSERT INTO public.order_cancellations (
          order_id,
          cancellation_type,
          reason,
          notes,
          created_by,
          status,
          created_at
        ) VALUES (
          v_order.id,
          'partial',
          'Eliminado desde orden',
          NULL,
          v_actor_id,
          'APPLIED',
          v_now
        )
        RETURNING id INTO v_cancellation_id;

        v_cancel_pending := LEAST(v_qty_to_cancel, v_pending_prepare);
        v_remaining := GREATEST(0, v_qty_to_cancel - v_cancel_pending);
        v_cancel_ready := LEAST(v_remaining, v_ready_available);
        v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
        v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

        IF v_cancel_pending > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_pending,
            v_item.unit_price,
            ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
            'PENDING',
            v_now
          );
        END IF;

        IF v_cancel_ready > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_ready,
            v_item.unit_price,
            ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
            'READY',
            v_now
          );
        END IF;

        IF v_cancel_dispatched > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_dispatched,
            v_item.unit_price,
            ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
            'DISPATCHED',
            v_now
          );
        END IF;

        UPDATE public.orders
        SET cancel_requested_at = NULL,
            cancel_requested_by = NULL
        WHERE id = v_order.id;

        PERFORM public.inventario_restaurar_por_order_item(
          v_order.branch_id,
          p_item_id,
          v_qty_to_cancel,
          v_order.id,
          v_actor_id,
          'DIRECT_CANCEL'
        );

        PERFORM public.recompute_order_operational_state(v_order.id);
        PERFORM public.sync_order_payment_state_internal(v_order.id);
        RETURN;
      END IF;
    END IF;

    IF p_quantity = 0 THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    IF p_quantity < COALESCE(v_item.quantity, 0) THEN
      RAISE EXCEPTION 'Para reducir un item ya enviado usa el flujo de anulacion.';
    END IF;
  END IF;

  IF p_quantity = 0 THEN
    IF v_item.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    PERFORM public.inventario_devolver_item_borrador(p_item_id, v_actor_id, 'QUITAR');

    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = p_item_id;

    DELETE FROM public.order_items
    WHERE id = p_item_id;

    PERFORM public.recompute_order_operational_state(v_order.id);
    RETURN;
  END IF;

  v_effective_unit_price := COALESCE(p_unit_price, v_item.unit_price);

  IF v_effective_unit_price IS NULL OR v_effective_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  IF v_item.status <> 'DRAFT' THEN
    SELECT
      COALESCE(snapshot.quantity_pending_prepare, 0)
      + COALESCE(snapshot.quantity_ready_available, 0)
      + GREATEST(
          0,
          COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
        )
    INTO v_operational_active
    FROM public.get_order_operational_snapshot(v_order.id) snapshot
    WHERE snapshot.order_item_id = p_item_id;

    v_operational_active := COALESCE(v_operational_active, 0);

    IF p_quantity > v_operational_active AND v_item.product_id IS NOT NULL THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_item.product_id,
        p_quantity - v_operational_active,
        'SALIDA'::public.tipo_movimiento_inventario,
        v_order.id,
        p_item_id,
        'AJUSTE_QTY',
        v_actor_id,
        v_item.description_snapshot
      );
    END IF;
  END IF;

  UPDATE public.order_items
  SET quantity = p_quantity,
      unit_price = v_effective_unit_price,
      total = ((p_quantity * v_effective_unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
  WHERE id = p_item_id;

  IF v_item.status = 'DRAFT' THEN
    PERFORM public.inventario_sincronizar_item_borrador(p_item_id, v_actor_id, 'AJUSTE_BORRADOR');
  END IF;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_order_item_line(p_item_id uuid, p_target_quantity integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_paid_qty integer := 0;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
  v_visible_qty integer := 0;
  v_qty_to_cancel integer := 0;
  v_cancellation_id uuid;
  v_cancel_pending integer := 0;
  v_cancel_ready integer := 0;
  v_cancel_dispatched integer := 0;
  v_remaining integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_target_quantity IS NULL OR p_target_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
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

  IF v_item.status = 'DRAFT' THEN
    IF p_target_quantity = 0 OR p_target_quantity < COALESCE(v_item.quantity, 0) THEN
      IF p_target_quantity = 0 THEN
        PERFORM public.inventario_devolver_item_borrador(p_item_id, v_actor_id, 'QUITAR');
        DELETE FROM public.order_item_modifiers WHERE order_item_id = p_item_id;
        DELETE FROM public.order_items WHERE id = p_item_id;
        PERFORM public.recompute_order_operational_state(v_order.id);
        RETURN;
      END IF;

      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;

      PERFORM public.inventario_sincronizar_item_borrador(p_item_id, v_actor_id, 'AJUSTE_BORRADOR');
      PERFORM public.recompute_order_operational_state(v_order.id);
      RETURN;
    END IF;

    IF p_target_quantity > COALESCE(v_item.quantity, 0) THEN
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.inventario_sincronizar_item_borrador(p_item_id, v_actor_id, 'AJUSTE_BORRADOR');
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;

    RETURN;
  END IF;

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  IF COALESCE(v_paid_qty, 0) > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
  END IF;

  SELECT
    COALESCE(snapshot.quantity_pending_prepare, 0),
    COALESCE(snapshot.quantity_ready_available, 0),
    GREATEST(
      0,
      COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
    )
  INTO v_pending_prepare, v_ready_available, v_dispatched_net
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_operational_active := v_pending_prepare + v_ready_available + v_dispatched_net;
  v_visible_qty := v_operational_active;

  IF v_visible_qty <= 0 AND p_target_quantity <= 0 THEN
    RETURN;
  END IF;

  IF v_dispatched_net > 0 AND p_target_quantity < v_visible_qty THEN
    RAISE EXCEPTION 'No se puede eliminar un item ya despachado desde aqui.';
  END IF;

  IF p_target_quantity = 0 THEN
    v_qty_to_cancel := v_operational_active;
  ELSE
    v_qty_to_cancel := GREATEST(0, v_visible_qty - p_target_quantity);
  END IF;

  IF v_qty_to_cancel <= 0 THEN
    IF p_target_quantity > v_visible_qty AND v_item.product_id IS NOT NULL THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_item.product_id,
        p_target_quantity - v_visible_qty,
        'SALIDA'::public.tipo_movimiento_inventario,
        v_order.id,
        p_item_id,
        'AJUSTE_QTY',
        v_actor_id,
        v_item.description_snapshot
      );
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;
    RETURN;
  END IF;

  IF v_qty_to_cancel > v_operational_active THEN
    RAISE EXCEPTION 'No puedes eliminar mas cantidad de la disponible.';
  END IF;

  INSERT INTO public.order_cancellations (
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    v_order.id,
    'partial',
    'Eliminado desde orden',
    NULL,
    v_actor_id,
    'APPLIED',
    v_now
  )
  RETURNING id INTO v_cancellation_id;

  v_cancel_pending := LEAST(v_qty_to_cancel, v_pending_prepare);
  v_remaining := GREATEST(0, v_qty_to_cancel - v_cancel_pending);
  v_cancel_ready := LEAST(v_remaining, v_ready_available);
  v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
  v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

  IF v_cancel_pending > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_pending, v_item.unit_price,
      ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
      'PENDING', v_now
    );
  END IF;

  IF v_cancel_ready > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_ready, v_item.unit_price,
      ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
      'READY', v_now
    );
  END IF;

  IF v_cancel_dispatched > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_dispatched, v_item.unit_price,
      ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
      'DISPATCHED', v_now
    );
  END IF;

  PERFORM public.inventario_restaurar_por_order_item(
    v_order.branch_id,
    p_item_id,
    v_qty_to_cancel,
    v_order.id,
    v_actor_id,
    'REMOVE_LINE'
  );

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = v_order.id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._enviar_orden_express_pedidos_interno(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_draft_count integer := 0;
  v_new_order_number integer;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_actor_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.order_type <> 'EXPRESS' THEN
    RAISE EXCEPTION 'Esta operacion solo aplica a ordenes Express.';
  END IF;

  IF v_order.status IN ('PAID', 'KITCHEN_DISPATCHED', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
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

  -- Pedido externo sin usuario del sistema: el movimiento se registra a nombre del cajero del turno.
  IF v_actor_id IS NULL THEN
    SELECT cs.cashier_id INTO v_actor_id FROM public.cash_shifts cs WHERE cs.id = v_order.cash_shift_id;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);
  END IF;

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_number IS NULL THEN
    v_new_order_number := nextval('orders_order_number_seq');
  END IF;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
    INTO v_branch_token
    FROM public.branches
    WHERE id = v_order.branch_id;

    v_date_part := to_char(COALESCE(v_order.created_at, v_now) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

    LOOP
      v_try := v_try + 1;
      v_seq := public.next_human_sequence('orders_daily', v_order.branch_id, v_date_part);
      v_new_order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.order_code = v_new_order_code);
      IF v_try >= 50 THEN
        RAISE EXCEPTION 'No se pudo generar order_code unico';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET
    status = 'SENT_TO_KITCHEN',
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = NULL,
    dispatched_at = NULL,
    updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_dine_in_table_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next_order_id uuid;
  v_has_permission boolean := false;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden es obligatoria';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Solo puedes eliminar ordenes activas de mesa';
  END IF;

  IF v_order.status <> 'DRAFT'
    OR v_order.sent_to_kitchen_at IS NOT NULL
    OR v_order.ready_at IS NOT NULL
    OR v_order.dispatched_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Solo puedes eliminar una orden borrador que aun no haya sido enviada';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, false),
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
   AND csu.user_id = auth.uid()
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    v_shift_id IS NULL
    OR COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar esta orden';
  END IF;

  PERFORM public.inventario_devolver_borradores_orden(p_order_id, auth.uid(), 'ELIMINAR_ORDEN');

  DELETE FROM public.order_item_modifiers oim
  USING public.order_items oi
  WHERE oi.id = oim.order_item_id
    AND oi.order_id = p_order_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_order.table_id);

  SELECT o.id
  INTO v_next_order_id
  FROM public.orders o
  WHERE o.table_id = v_order.table_id
    AND o.order_type = 'DINE_IN'
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  ORDER BY
    COALESCE(o.table_order_position, 2147483647),
    COALESCE(o.order_number, 2147483647),
    o.id
  LIMIT 1;

  RETURN v_next_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_and_close_stale_shift(p_shift_id uuid, p_branch_id uuid, p_notes text DEFAULT 'Cierre automático de turno expirado (Limpieza de sistema)'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
  v_draft_order record;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cash_shifts
    WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido para cerrar';
  END IF;

  FOR v_draft_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.status = 'DRAFT'
  LOOP
    PERFORM public.inventario_devolver_borradores_orden(
      v_draft_order.id,
      COALESCE(v_actor_id, (SELECT cs.cashier_id FROM public.cash_shifts cs WHERE cs.id = p_shift_id)),
      'CIERRE_TURNO'
    );
  END LOOP;

  DELETE FROM public.order_items
  WHERE order_id IN (
    SELECT id FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders
  WHERE branch_id = p_branch_id
    AND status = 'DRAFT';

  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  PERFORM public.close_all_open_shift_cash_register_openings(
    p_shift_id,
    'Auto-cierre: turno expirado'
  );

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = p_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.force_close_cash_shift(p_shift_id uuid, p_branch_id uuid, p_notes text DEFAULT 'Cierre forzado desde Administracion'::text)
 RETURNS TABLE(drafts_deleted integer, paid_closed integer, ops_closed integer, openings_closed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
  v_drafts_deleted integer := 0;
  v_paid_closed integer := 0;
  v_ops_closed integer := 0;
  v_openings_closed integer := 0;
  v_notes text := COALESCE(NULLIF(trim(p_notes), ''), 'Cierre forzado desde Administracion');
  v_draft_order record;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permiso para forzar el cierre de turno.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts
    WHERE id = p_shift_id
      AND branch_id = p_branch_id
      AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido para cerrar';
  END IF;

  FOR v_draft_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.status = 'DRAFT'
  LOOP
    PERFORM public.inventario_devolver_borradores_orden(
      v_draft_order.id,
      COALESCE(v_actor_id, (SELECT cs.cashier_id FROM public.cash_shifts cs WHERE cs.id = p_shift_id)),
      'CIERRE_TURNO'
    );
  END LOOP;

  DELETE FROM public.order_items
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.payment_items
  WHERE payment_id IN (
    SELECT p.id
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE o.branch_id = p_branch_id
      AND o.status = 'DRAFT'
  );

  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders
  WHERE branch_id = p_branch_id
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_drafts_deleted = ROW_COUNT;

  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  GET DIAGNOSTICS v_paid_closed = ROW_COUNT;

  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  GET DIAGNOSTICS v_ops_closed = ROW_COUNT;

  v_openings_closed := public.close_all_open_shift_cash_register_openings(
    p_shift_id,
    'Auto-cierre: cierre forzado de turno'
  );

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = v_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;

  drafts_deleted := v_drafts_deleted;
  paid_closed := v_paid_closed;
  ops_closed := v_ops_closed;
  openings_closed := v_openings_closed;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_dine_in_order_items_between_orders(p_source_order_id uuid, p_destination_order_id uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(source_order_id uuid, destination_order_id uuid, moved_items integer, moved_units integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_order public.orders%ROWTYPE;
  v_destination_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_permission boolean := false;
  v_lock_key_a text;
  v_lock_key_b text;
  v_source_item_id uuid;
  v_requested_qty integer;
  v_source_item public.order_items%ROWTYPE;
  v_snapshot record;
  v_move_pending integer;
  v_move_ready_available integer;
  v_move_dispatched integer;
  v_move_dispatched_from_pending integer;
  v_move_dispatched_from_ready integer;
  v_move_ready_history integer;
  v_destination_item_id uuid;
  v_ready_event_id uuid;
  v_dispatch_event_id uuid;
  v_remaining integer;
  v_take integer;
  v_ready_line record;
  v_dispatch_line record;
  v_modifier record;
  v_moved_items integer := 0;
  v_moved_units integer := 0;
  v_source_remaining_rows integer := 0;
  v_paid_qty_effective integer := 0;
  v_movable_dispatched integer := 0;
  v_max_movable integer := 0;
  v_destination_order_after public.orders%ROWTYPE;
  v_destination_new_order_number integer;
  v_destination_new_order_code text;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_try int := 0;
BEGIN
  IF p_source_order_id IS NULL OR p_destination_order_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la orden origen y la orden destino';
  END IF;

  IF p_source_order_id = p_destination_order_id THEN
    RAISE EXCEPTION 'La orden destino debe ser distinta de la orden origen';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos un item para mover';
  END IF;

  SELECT o.*
  INTO v_source_order
  FROM public.orders o
  WHERE o.id = p_source_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden origen';
  END IF;

  SELECT o.*
  INTO v_destination_order
  FROM public.orders o
  WHERE o.id = p_destination_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden destino';
  END IF;

  IF v_source_order.order_type <> 'DINE_IN' OR v_destination_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden mover items entre ordenes DINE_IN';
  END IF;

  IF COALESCE(v_source_order.is_special, false) OR COALESCE(v_destination_order.is_special, false) THEN
    RAISE EXCEPTION 'Las ordenes especiales no participan en Unir/Dividir';
  END IF;

  IF v_source_order.table_id IS NULL OR v_destination_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Ambas ordenes deben pertenecer a una mesa o division activa';
  END IF;

  IF v_source_order.branch_id <> v_destination_order.branch_id THEN
    RAISE EXCEPTION 'Las ordenes deben pertenecer a la misma sucursal';
  END IF;

  IF v_source_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    OR v_destination_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED') THEN
    RAISE EXCEPTION 'Solo se pueden mover items entre ordenes activas';
  END IF;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_source_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'No tienes permisos para mover items entre mesas';
  END IF;

  v_lock_key_a := LEAST(p_source_order_id::text, p_destination_order_id::text);
  v_lock_key_b := GREATEST(p_source_order_id::text, p_destination_order_id::text);

  PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_items_between_orders:' || v_lock_key_a));
  IF v_lock_key_b <> v_lock_key_a THEN
    PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_items_between_orders:' || v_lock_key_b));
  END IF;

  CREATE TEMP TABLE tmp_move_targets (
    order_item_id uuid PRIMARY KEY,
    quantity integer NOT NULL CHECK (quantity > 0)
  ) ON COMMIT DROP;

  FOR v_source_item_id, v_requested_qty IN
    SELECT
      (item ->> 'order_item_id')::uuid,
      (item ->> 'quantity')::integer
    FROM jsonb_array_elements(p_items) AS item
  LOOP
    IF v_source_item_id IS NULL THEN
      RAISE EXCEPTION 'order_item_id invalido en Unir/Dividir';
    END IF;

    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para item %', v_source_item_id;
    END IF;

    INSERT INTO tmp_move_targets (order_item_id, quantity)
    VALUES (v_source_item_id, v_requested_qty)
    ON CONFLICT (order_item_id)
    DO UPDATE SET quantity = tmp_move_targets.quantity + EXCLUDED.quantity;
  END LOOP;

  FOR v_source_item_id, v_requested_qty IN
    SELECT order_item_id, quantity
    FROM tmp_move_targets
  LOOP
    SELECT
      oi.*
    INTO v_source_item
    FROM public.order_items oi
    WHERE oi.id = v_source_item_id
      AND oi.order_id = p_source_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden origen', v_source_item_id;
    END IF;

    SELECT
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    INTO v_snapshot
    FROM public.get_order_operational_snapshot(p_source_order_id) snapshot
    WHERE snapshot.order_item_id = v_source_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo resolver el estado operativo del item %', v_source_item_id;
    END IF;

    v_paid_qty_effective := LEAST(
      COALESCE(v_snapshot.quantity_paid, 0),
      COALESCE(v_snapshot.quantity_dispatched_available, 0)
    );
    v_movable_dispatched := GREATEST(
      0,
      COALESCE(v_snapshot.quantity_dispatched_available, 0) - v_paid_qty_effective
    );
    v_max_movable := COALESCE(v_snapshot.quantity_pending_prepare, 0)
      + COALESCE(v_snapshot.quantity_ready_available, 0)
      + v_movable_dispatched;

    IF v_requested_qty > v_max_movable THEN
      RAISE EXCEPTION 'El item % solo tiene % unidad(es) disponibles para mover sin afectar pagos existentes', v_source_item_id, v_max_movable;
    END IF;

    v_move_pending := LEAST(v_requested_qty, COALESCE(v_snapshot.quantity_pending_prepare, 0));
    v_remaining := v_requested_qty - v_move_pending;
    v_move_ready_available := LEAST(v_remaining, COALESCE(v_snapshot.quantity_ready_available, 0));
    v_remaining := v_remaining - v_move_ready_available;
    v_move_dispatched := LEAST(v_remaining, v_movable_dispatched);
    v_move_dispatched_from_pending := 0;
    v_move_dispatched_from_ready := 0;

    IF v_move_dispatched > 0 THEN
      v_remaining := v_move_dispatched;

      FOR v_dispatch_line IN
        SELECT
          oide.id,
          oide.quantity_dispatched,
          oide.source_stage
        FROM public.order_item_dispatch_events oide
        JOIN public.order_dispatch_events ode
          ON ode.id = oide.order_dispatch_event_id
        WHERE oide.order_item_id = v_source_item.id
          AND ode.status = 'APPLIED'
        ORDER BY oide.created_at DESC, oide.id DESC
        FOR UPDATE OF oide
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_remaining, COALESCE(v_dispatch_line.quantity_dispatched, 0));
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;

        IF v_dispatch_line.source_stage = 'PENDING' THEN
          v_move_dispatched_from_pending := v_move_dispatched_from_pending + v_take;
        ELSE
          v_move_dispatched_from_ready := v_move_dispatched_from_ready + v_take;
        END IF;

        IF v_take = v_dispatch_line.quantity_dispatched THEN
          DELETE FROM public.order_item_dispatch_events
          WHERE id = v_dispatch_line.id;
        ELSE
          UPDATE public.order_item_dispatch_events
          SET quantity_dispatched = quantity_dispatched - v_take
          WHERE id = v_dispatch_line.id;
        END IF;

        v_remaining := v_remaining - v_take;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'No se pudo redistribuir el historial despachado del item %', v_source_item_id;
      END IF;
    END IF;

    v_move_ready_history := v_move_ready_available + v_move_dispatched_from_ready;

    IF v_move_ready_history > 0 THEN
      v_remaining := v_move_ready_history;

      FOR v_ready_line IN
        SELECT
          oire.id,
          oire.quantity_ready
        FROM public.order_item_ready_events oire
        JOIN public.order_ready_events ore
          ON ore.id = oire.order_ready_event_id
        WHERE oire.order_item_id = v_source_item.id
          AND ore.status = 'APPLIED'
        ORDER BY oire.created_at DESC, oire.id DESC
        FOR UPDATE OF oire
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_remaining, COALESCE(v_ready_line.quantity_ready, 0));
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;

        IF v_take = v_ready_line.quantity_ready THEN
          DELETE FROM public.order_item_ready_events
          WHERE id = v_ready_line.id;
        ELSE
          UPDATE public.order_item_ready_events
          SET quantity_ready = quantity_ready - v_take
          WHERE id = v_ready_line.id;
        END IF;

        v_remaining := v_remaining - v_take;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'No se pudo redistribuir el historial de listo del item %', v_source_item_id;
      END IF;
    END IF;

    INSERT INTO public.order_items (
      id,
      order_id,
      product_id,
      description_snapshot,
      item_note,
      quantity,
      unit_price,
      total,
      status,
      sent_to_kitchen_at,
      ready_at,
      dispatched_at,
      tray_item_type,
      tray_container_cost,
      paid_at,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      p_destination_order_id,
      v_source_item.product_id,
      v_source_item.description_snapshot,
      v_source_item.item_note,
      v_requested_qty,
      v_source_item.unit_price,
      CASE
        WHEN v_requested_qty > 0 THEN (v_requested_qty * COALESCE(v_source_item.unit_price, 0)) + COALESCE(v_source_item.tray_container_cost, 0)
        ELSE 0
      END,
      CASE
        WHEN v_move_dispatched > 0 THEN 'DISPATCHED'
        WHEN v_move_ready_history > 0 THEN 'SENT'
        ELSE COALESCE(v_source_item.status, 'SENT')
      END,
      COALESCE(v_source_item.sent_to_kitchen_at, v_source_order.sent_to_kitchen_at, v_now),
      CASE WHEN v_move_ready_history > 0 THEN COALESCE(v_source_item.ready_at, v_now) ELSE NULL END,
      CASE WHEN v_move_dispatched > 0 THEN COALESCE(v_source_item.dispatched_at, v_now) ELSE NULL END,
      v_source_item.tray_item_type,
      COALESCE(v_source_item.tray_container_cost, 0),
      NULL,
      v_now
    )
    RETURNING id
    INTO v_destination_item_id;

    PERFORM public.inventario_trasladar_descuento_item(
      v_source_item.id,
      v_destination_item_id,
      v_requested_qty,
      auth.uid()
    );

    FOR v_modifier IN
      SELECT oim.modifier_id
      FROM public.order_item_modifiers oim
      WHERE oim.order_item_id = v_source_item.id
    LOOP
      INSERT INTO public.order_item_modifiers (
        id,
        modifier_id,
        order_item_id
      )
      VALUES (
        gen_random_uuid(),
        v_modifier.modifier_id,
        v_destination_item_id
      );
    END LOOP;

    IF v_move_ready_history > 0 THEN
      IF v_ready_event_id IS NULL THEN
        INSERT INTO public.order_ready_events (
          order_id,
          event_type,
          created_by,
          source_module,
          notes,
          created_at
        )
        VALUES (
          p_destination_order_id,
          'partial',
          auth.uid(),
          'orders',
          format('moved_from:%s', p_source_order_id),
          v_now
        )
        RETURNING id
        INTO v_ready_event_id;
      END IF;

      INSERT INTO public.order_item_ready_events (
        order_ready_event_id,
        order_id,
        order_item_id,
        quantity_ready,
        created_at
      )
      VALUES (
        v_ready_event_id,
        p_destination_order_id,
        v_destination_item_id,
        v_move_ready_history,
        v_now
      );
    END IF;

    IF v_move_dispatched > 0 THEN
      IF v_dispatch_event_id IS NULL THEN
        INSERT INTO public.order_dispatch_events (
          order_id,
          event_type,
          created_by,
          source_module,
          notes,
          created_at
        )
        VALUES (
          p_destination_order_id,
          'partial',
          auth.uid(),
          'orders',
          format('moved_from:%s', p_source_order_id),
          v_now
        )
        RETURNING id
        INTO v_dispatch_event_id;
      END IF;

      IF v_move_dispatched_from_pending > 0 THEN
        INSERT INTO public.order_item_dispatch_events (
          order_dispatch_event_id,
          order_id,
          order_item_id,
          quantity_dispatched,
          source_stage,
          created_at
        )
        VALUES (
          v_dispatch_event_id,
          p_destination_order_id,
          v_destination_item_id,
          v_move_dispatched_from_pending,
          'PENDING',
          v_now
        );
      END IF;

      IF v_move_dispatched_from_ready > 0 THEN
        INSERT INTO public.order_item_dispatch_events (
          order_dispatch_event_id,
          order_id,
          order_item_id,
          quantity_dispatched,
          source_stage,
          created_at
        )
        VALUES (
          v_dispatch_event_id,
          p_destination_order_id,
          v_destination_item_id,
          v_move_dispatched_from_ready,
          'READY',
          v_now
        );
      END IF;
    END IF;

    UPDATE public.order_items
    SET
      quantity = quantity - v_requested_qty,
      total = CASE
        WHEN (quantity - v_requested_qty) > 0
          THEN ((quantity - v_requested_qty) * COALESCE(unit_price, 0)) + COALESCE(tray_container_cost, 0)
        ELSE 0
      END
    WHERE id = v_source_item.id;

    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = v_source_item.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.id = v_source_item.id
          AND COALESCE(oi.quantity, 0) > 0
      );

    DELETE FROM public.order_items
    WHERE id = v_source_item.id
      AND COALESCE(quantity, 0) <= 0;

    v_moved_items := v_moved_items + 1;
    v_moved_units := v_moved_units + v_requested_qty;
  END LOOP;

  PERFORM public.sync_order_payment_state_internal(p_destination_order_id);

  SELECT o.*
  INTO v_destination_order_after
  FROM public.orders o
  WHERE o.id = p_destination_order_id
  FOR UPDATE;

  IF v_destination_order_after.order_number IS NULL
    AND v_destination_order_after.status <> 'DRAFT' THEN
    v_destination_new_order_number := nextval('orders_order_number_seq');

    SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
      INTO v_branch_token
    FROM public.branches
    WHERE id = v_destination_order_after.branch_id;

    v_date_part := to_char(COALESCE(v_destination_order_after.created_at, v_now) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');
    v_destination_new_order_code := NULL;
    v_try := 0;

    LOOP
      v_try := v_try + 1;
      v_seq := public.next_human_sequence('orders_daily', v_destination_order_after.branch_id, v_date_part);
      v_destination_new_order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.order_code = v_destination_new_order_code
          AND o.id <> p_destination_order_id
      );

      IF v_try >= 50 THEN
        RAISE EXCEPTION 'No se pudo generar order_code unico para la orden destino';
      END IF;
    END LOOP;

    UPDATE public.orders o
    SET
      order_number = v_destination_new_order_number,
      order_code = v_destination_new_order_code,
      updated_at = v_now
    WHERE o.id = p_destination_order_id;
  END IF;

  SELECT COUNT(*)
  INTO v_source_remaining_rows
  FROM public.order_items oi
  WHERE oi.order_id = p_source_order_id;

  IF v_source_remaining_rows = 0 THEN
    UPDATE public.orders o
    SET
      status = 'DRAFT',
      sent_to_kitchen_at = NULL,
      ready_at = NULL,
      dispatched_at = NULL,
      paid_at = NULL,
      cancelled_at = NULL,
      cancel_requested_at = NULL,
      cancel_requested_by = NULL,
      updated_at = v_now
    WHERE o.id = p_source_order_id;
  ELSE
    PERFORM public.sync_order_payment_state_internal(p_source_order_id);
  END IF;

  RETURN QUERY
  SELECT
    p_source_order_id,
    p_destination_order_id,
    v_moved_items,
    v_moved_units;
END;
$function$;

NOTIFY pgrst, 'reload schema';
