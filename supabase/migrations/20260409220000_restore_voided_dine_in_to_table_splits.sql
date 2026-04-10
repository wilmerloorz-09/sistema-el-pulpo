CREATE OR REPLACE FUNCTION public.restore_voided_dine_in_order_to_table(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_other_order record;
  v_used_split_codes text[] := ARRAY[]::text[];
  v_candidate_index integer := 1;
  v_candidate_code text;
  v_created_split_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.order_type <> 'DINE_IN'
    OR v_order.table_id IS NULL
    OR v_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  THEN
    RETURN;
  END IF;

  SELECT rt.*
  INTO v_table
  FROM public.restaurant_tables rt
  WHERE rt.id = v_order.table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('restore_voided_dine_in_order_to_table:' || v_order.table_id::text));

  DELETE FROM public.orders draft_order
  WHERE draft_order.table_id = v_order.table_id
    AND draft_order.id <> v_order.id
    AND draft_order.status = 'DRAFT'
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = draft_order.id
    );

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_order.table_id
      AND o.id <> v_order.id
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND (
        o.status <> 'DRAFT'
        OR EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        )
      )
  ) THEN
    PERFORM public.normalize_single_remaining_split_for_table(v_order.table_id);
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ts.split_code), ARRAY[]::text[])
  INTO v_used_split_codes
  FROM public.orders o
  JOIN public.table_splits ts
    ON ts.id = o.split_id
  WHERE o.table_id = v_order.table_id
    AND o.id <> v_order.id
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND (
      o.status <> 'DRAFT'
      OR EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
    );

  IF v_order.split_id IS NULL THEN
    LOOP
      v_candidate_code := v_table.name || CASE
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
      v_order.table_id,
      v_candidate_code,
      true
    )
    RETURNING id
    INTO v_created_split_id;

    UPDATE public.orders
    SET split_id = v_created_split_id,
        updated_at = now()
    WHERE id = v_order.id;

    v_used_split_codes := array_append(v_used_split_codes, v_candidate_code);
    v_candidate_index := v_candidate_index + 1;
  END IF;

  FOR v_other_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = v_order.table_id
      AND o.id <> v_order.id
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
      v_candidate_code := v_table.name || CASE
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
      v_order.table_id,
      v_candidate_code,
      true
    )
    RETURNING id
    INTO v_created_split_id;

    UPDATE public.orders
    SET split_id = v_created_split_id,
        updated_at = now()
    WHERE id = v_other_order.id;

    v_used_split_codes := array_append(v_used_split_codes, v_candidate_code);
    v_candidate_index := v_candidate_index + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_voided_dine_in_order_to_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_voided_dine_in_order_to_table(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalculate_check_balance(
  p_check_id uuid
)
RETURNS TABLE (
  order_id uuid,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
BEGIN
  SELECT *
  INTO v_result
  FROM public.sync_order_payment_state_internal(p_check_id)
  LIMIT 1;

  PERFORM public.restore_voided_dine_in_order_to_table(p_check_id);

  RETURN QUERY
  SELECT
    COALESCE(v_result.order_id, p_check_id),
    v_result.status,
    v_result.paid_at;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_check_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_check_balance(uuid) TO authenticated;
