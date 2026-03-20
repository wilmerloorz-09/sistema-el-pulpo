CREATE OR REPLACE FUNCTION public.normalize_single_remaining_split_for_table(
  p_table_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining_order record;
  v_active_orders_count integer := 0;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_orders_count
  FROM public.orders o
  WHERE o.table_id = p_table_id
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND (
      o.status <> 'DRAFT'
      OR EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
    );

  IF v_active_orders_count <> 1 THEN
    RETURN;
  END IF;

  SELECT o.id, o.split_id
  INTO v_remaining_order
  FROM public.orders o
  WHERE o.table_id = p_table_id
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND (
      o.status <> 'DRAFT'
      OR EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
    )
  ORDER BY o.created_at, o.order_number, o.id
  LIMIT 1
  FOR UPDATE;

  IF v_remaining_order.split_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.orders
  SET split_id = NULL,
      updated_at = now()
  WHERE id = v_remaining_order.id;

  UPDATE public.table_splits
  SET is_active = false
  WHERE id = v_remaining_order.split_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_dine_in_order_to_table(
  p_order_id uuid,
  p_destination_table_id uuid
)
RETURNS TABLE (
  order_id uuid,
  table_id uuid,
  split_id uuid,
  split_code text,
  destination_was_occupied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_destination_table public.restaurant_tables%ROWTYPE;
  v_source_split_id uuid;
  v_source_table_id uuid;
  v_destination_occupied boolean := false;
  v_has_permission boolean := false;
  v_lock_key_a text;
  v_lock_key_b text;
  v_used_split_codes text[] := ARRAY[]::text[];
  v_candidate_index integer := 1;
  v_candidate_code text;
  v_created_split_id uuid;
  v_destination_order record;
  v_placeholder_order record;
BEGIN
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

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'No tienes permisos para cambiar esta orden de mesa';
  END IF;

  v_lock_key_a := LEAST(v_order.table_id::text, p_destination_table_id::text);
  v_lock_key_b := GREATEST(v_order.table_id::text, p_destination_table_id::text);

  PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_a));
  IF v_lock_key_b <> v_lock_key_a THEN
    PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_b));
  END IF;

  v_source_table_id := v_order.table_id;
  v_source_split_id := v_order.split_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND (
        o.status <> 'DRAFT'
        OR EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        )
      )
  )
  INTO v_destination_occupied;

  FOR v_placeholder_order IN
    SELECT o.id, o.split_id
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  LOOP
    DELETE FROM public.orders
    WHERE id = v_placeholder_order.id;

    IF v_placeholder_order.split_id IS NOT NULL THEN
      UPDATE public.table_splits ts
      SET is_active = false
      WHERE ts.id = v_placeholder_order.split_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.split_id = ts.id
        );
    END IF;
  END LOOP;

  IF NOT v_destination_occupied THEN
    IF v_source_split_id IS NOT NULL THEN
      UPDATE public.table_splits
      SET is_active = false
      WHERE id = v_source_split_id;
    END IF;

    UPDATE public.orders
    SET table_id = p_destination_table_id,
        split_id = NULL,
        updated_at = now()
    WHERE id = p_order_id;

    PERFORM public.normalize_single_remaining_split_for_table(v_source_table_id);

    RETURN QUERY
    SELECT
      v_order.id,
      p_destination_table_id,
      NULL::uuid,
      NULL::text,
      false;
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ts.split_code), ARRAY[]::text[])
  INTO v_used_split_codes
  FROM public.orders o
  JOIN public.table_splits ts
    ON ts.id = o.split_id
  WHERE o.table_id = p_destination_table_id
    AND o.id <> p_order_id
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND (
      o.status <> 'DRAFT'
      OR EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
    );

  FOR v_destination_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.split_id IS NULL
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND (
        o.status <> 'DRAFT'
        OR EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        )
      )
    ORDER BY o.created_at, o.order_number, o.id
  LOOP
    LOOP
      v_candidate_code := v_destination_table.name || ' ' || CASE
        WHEN v_candidate_index BETWEEN 1 AND 26 THEN chr(64 + v_candidate_index)
        ELSE v_candidate_index::text
      END;
      EXIT WHEN NOT (v_candidate_code = ANY(v_used_split_codes));
      v_candidate_index := v_candidate_index + 1;
    END LOOP;

    INSERT INTO public.table_splits (
      id,
      table_id,
      split_code,
      is_active
    )
    VALUES (
      gen_random_uuid(),
      p_destination_table_id,
      v_candidate_code,
      true
    )
    RETURNING table_splits.id
    INTO v_created_split_id;

    UPDATE public.orders
    SET split_id = v_created_split_id,
        updated_at = now()
    WHERE id = v_destination_order.id;

    v_used_split_codes := array_append(v_used_split_codes, v_candidate_code);
    v_candidate_index := v_candidate_index + 1;
  END LOOP;

  LOOP
    v_candidate_code := v_destination_table.name || ' ' || CASE
      WHEN v_candidate_index BETWEEN 1 AND 26 THEN chr(64 + v_candidate_index)
      ELSE v_candidate_index::text
    END;
    EXIT WHEN NOT (v_candidate_code = ANY(v_used_split_codes));
    v_candidate_index := v_candidate_index + 1;
  END LOOP;

  INSERT INTO public.table_splits (
    id,
    table_id,
    split_code,
    is_active
  )
  VALUES (
    gen_random_uuid(),
    p_destination_table_id,
    v_candidate_code,
    true
  )
  RETURNING table_splits.id
  INTO v_created_split_id;

  UPDATE public.orders
  SET table_id = p_destination_table_id,
      split_id = v_created_split_id,
      updated_at = now()
  WHERE id = p_order_id;

  IF v_source_split_id IS NOT NULL THEN
    UPDATE public.table_splits ts
    SET is_active = false
    WHERE ts.id = v_source_split_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.split_id = ts.id
      );
  END IF;

  PERFORM public.normalize_single_remaining_split_for_table(v_source_table_id);

  RETURN QUERY
  SELECT
    v_order.id,
    p_destination_table_id,
    v_created_split_id,
    v_candidate_code,
    true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_single_remaining_split_for_table(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_dine_in_order_to_table(uuid, uuid) TO authenticated;
