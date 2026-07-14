-- Preparar una orden para re-cobro tras anulación de pago (misma orden o sucesora legacy).
-- SECURITY DEFINER: evita fallos de RLS al asignar cash_shift_id / reabrir estado.

CREATE OR REPLACE FUNCTION public.preparar_orden_para_recobro(
  p_order_id uuid,
  p_successor_hint uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_target_id uuid;
  v_successor_id uuid;
  v_open_shift_id uuid;
  v_match text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  v_match := regexp_match(COALESCE(v_order.notes, ''), 'VOID_SUCCESSOR_ORDER:([a-f0-9-]{36})', 'i');
  v_successor_id := COALESCE(v_match[1]::uuid, p_successor_hint);

  IF v_order.status = 'CANCELLED'
     OR COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%'
  THEN
    IF v_successor_id IS NULL THEN
      SELECT o.id
      INTO v_successor_id
      FROM public.orders o
      WHERE o.branch_id = v_order.branch_id
        AND COALESCE(o.notes, '') ILIKE ('%SUCCESSOR_OF_VOIDED_ORDER:' || p_order_id::text || '%')
      ORDER BY o.created_at DESC
      LIMIT 1;
    END IF;
    v_target_id := COALESCE(v_successor_id, p_order_id);
  ELSE
    v_target_id := p_order_id;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la orden a cobrar';
  END IF;

  SELECT cs.id
  INTO v_open_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_open_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto en la sucursal';
  END IF;

  UPDATE public.orders
  SET
    status = CASE
      WHEN status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED') THEN status
      ELSE 'SENT_TO_KITCHEN'::public.order_status
    END,
    paid_at = NULL,
    token_promocion = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancellation_reason = NULL,
    cancelled_from_status = NULL,
    cash_shift_id = v_open_shift_id,
    -- Si se revive la histórica (sin sucesora válida), quitar marcador que la deja atrapada en CANCELLED.
    notes = CASE
      WHEN id = p_order_id
        AND COALESCE(notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%'
        AND (v_successor_id IS NULL OR v_successor_id = p_order_id)
      THEN regexp_replace(
        COALESCE(notes, ''),
        'VOID_SUCCESSOR_ORDER:[a-f0-9-]{36}',
        'VOID_SUCCESSOR_CLEARED_FOR_RECHARGE',
        'gi'
      )
      ELSE notes
    END,
    updated_at = now()
  WHERE id = v_target_id;

  UPDATE public.order_items
  SET paid_at = NULL
  WHERE order_id = v_target_id
    AND paid_at IS NOT NULL;

  RETURN v_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_orden_para_recobro(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preparar_orden_para_recobro(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
