-- RPC atómica de cobro: inserta payments + payment_items en una sola transacción.
-- Reemplaza 2 round-trips secuenciales del cliente por 1 round-trip.
-- El trigger sync_order_payment_state_internal se llama una única vez al final.

CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments  jsonb,   -- [{id, order_id, payment_method_id, amount, notes, created_by, created_at}]
  p_items     jsonb    -- [{id, payment_id, order_item_id, quantity_paid, unit_price, total_amount}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  -- Insertar todos los payments en una sola sentencia
  INSERT INTO public.payments (id, order_id, payment_method_id, amount, notes, created_by, created_at)
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    p->>'notes',
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p;

  -- Insertar todos los payment_items en una sola sentencia
  INSERT INTO public.payment_items (id, payment_id, order_item_id, quantity_paid, unit_price, total_amount)
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
