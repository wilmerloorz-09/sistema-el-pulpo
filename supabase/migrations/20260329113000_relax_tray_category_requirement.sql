CREATE OR REPLACE FUNCTION public.add_tray_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_tray_item_type char,
  p_tray_container_cost numeric DEFAULT 0,
  p_item_note text DEFAULT NULL
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

  RETURN v_item_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
