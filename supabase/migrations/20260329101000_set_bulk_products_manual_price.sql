UPDATE public.menu_nodes
SET
  price = NULL,
  updated_at = now()
WHERE menu_scope = 'BULK'
  AND node_type = 'product';

UPDATE public.products p
SET
  unit_price = NULL,
  price_mode = 'MANUAL',
  updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.menu_nodes mn
  WHERE mn.menu_scope = 'BULK'
    AND mn.node_type = 'product'
    AND mn.legacy_product_id = p.id
);

NOTIFY pgrst, 'reload schema';
