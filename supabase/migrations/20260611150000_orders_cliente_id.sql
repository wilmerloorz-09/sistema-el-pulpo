-- Vincula opcionalmente un comensal del catálogo `clientes` a la orden (asignado al cobrar).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cliente_id uuid;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_cliente_id_fkey;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_cliente_id ON public.orders (cliente_id);

COMMENT ON COLUMN public.orders.cliente_id IS 'Comensal asignado al cobrar; opcional.';

NOTIFY pgrst, 'reload schema';
