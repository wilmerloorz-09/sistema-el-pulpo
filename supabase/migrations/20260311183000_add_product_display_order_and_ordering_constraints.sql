-- Agrega orden visual a productos y normaliza el orden de categorias, subcategorias y productos.
-- Regla final:
-- - categorias: orden unico por sucursal
-- - subcategorias: orden unico por categoria
-- - productos: orden unico por subcategoria

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS display_order integer;

WITH normalized_categories AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.branch_id
      ORDER BY COALESCE(NULLIF(c.display_order, 0), 2147483647), c.created_at, c.id
    ) AS new_display_order
  FROM public.categories c
)
UPDATE public.categories c
SET display_order = n.new_display_order,
    updated_at = now()
FROM normalized_categories n
WHERE c.id = n.id
  AND c.display_order IS DISTINCT FROM n.new_display_order;

WITH normalized_subcategories AS (
  SELECT
    s.id,
    ROW_NUMBER() OVER (
      PARTITION BY s.category_id
      ORDER BY COALESCE(NULLIF(s.display_order, 0), 2147483647), s.created_at, s.id
    ) AS new_display_order
  FROM public.subcategories s
)
UPDATE public.subcategories s
SET display_order = n.new_display_order,
    updated_at = now()
FROM normalized_subcategories n
WHERE s.id = n.id
  AND s.display_order IS DISTINCT FROM n.new_display_order;

WITH normalized_products AS (
  SELECT
    p.id,
    ROW_NUMBER() OVER (
      PARTITION BY p.subcategory_id
      ORDER BY COALESCE(NULLIF(p.display_order, 0), 2147483647), p.created_at, p.id
    ) AS new_display_order
  FROM public.products p
)
UPDATE public.products p
SET display_order = n.new_display_order,
    updated_at = now()
FROM normalized_products n
WHERE p.id = n.id
  AND p.display_order IS DISTINCT FROM n.new_display_order;

ALTER TABLE public.products
ALTER COLUMN display_order SET NOT NULL;

DROP INDEX IF EXISTS public.uq_subcategories_category_display_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategories_category_display_order
ON public.subcategories (category_id, display_order);

DROP INDEX IF EXISTS public.uq_products_subcategory_display_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_subcategory_display_order
ON public.products (subcategory_id, display_order);
