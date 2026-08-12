-- =============================================================================
-- HOTFIX: restaurar register_payment_with_items estable
-- =============================================================================
-- 20260811140000 añadió begin_deferred_table_compacts/flush al cobro. Si esa
-- cola fallaba (o no existía la función), el RPC reventaba y Cobrar no cerraba.
-- Se restaura la versión de 20260811123000: sync única al final, sin cola.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments jsonb,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_count int;
  v_existing_count int;
  v_payment_count int;
  v_item record;
  v_qty_item numeric;
  v_qty_already_paid numeric;
  v_qty_cancelled numeric;
  v_available numeric;
BEGIN
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'payments es obligatorio';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items es obligatorio';
  END IF;

  SELECT count(DISTINCT (p->>'order_id')::uuid)
  INTO v_order_count
  FROM jsonb_array_elements(p_payments) AS p;

  IF v_order_count <> 1 THEN
    RAISE EXCEPTION 'Todos los pagos deben pertenecer a la misma orden';
  END IF;

  SELECT (p->>'order_id')::uuid
  INTO v_order_id
  FROM jsonb_array_elements(p_payments) AS p
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio en payments';
  END IF;

  PERFORM 1
  FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  PERFORM 1
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id
    AND oi.id IN (
      SELECT DISTINCT (i->>'order_item_id')::uuid
      FROM jsonb_array_elements(p_items) AS i
    )
  FOR UPDATE;

  SELECT count(*)::int
  INTO v_payment_count
  FROM jsonb_array_elements(p_payments) AS p;

  SELECT count(*)::int
  INTO v_existing_count
  FROM jsonb_array_elements(p_payments) AS p
  WHERE EXISTS (
    SELECT 1
    FROM public.payments pay
    WHERE pay.id = (p->>'id')::uuid
  );

  IF v_existing_count = v_payment_count THEN
    RETURN;
  END IF;

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Pago parcial ya registrado; reintenta el cobro completo';
  END IF;

  FOR v_item IN
    SELECT
      (i->>'order_item_id')::uuid AS order_item_id,
      SUM(COALESCE((i->>'quantity_paid')::numeric, 0)) AS qty_requested
    FROM jsonb_array_elements(p_items) AS i
    GROUP BY 1
  LOOP
    IF v_item.order_item_id IS NULL THEN
      RAISE EXCEPTION 'order_item_id es obligatorio en items';
    END IF;

    IF v_item.qty_requested IS NULL OR v_item.qty_requested <= 0 THEN
      RAISE EXCEPTION 'Cantidad a cobrar invalida';
    END IF;

    SELECT oi.quantity::numeric
    INTO v_qty_item
    FROM public.order_items oi
    WHERE oi.id = v_item.order_item_id
      AND oi.order_id = v_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la orden', v_item.order_item_id;
    END IF;

    SELECT COALESCE(SUM(pi.quantity_paid), 0)
    INTO v_qty_already_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id = v_item.order_item_id
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed');

    SELECT COALESCE(SUM(oic.quantity_cancelled), 0)
    INTO v_qty_cancelled
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id = v_item.order_item_id
      AND oc.status = 'APPLIED';

    v_available := GREATEST(0, COALESCE(v_qty_item, 0) - COALESCE(v_qty_cancelled, 0) - COALESCE(v_qty_already_paid, 0));

    IF v_item.qty_requested > v_available + 0.0001 THEN
      RAISE EXCEPTION
        'No se puede cobrar % unidades del item; solo hay % pendientes',
        v_item.qty_requested,
        v_available;
    END IF;
  END LOOP;

  -- Evitar doble sync (payments + payment_items) bajo el mismo FOR UPDATE.
  PERFORM set_config('app.skip_payment_state_sync', '1', true);

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    banco_id,
    numero_transferencia,
    created_by,
    created_at
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    NULLIF(p->>'change_amount', '')::numeric,
    p->>'notes',
    NULLIF(p->>'banco_id', '')::uuid,
    NULLIF(TRIM(p->>'numero_transferencia'), ''),
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p;

  INSERT INTO public.payment_items (
    id,
    payment_id,
    order_item_id,
    quantity_paid,
    unit_price,
    total_amount
  )
  SELECT
    (i->>'id')::uuid,
    (i->>'payment_id')::uuid,
    (i->>'order_item_id')::uuid,
    (i->>'quantity_paid')::numeric,
    (i->>'unit_price')::numeric,
    (i->>'total_amount')::numeric
  FROM jsonb_array_elements(p_items) AS i;

  PERFORM set_config('app.skip_payment_state_sync', '0', true);
  PERFORM public.sync_order_payment_state_internal(v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
