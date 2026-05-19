-- Extiende productos frecuentes a Mesa, Para llevar, Express y Extra (sin limite de cantidad).

ALTER TABLE public.extra_frequent_products
  ADD COLUMN IF NOT EXISTS context text;

UPDATE public.extra_frequent_products
SET context = 'EXTRA'
WHERE context IS NULL;

ALTER TABLE public.extra_frequent_products
  ALTER COLUMN context SET NOT NULL;

ALTER TABLE public.extra_frequent_products
  DROP CONSTRAINT IF EXISTS extra_frequent_products_display_order_check;

ALTER TABLE public.extra_frequent_products
  DROP CONSTRAINT IF EXISTS extra_frequent_products_branch_node_unique;

ALTER TABLE public.extra_frequent_products
  DROP CONSTRAINT IF EXISTS extra_frequent_products_branch_order_unique;

ALTER TABLE public.extra_frequent_products
  DROP CONSTRAINT IF EXISTS extra_frequent_products_context_check;

ALTER TABLE public.extra_frequent_products
  ADD CONSTRAINT extra_frequent_products_context_check
  CHECK (context IN ('MESA', 'TAKEOUT', 'EXPRESS', 'EXTRA'));

ALTER TABLE public.extra_frequent_products
  ADD CONSTRAINT extra_frequent_products_display_order_check
  CHECK (display_order >= 1);

ALTER TABLE public.extra_frequent_products
  ADD CONSTRAINT extra_frequent_products_branch_context_node_unique
  UNIQUE (branch_id, context, menu_node_id);

ALTER TABLE public.extra_frequent_products
  ADD CONSTRAINT extra_frequent_products_branch_context_order_unique
  UNIQUE (branch_id, context, display_order);

DROP INDEX IF EXISTS idx_extra_frequent_products_branch_order;

CREATE INDEX IF NOT EXISTS idx_extra_frequent_products_branch_context_order
  ON public.extra_frequent_products (branch_id, context, display_order);
