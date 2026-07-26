-- Soporte de ordenes especiales MIXTAS:
--   * Parte del pedido con "valor especial" manual (grupo especial)
--   * El resto conserva su precio real de catalogo
--   * La orden permanece en la mesa hasta que se pague; se cobra todo junto
--     (total general = valor grupo especial + resto real).
--
-- Modelo:
--   order_items.cantidad_especial  -> unidades de la linea que van al grupo especial (0..quantity)
--   orders.special_group_total     -> valor manual SOLO del grupo especial (NULL = especial legacy no mixta)
--   orders.special_total_manual    -> se mantiene = total general (grupo especial + resto real)
--                                     para que el motor de cobro existente siga operando sin cambios.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cantidad_especial integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS special_group_total numeric;

-- ---------------------------------------------------------------------------
-- Convertir (parcial o total) en orden especial mixta, manteniendo la mesa.
-- ---------------------------------------------------------------------------
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

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos una unidad para el grupo especial';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
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

  -- Reiniciar marcas previas del grupo especial en esta orden.
  UPDATE public.order_items
  SET cantidad_especial = 0
  WHERE order_id = p_order_id
    AND cantidad_especial <> 0;

  -- Marcar las unidades seleccionadas (clamp a la cantidad de la linea).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'order_item_id', '')::uuid;
    v_qty := COALESCE((v_item->>'cantidad')::integer, 0);

    IF v_item_id IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.order_items
    SET cantidad_especial = LEAST(GREATEST(v_qty, 0), quantity)
    WHERE id = v_item_id
      AND order_id = p_order_id;
  END LOOP;

  -- Totales resultantes.
  SELECT
    COALESCE(SUM(cantidad_especial), 0),
    COALESCE(SUM(GREATEST(quantity - cantidad_especial, 0) * unit_price), 0)
  INTO v_special_units, v_rest_total
  FROM public.order_items
  WHERE order_id = p_order_id
    AND status <> 'CANCELLED';

  IF v_special_units <= 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos una unidad para el grupo especial';
  END IF;

  UPDATE public.orders AS o
  SET
    is_special = true,
    special_group_total = v_group_total,
    special_total_manual = ROUND(v_group_total + v_rest_total, 2),
    special_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    special_marked_at = now(),
    special_marked_by = v_actor_id,
    special_origin_table_id = COALESCE(o.special_origin_table_id, o.table_id),
    special_origin_split_id = COALESCE(o.special_origin_split_id, o.split_id),
    updated_at = now()
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT o.id, o.is_special, o.special_group_total, o.special_total_manual
  FROM public.orders o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convertir_orden_especial_parcial(uuid, jsonb, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convertir_orden_especial_parcial(uuid, jsonb, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Editar luego el valor manual del grupo especial (recalcula total general).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.actualizar_valor_grupo_especial(
  p_order_id uuid,
  p_group_total numeric
)
RETURNS TABLE (
  order_id uuid,
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
  v_rest_total numeric := 0;
  v_group_total numeric := COALESCE(p_group_total, 0);
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF v_group_total < 0 THEN
    RAISE EXCEPTION 'El valor especial no puede ser negativo';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF NOT v_order.is_special THEN
    RAISE EXCEPTION 'La orden no es especial';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede editar una orden pagada o cancelada';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para editar esta orden';
  END IF;

  SELECT COALESCE(SUM(GREATEST(quantity - cantidad_especial, 0) * unit_price), 0)
  INTO v_rest_total
  FROM public.order_items
  WHERE order_id = p_order_id
    AND status <> 'CANCELLED';

  UPDATE public.orders AS o
  SET
    special_group_total = v_group_total,
    special_total_manual = ROUND(v_group_total + v_rest_total, 2),
    updated_at = now()
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT o.id, o.special_group_total, o.special_total_manual
  FROM public.orders o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_valor_grupo_especial(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_valor_grupo_especial(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
