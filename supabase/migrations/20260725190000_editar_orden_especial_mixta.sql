-- Editar orden especial mixta:
--   * La RPC convertir_orden_especial_parcial ahora tambien sirve para REASIGNAR
--     unidades de una orden ya especial (mover items entre especial y normal).
--   * Si la nueva asignacion queda con 0 unidades especiales, la orden deja de
--     ser especial y vuelve a ser una orden normal de mesa (precios reales).

CREATE OR REPLACE FUNCTION public.convertir_orden_especial_parcial(
  p_order_id uuid,
  p_items jsonb,
  p_group_total numeric,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  is_special boolean,
  special_group_total numeric,
  special_total_manual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
  v_special_units integer := 0;
  v_rest_total numeric := 0;
  v_group_total numeric := COALESCE(p_group_total, 0);
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF v_group_total < 0 THEN
    RAISE EXCEPTION 'El valor especial no puede ser negativo';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden convertir a especial las ordenes de mesa';
  END IF;

  IF v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'La orden ya no esta asociada a una mesa activa';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede convertir una orden pagada o cancelada';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para convertir esta orden';
  END IF;

  -- Reinicia la asignacion previa y aplica la nueva (puede ser vacia).
  UPDATE public.order_items AS oi
  SET cantidad_especial = 0
  WHERE oi.order_id = p_order_id
    AND oi.cantidad_especial <> 0;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id := NULLIF(v_item->>'order_item_id', '')::uuid;
      v_qty := COALESCE((v_item->>'cantidad')::integer, 0);

      IF v_item_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.order_items AS oi
      SET cantidad_especial = LEAST(GREATEST(v_qty, 0), oi.quantity)
      WHERE oi.id = v_item_id
        AND oi.order_id = p_order_id;
    END LOOP;
  END IF;

  SELECT
    COALESCE(SUM(oi.cantidad_especial), 0),
    COALESCE(SUM(GREATEST(oi.quantity - oi.cantidad_especial, 0) * oi.unit_price), 0)
  INTO v_special_units, v_rest_total
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id
    AND oi.status <> 'CANCELLED';

  IF v_special_units <= 0 THEN
    -- Sin unidades especiales: la orden vuelve a ser normal.
    IF NOT v_order.is_special THEN
      RAISE EXCEPTION 'Debes indicar al menos una unidad para el grupo especial';
    END IF;

    UPDATE public.orders AS o
    SET
      is_special = false,
      special_group_total = NULL,
      special_total_manual = NULL,
      special_reason = NULL,
      special_marked_at = NULL,
      special_marked_by = NULL,
      special_origin_table_id = NULL,
      special_origin_split_id = NULL,
      updated_at = now()
    WHERE o.id = p_order_id;
  ELSE
    UPDATE public.orders AS o
    SET
      is_special = true,
      special_group_total = v_group_total,
      special_total_manual = ROUND(v_group_total + v_rest_total, 2),
      special_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      special_marked_at = COALESCE(o.special_marked_at, now()),
      special_marked_by = COALESCE(o.special_marked_by, v_actor_id),
      special_origin_table_id = COALESCE(o.special_origin_table_id, o.table_id),
      special_origin_split_id = COALESCE(o.special_origin_split_id, o.split_id),
      updated_at = now()
    WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT o.id, o.is_special, o.special_group_total, o.special_total_manual
  FROM public.orders AS o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convertir_orden_especial_parcial(uuid, jsonb, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convertir_orden_especial_parcial(uuid, jsonb, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convertir_orden_especial_parcial(uuid, jsonb, numeric, text) TO service_role;

NOTIFY pgrst, 'reload schema';
