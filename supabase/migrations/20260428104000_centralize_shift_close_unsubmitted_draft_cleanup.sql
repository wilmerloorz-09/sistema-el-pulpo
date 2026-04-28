CREATE OR REPLACE FUNCTION public.cancel_empty_draft_orders_for_branch(
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_updated integer := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.shift_close_cancelable_orders (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.shift_close_cancelable_orders;

  INSERT INTO pg_temp.shift_close_cancelable_orders (id)
  SELECT o.id
  FROM public.orders o
  WHERE o.branch_id = p_branch_id
    AND o.status = 'DRAFT'
    AND NOT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.status <> 'DRAFT'
    )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.orders o
  SET status = 'CANCELLED',
      cancelled_at = COALESCE(o.cancelled_at, v_now),
      updated_at = v_now
  WHERE o.id IN (
    SELECT id
    FROM pg_temp.shift_close_cancelable_orders
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.order_items oi
  SET status = 'CANCELLED',
      cancelled_at = COALESCE(oi.cancelled_at, v_now),
      cancelled_from_status = COALESCE(oi.cancelled_from_status, oi.status)
  WHERE oi.order_id IN (
    SELECT id
    FROM pg_temp.shift_close_cancelable_orders
  )
    AND oi.status = 'DRAFT';

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_branch_closure_blocking_orders(
  p_branch_id uuid
)
RETURNS TABLE (
  order_id uuid,
  reference_label text,
  order_status public.order_status,
  paid_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id AS order_id,
    CASE
      WHEN COALESCE(o.is_special, false) THEN
        'Orden especial'
      WHEN COALESCE(o.is_tray_order, false) THEN
        'Bandeja'
      WHEN o.order_type = 'TAKEOUT' THEN
        'Para llevar'
      WHEN o.order_type = 'DINE_IN' AND ts.split_code IS NOT NULL THEN
        COALESCE(rt.name, 'Mesa') || ' ' || ts.split_code
      WHEN o.order_type = 'DINE_IN' THEN
        COALESCE(rt.name, o.table_name_snapshot, 'Mesa')
      ELSE
        'Orden'
    END AS reference_label,
    o.status AS order_status,
    o.paid_at,
    o.created_at,
    o.updated_at
  FROM public.orders o
  LEFT JOIN public.restaurant_tables rt
    ON rt.id = o.table_id
  LEFT JOIN public.table_splits ts
    ON ts.id = o.split_id
  WHERE o.branch_id = p_branch_id
    AND (
      (
        o.status = 'DRAFT'
        AND (
          EXISTS (
            SELECT 1
            FROM public.payments p
            WHERE p.order_id = o.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.order_items oi
            WHERE oi.order_id = o.id
              AND oi.status <> 'DRAFT'
          )
        )
      )
      OR o.status IN ('SENT_TO_KITCHEN', 'READY')
      OR (o.status = 'KITCHEN_DISPATCHED' AND o.paid_at IS NULL)
    )
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_empty_draft_orders_for_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_branch_closure_blocking_orders(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
