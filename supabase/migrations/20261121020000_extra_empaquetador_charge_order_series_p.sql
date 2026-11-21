-- Extra Empaquetador: serie P (EXTRA deja de compartir L con Para llevar).
-- Cobrar crea orden EXTRA con ítems ya despachados, lista para cobrar.

CREATE OR REPLACE FUNCTION public.order_number_series_for_type(p_order_type public.order_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_order_type
    WHEN 'EXPRESS'::public.order_type THEN 'E'
    WHEN 'TAKEOUT'::public.order_type THEN 'L'
    WHEN 'EXTRA'::public.order_type THEN 'P'
    ELSE 'M'
  END;
$$;

CREATE OR REPLACE FUNCTION public.order_number_from_order_code(p_order_code text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_suffix text;
BEGIN
  IF p_order_code IS NULL OR btrim(p_order_code) = '' THEN
    RETURN NULL;
  END IF;

  v_suffix := split_part(btrim(p_order_code), '-', 2);
  IF v_suffix ~ '^[MLEP][0-9]+$' THEN
    RETURN substring(v_suffix from 2)::integer;
  END IF;
  IF v_suffix ~ '^[0-9]+$' THEN
    RETURN v_suffix::integer;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_extra_empaquetador_charge_order(
  p_branch_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $epulpo$
DECLARE
  v_actor uuid := auth.uid();
  v_shift_id uuid;
  v_order_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_product public.products%ROWTYPE;
  v_menu public.menu_nodes%ROWTYPE;
  v_precio numeric(12, 2);
  v_desc text;
  v_item_id uuid;
  v_event_id uuid;
  v_order public.orders%ROWTYPE;
  v_items_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto antes de cobrar.';
  END IF;

  IF NOT (
    public.is_global_admin(v_actor)
    OR public.can_manage_branch_admin(v_actor, p_branch_id)
    OR public.has_branch_permission(v_actor, p_branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor, p_branch_id, 'ordenes', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor, p_branch_id, 'orders', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'Sin permiso para crear órdenes Extra Empaquetador.';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  INSERT INTO public.orders (
    branch_id,
    order_type,
    menu_scope,
    status,
    is_tray_order,
    is_special,
    created_by,
    cash_shift_id
  )
  VALUES (
    p_branch_id,
    'EXTRA',
    'TABLE',
    'DRAFT',
    false,
    false,
    v_actor,
    v_shift_id
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := GREATEST(1, LEAST(99, COALESCE((v_item->>'quantity')::integer, 1)));
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Cada ítem requiere product_id.';
    END IF;

    SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
    IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Producto no disponible: %', v_product_id;
    END IF;

    SELECT * INTO v_menu
    FROM public.menu_nodes mn
    WHERE mn.branch_id = p_branch_id
      AND mn.is_active IS TRUE
      AND (
        mn.legacy_product_id = v_product.id
        OR mn.producto_global_id = v_product.id
        OR mn.id = v_product.id
      )
    ORDER BY mn.display_order NULLS LAST, mn.created_at
    LIMIT 1;

    v_precio := COALESCE(v_menu.price, v_product.unit_price, 0);
    v_desc := COALESCE(
      NULLIF(trim(v_menu.name), ''),
      NULLIF(trim(v_product.description), ''),
      'Producto'
    );

    SELECT public.add_dine_in_order_item(
      v_order_id,
      v_product.id,
      v_menu.id,
      v_qty,
      v_precio,
      v_desc,
      NULL,
      NULL,
      NULL,
      0
    ) INTO v_item_id;

    v_items_count := v_items_count + 1;
  END LOOP;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto antes de cobrar.';
  END IF;

  -- Asigna order_code serie P y deja ítems operativos.
  PERFORM 1 FROM public.submit_order_draft_items(v_order_id);

  -- Auto-despacho (mismo patrón que el lector): despachado sin exigir pago previo.
  FOR v_item_id IN
    SELECT oi.id
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id
      AND oi.status NOT IN ('DRAFT', 'CANCELLED')
      AND COALESCE(oi.quantity, 0) > 0
  LOOP
    SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
    WHERE oi.id = v_item_id;

    INSERT INTO public.order_dispatch_events (
      order_id, event_type, created_by, source_module, notes, status, created_at
    ) VALUES (
      v_order_id, 'partial', v_actor, 'orders', 'extra-empaquetador auto-despacho', 'APPLIED', v_now
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.order_item_dispatch_events (
      order_dispatch_event_id, order_id, order_item_id, quantity_dispatched, source_stage, created_at
    ) VALUES (
      v_event_id, v_order_id, v_item_id, v_qty, 'PENDING', v_now
    );

    UPDATE public.order_items
    SET dispatched_at = COALESCE(dispatched_at, v_now)
    WHERE id = v_item_id;
  END LOOP;

  PERFORM public.recompute_order_operational_state(v_order_id);
  PERFORM 1 FROM public.sync_order_payment_state_internal(v_order_id);

  UPDATE public.orders
  SET
    status = 'KITCHEN_DISPATCHED',
    sent_to_kitchen_at = COALESCE(sent_to_kitchen_at, v_now),
    ready_at = COALESCE(ready_at, v_now),
    dispatched_at = COALESCE(dispatched_at, v_now),
    updated_at = v_now
  WHERE id = v_order_id
    AND status IS DISTINCT FROM 'PAID'
    AND status IS DISTINCT FROM 'CANCELLED';

  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'items_count', v_items_count
  );
END;
$epulpo$;

REVOKE ALL ON FUNCTION public.create_extra_empaquetador_charge_order(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_extra_empaquetador_charge_order(uuid, jsonb) TO authenticated;
