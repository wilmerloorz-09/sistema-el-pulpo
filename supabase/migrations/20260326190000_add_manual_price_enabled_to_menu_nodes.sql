ALTER TABLE public.menu_nodes
  ADD COLUMN IF NOT EXISTS manual_price_enabled boolean NOT NULL DEFAULT false;
