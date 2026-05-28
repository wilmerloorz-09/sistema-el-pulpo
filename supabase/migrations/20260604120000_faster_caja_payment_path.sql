-- Cobro más rápido: un round-trip para payments + payment_items y otro para movimientos de caja.

CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments jsonb,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
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
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_movimientos_caja_operativos_batch(
  p_shift_id uuid,
  p_movements jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb;
  v_row public.cash_movements;
BEGIN
  IF p_movements IS NULL OR jsonb_array_length(p_movements) = 0 THEN
    RETURN;
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_movements)
  LOOP
    SELECT *
    INTO v_row
    FROM public.registrar_movimiento_caja_operativo(
      p_shift_id,
      (m->>'movement_type')::public.cash_movement_type,
      (m->>'qty_delta')::integer,
      NULLIF(m->>'payment_id', '')::uuid,
      NULLIF(m->>'denomination_id', '')::uuid,
      NULLIF(m->>'created_at', '')::timestamptz
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.registrar_movimientos_caja_operativos_batch(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimientos_caja_operativos_batch(uuid, jsonb) TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
