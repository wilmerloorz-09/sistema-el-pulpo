ALTER TABLE public.menu_nodes
  DROP CONSTRAINT IF EXISTS menu_nodes_product_price_chk;

ALTER TABLE public.menu_nodes
  ADD CONSTRAINT menu_nodes_product_price_chk
  CHECK (
    (node_type = 'category')
    OR (
      node_type = 'product'
      AND (
        (menu_scope = 'BULK')
        OR price IS NOT NULL
      )
    )
  );

NOTIFY pgrst, 'reload schema';
