-- Quitar restricción OPERATE al cambiar una orden de mesa.
-- Cualquier usuario autenticado puede mover órdenes DINE_IN activas
-- (siguen las demás validaciones: tipo, estado, misma sucursal, mesa activa).

CREATE OR REPLACE FUNCTION public.move_dine_in_order_to_table(
  p_order_id uuid,
  p_destination_table_id uuid
)
RETURNS TABLE(
  order_id uuid,
  table_id uuid,
  split_id uuid,
  split_code text,
  destination_was_occupied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_destination_table public.restaurant_tables%ROWTYPE;
  v_source_table_id uuid;
  v_destination_occupied boolean := false;
  v_lock_key_a text;
  v_lock_key_b text;
  v_placeholder_order record;
  v_destination_position integer := 1;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_order_id IS NULL OR p_destination_table_id IS NULL THEN
    RAISE EXCEPTION 'order_id y destination_table_id son obligatorios';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden a mover';
  END IF;

  IF v_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden cambiar mesas para ordenes DINE_IN';
  END IF;

  IF v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'La orden no tiene una mesa origen asociada';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede cambiar de mesa una orden pagada o cancelada';
  END IF;

  IF v_order.table_id = p_destination_table_id THEN
    RAISE EXCEPTION 'La mesa destino debe ser distinta de la mesa origen';
  END IF;

  SELECT rt.*
  INTO v_destination_table
  FROM public.restaurant_tables rt
  WHERE rt.id = p_destination_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la mesa destino';
  END IF;

  IF v_destination_table.branch_id <> v_order.branch_id THEN
    RAISE EXCEPTION 'La mesa destino no pertenece a la misma sucursal de la orden';
  END IF;

  IF NOT COALESCE(v_destination_table.is_active, false) THEN
    RAISE EXCEPTION 'La mesa destino no esta habilitada en el turno actual';
  END IF;

  -- Sin chequeo de OPERATE en mesas/ordenes: cualquier usuario autenticado puede mover.

  v_lock_key_a := LEAST(v_order.table_id::text, p_destination_table_id::text);
  v_lock_key_b := GREATEST(v_order.table_id::text, p_destination_table_id::text);

  PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_a));
  IF v_lock_key_b <> v_lock_key_a THEN
    PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_b));
  END IF;

  v_source_table_id := v_order.table_id;

  FOR v_placeholder_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  LOOP
    DELETE FROM public.orders
    WHERE id = v_placeholder_order.id;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.order_type = 'DINE_IN'
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  )
  INTO v_destination_occupied;

  v_destination_position := public.next_table_order_position(p_destination_table_id);

  UPDATE public.orders
  SET table_id = p_destination_table_id,
      table_order_position = v_destination_position,
      split_id = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_source_table_id);
  PERFORM public.compact_table_order_positions(p_destination_table_id);

  RETURN QUERY
  SELECT
    v_order.id,
    p_destination_table_id,
    NULL::uuid,
    NULL::text,
    v_destination_occupied;
END;
$function$;

REVOKE ALL ON FUNCTION public.move_dine_in_order_to_table(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_dine_in_order_to_table(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
