CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_pending_orders_count integer := 0;
  v_pending_orders_preview text := '';
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'No puedes cerrar el turno porque la caja esta abierta. Cierra la caja en el modulo Caja y vuelve a intentarlo.';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_orders_count
  FROM public.orders o
  WHERE o.branch_id = p_branch_id
    AND o.status NOT IN ('PAID', 'CANCELLED');

  IF v_pending_orders_count > 0 THEN
    SELECT COALESCE(string_agg(reference_label, ', '), '')
    INTO v_pending_orders_preview
    FROM (
      SELECT
        CASE
          WHEN o.order_type = 'DINE_IN' AND ts.split_code IS NOT NULL THEN
            COALESCE(rt.name, 'Mesa') || ' ' || ts.split_code
          WHEN o.order_type = 'DINE_IN' THEN
            COALESCE(rt.name, 'Mesa')
          ELSE
            'Para llevar'
        END AS reference_label
      FROM public.orders o
      LEFT JOIN public.restaurant_tables rt
        ON rt.id = o.table_id
      LEFT JOIN public.table_splits ts
        ON ts.id = o.split_id
      WHERE o.branch_id = p_branch_id
        AND o.status NOT IN ('PAID', 'CANCELLED')
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
      LIMIT 5
    ) AS pending_refs;

    RAISE EXCEPTION
      'No puedes cerrar el turno porque aun existen ordenes o cobros pendientes. Finaliza o cobra esas ordenes primero.%s',
      CASE
        WHEN v_pending_orders_preview <> '' THEN ' Referencias: ' || v_pending_orders_preview
        ELSE ''
      END;
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text) TO authenticated;
