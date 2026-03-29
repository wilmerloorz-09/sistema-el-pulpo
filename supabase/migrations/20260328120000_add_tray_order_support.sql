ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_tray_order boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.is_tray_order IS
  'TRUE si la orden opera como Orden Bandeja. Flag ortogonal a is_special y order_type.';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS tray_item_type char(1),
  ADD COLUMN IF NOT EXISTS tray_container_cost numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.order_items.tray_item_type IS
  'NULL para ordenes normales. A=bandeja cliente, B=tarrina local, C=por monto manual.';

COMMENT ON COLUMN public.order_items.tray_container_cost IS
  'Costo adicional por envase/tarrina. Solo aplica cuando tray_item_type = B.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_tray_item_type_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_tray_item_type_check
      CHECK (tray_item_type IS NULL OR tray_item_type IN ('A', 'B', 'C'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_tray_container_cost_non_negative'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_tray_container_cost_non_negative
      CHECK (tray_container_cost >= 0);
  END IF;
END
$$;

ALTER TABLE public.menu_nodes
  ADD COLUMN IF NOT EXISTS is_tray_category boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.menu_nodes.is_tray_category IS
  'Solo valido para categorias raiz (depth=0) del arbol TAKEOUT.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_tray_category_only_root_takeout'
      AND conrelid = 'public.menu_nodes'::regclass
  ) THEN
    ALTER TABLE public.menu_nodes
      ADD CONSTRAINT chk_tray_category_only_root_takeout
      CHECK (
        is_tray_category = false
        OR (
          is_tray_category = true
          AND depth = 0
          AND menu_scope = 'TAKEOUT'
          AND node_type = 'category'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_branch_tray
  ON public.orders(branch_id, is_tray_order)
  WHERE is_tray_order = true;

CREATE INDEX IF NOT EXISTS idx_menu_nodes_tray_category
  ON public.menu_nodes(branch_id, menu_scope, depth, is_tray_category)
  WHERE is_tray_category = true;

CREATE OR REPLACE FUNCTION public.create_tray_order(
  p_branch_id uuid,
  p_created_by uuid
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
  v_can_serve_tables boolean := false;
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

  SELECT csu.can_serve_tables, cs.id
  INTO v_can_serve_tables, v_shift_id
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  IF COALESCE(v_can_serve_tables, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para abrir ordenes bandeja en este turno.';
  END IF;

  INSERT INTO public.orders (
    branch_id,
    order_type,
    menu_scope,
    status,
    is_tray_order,
    created_by
  )
  VALUES (
    p_branch_id,
    'TAKEOUT',
    'TAKEOUT',
    'DRAFT',
    true,
    v_actor_id
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

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
  v_item_id uuid;
  v_description text;
  v_is_tray_branch boolean := false;
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
  ORDER BY cs.opened_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

  IF COALESCE(v_can_serve_tables, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  SELECT p.id, p.description, p.branch_id, p.is_active
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El producto no existe o esta inactivo.';
  END IF;

  IF v_product.branch_id IS DISTINCT FROM v_order.branch_id THEN
    RAISE EXCEPTION 'El producto no pertenece a la sucursal activa de la orden.';
  END IF;

  IF p_tray_item_type = 'B' AND COALESCE(p_tray_container_cost, 0) < 0 THEN
    RAISE EXCEPTION 'El costo de tarrina no puede ser negativo.';
  END IF;

  IF p_tray_item_type <> 'B' AND COALESCE(p_tray_container_cost, 0) <> 0 THEN
    RAISE EXCEPTION 'Solo los items tipo B pueden tener costo de tarrina.';
  END IF;

  IF p_tray_item_type = 'C' THEN
    WITH RECURSIVE product_node AS (
      SELECT
        mn.id,
        mn.parent_id,
        mn.is_tray_category
      FROM public.menu_nodes mn
      WHERE mn.branch_id = v_order.branch_id
        AND mn.menu_scope = 'TAKEOUT'
        AND mn.node_type = 'product'
        AND mn.legacy_product_id = p_product_id
        AND mn.is_active = true
      ORDER BY mn.depth DESC, mn.display_order ASC, mn.created_at ASC
      LIMIT 1
    ),
    ancestors AS (
      SELECT id, parent_id, is_tray_category
      FROM product_node
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.is_tray_category
      FROM public.menu_nodes parent
      INNER JOIN ancestors current
        ON current.parent_id = parent.id
      WHERE parent.branch_id = v_order.branch_id
        AND parent.menu_scope = 'TAKEOUT'
    )
    SELECT EXISTS (
      SELECT 1
      FROM ancestors
      WHERE is_tray_category = true
    )
    INTO v_is_tray_branch;

    IF NOT v_is_tray_branch THEN
      RAISE EXCEPTION 'El producto no pertenece a una categoria bandeja.';
    END IF;
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

CREATE OR REPLACE FUNCTION public.get_tray_menu_nodes(
  p_branch_id uuid
)
RETURNS TABLE (
  id uuid,
  parent_id uuid,
  branch_id uuid,
  menu_scope text,
  name text,
  node_type text,
  depth integer,
  display_order integer,
  image_url text,
  legacy_product_id uuid,
  is_active boolean,
  price numeric,
  is_tray_category boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tray_tree AS (
    SELECT
      mn.id,
      mn.parent_id,
      mn.branch_id,
      mn.menu_scope,
      mn.name,
      mn.node_type,
      mn.depth,
      mn.display_order,
      mn.image_url,
      mn.legacy_product_id,
      mn.is_active,
      mn.price,
      mn.is_tray_category
    FROM public.menu_nodes mn
    WHERE mn.branch_id = p_branch_id
      AND mn.menu_scope = 'TAKEOUT'
      AND mn.depth = 0
      AND mn.is_tray_category = true
      AND mn.is_active = true

    UNION ALL

    SELECT
      child.id,
      child.parent_id,
      child.branch_id,
      child.menu_scope,
      child.name,
      child.node_type,
      child.depth,
      child.display_order,
      child.image_url,
      child.legacy_product_id,
      child.is_active,
      child.price,
      child.is_tray_category
    FROM public.menu_nodes child
    INNER JOIN tray_tree parent
      ON child.parent_id = parent.id
    WHERE child.branch_id = p_branch_id
      AND child.menu_scope = 'TAKEOUT'
      AND child.is_active = true
  )
  SELECT
    id,
    parent_id,
    branch_id,
    menu_scope,
    name,
    node_type,
    depth,
    display_order,
    image_url,
    legacy_product_id,
    is_active,
    price,
    is_tray_category
  FROM tray_tree
  ORDER BY depth ASC, display_order ASC, name ASC;
$$;

REVOKE ALL ON FUNCTION public.create_tray_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tray_order(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_tray_order_item(uuid, uuid, integer, numeric, char, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_tray_order_item(uuid, uuid, integer, numeric, char, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_tray_menu_nodes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tray_menu_nodes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
