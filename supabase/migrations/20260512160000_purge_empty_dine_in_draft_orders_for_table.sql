-- Borradores de mesa vacios de una sola mesa (al listar cuentas o antes de abrir la mesa).

CREATE OR REPLACE FUNCTION public.purge_empty_dine_in_draft_orders_for_table(
  p_table_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF p_table_id IS NULL OR auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = p_table_id
      AND o.order_type = 'DINE_IN'
      AND o.table_id IS NOT NULL
      AND COALESCE(o.is_special, false) = false
      AND COALESCE(o.is_tray_order, false) = false
      AND o.status = 'DRAFT'
      AND o.sent_to_kitchen_at IS NULL
      AND o.ready_at IS NULL
      AND o.dispatched_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
        LIMIT 1
      )
    ORDER BY o.id
  LOOP
    IF public.purge_empty_dine_in_draft_order(r.id) IS NOT NULL THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_empty_dine_in_draft_orders_for_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_empty_dine_in_draft_orders_for_table(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
