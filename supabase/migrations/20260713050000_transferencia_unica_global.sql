-- Unicidad global: banco + numero de transferencia (incluye pagos anulados).

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transferencia_unica
  ON public.payments (banco_id, lower(trim(numero_transferencia)))
  WHERE banco_id IS NOT NULL
    AND numero_transferencia IS NOT NULL
    AND trim(numero_transferencia) <> '';

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
  v_pay jsonb;
  v_banco_id uuid;
  v_numero text;
BEGIN
  FOR v_pay IN SELECT value FROM jsonb_array_elements(p_payments)
  LOOP
    v_banco_id := NULLIF(v_pay->>'banco_id', '')::uuid;
    v_numero := NULLIF(TRIM(v_pay->>'numero_transferencia'), '');

    IF v_banco_id IS NOT NULL AND v_numero IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.banco_id = v_banco_id
          AND lower(trim(p.numero_transferencia)) = lower(v_numero)
      ) THEN
        RAISE EXCEPTION 'transferencia duplicada: %', v_numero
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END LOOP;

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
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
