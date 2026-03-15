CREATE OR REPLACE FUNCTION public.configure_shift_active_tables(
  p_branch_id uuid,
  p_shift_id uuid,
  p_active_tables_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer := GREATEST(COALESCE(p_active_tables_count, 0), 0);
  v_conflicting_tables integer := 0;
  v_conflicting_labels text := '';
BEGIN
  IF p_branch_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'branch_id y shift_id son obligatorios';
  END IF;

  SELECT COUNT(*),
         COALESCE(string_agg(rt.name, ', ' ORDER BY rt.visual_order), '')
  INTO v_conflicting_tables, v_conflicting_labels
  FROM public.restaurant_tables rt
  WHERE rt.branch_id = p_branch_id
    AND rt.visual_order > v_requested
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.branch_id = p_branch_id
        AND o.table_id = rt.id
        AND (
          o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
          OR (
            o.status = 'DRAFT'
            AND EXISTS (
              SELECT 1
              FROM public.order_items oi
              WHERE oi.order_id = o.id
            )
          )
        )
    );

  IF v_conflicting_tables > 0 THEN
    RAISE EXCEPTION 'No puedes reducir a % mesas mientras estas mesas sigan ocupadas: %', v_requested, v_conflicting_labels;
  END IF;

  PERFORM public.ensure_branch_table_capacity(p_branch_id, v_requested);

  UPDATE public.cash_shifts
  SET active_tables_count = v_requested
  WHERE id = p_shift_id
    AND branch_id = p_branch_id;

  UPDATE public.restaurant_tables
  SET is_active = (visual_order <= v_requested)
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.configure_shift_active_tables(uuid, uuid, integer) TO authenticated;
