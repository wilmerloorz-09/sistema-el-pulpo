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

  IF NOT FOUND OR v_remaining_order.split_id IS NULL THEN
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

GRANT EXECUTE ON FUNCTION public.normalize_single_remaining_split_for_table(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
