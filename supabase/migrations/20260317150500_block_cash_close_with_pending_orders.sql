CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
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
  v_opening_id uuid;
  v_pending_orders_count integer := 0;
  v_pending_orders_preview text := '';
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_cashier_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT cs.caja_status
  INTO v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  IF v_caja_status != 'OPEN' THEN
    RAISE EXCEPTION 'La caja no esta abierta para cerrarse';
  END IF;

  SELECT COUNT(*)::integer
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
      'No puedes cerrar la caja porque aun existen ordenes pendientes en la sucursal. Finaliza, anula o cobra esas ordenes primero.%s',
      CASE
        WHEN v_pending_orders_preview <> '' THEN ' Referencias: ' || v_pending_orders_preview
        ELSE ''
      END;
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro una apertura de caja activa';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED',
      notes = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), notes)
  WHERE id = p_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;
