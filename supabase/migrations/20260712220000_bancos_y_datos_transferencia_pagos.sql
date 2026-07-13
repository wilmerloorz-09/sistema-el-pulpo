-- Catálogo de bancos para cobros por transferencia y persistencia en payments.

CREATE TABLE IF NOT EXISTS public.bancos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  orden_visual integer NOT NULL DEFAULT 1 CHECK (orden_visual >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bancos_nombre_unico UNIQUE (nombre)
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS banco_id uuid REFERENCES public.bancos(id),
  ADD COLUMN IF NOT EXISTS numero_transferencia text;

COMMENT ON TABLE public.bancos IS 'Catálogo de bancos para registrar transferencias en caja.';
COMMENT ON COLUMN public.payments.banco_id IS 'Banco de origen cuando el pago es por transferencia.';
COMMENT ON COLUMN public.payments.numero_transferencia IS 'Número o referencia de la transferencia bancaria.';

CREATE INDEX IF NOT EXISTS idx_payments_banco_id ON public.payments(banco_id)
  WHERE banco_id IS NOT NULL;

ALTER TABLE public.bancos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view bancos" ON public.bancos;
CREATE POLICY "Authenticated can view bancos"
  ON public.bancos FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Global Admin manage bancos" ON public.bancos;
CREATE POLICY "Global Admin manage bancos"
  ON public.bancos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.bancos (nombre, activo, orden_visual)
VALUES
  ('Banco Pichincha', true, 1),
  ('Banco de Guayaquil', true, 2),
  ('Banco del Pacífico', true, 3),
  ('Produbanco', true, 4),
  ('Banco Bolivariano', true, 5),
  ('Banco Internacional', true, 6),
  ('Banco del Austro', true, 7),
  ('Banco General Rumiñahui', true, 8),
  ('Banco Solidario', true, 9),
  ('Banco Amazonas', true, 10)
ON CONFLICT (nombre) DO NOTHING;

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
