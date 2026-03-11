-- Normaliza y blinda los ordenes visuales restantes del admin.
-- - restaurant_tables.visual_order por sucursal
-- - denominations.display_order por sucursal
-- - subcategory_modifiers.display_order por subcategoria

WITH normalized_tables AS (
  SELECT
    rt.id,
    ROW_NUMBER() OVER (
      PARTITION BY rt.branch_id
      ORDER BY COALESCE(NULLIF(rt.visual_order, 0), 2147483647), rt.created_at, rt.id
    ) AS new_visual_order
  FROM public.restaurant_tables rt
)
UPDATE public.restaurant_tables rt
SET visual_order = n.new_visual_order,
    updated_at = now()
FROM normalized_tables n
WHERE rt.id = n.id
  AND rt.visual_order IS DISTINCT FROM n.new_visual_order;

WITH normalized_denominations AS (
  SELECT
    d.id,
    ROW_NUMBER() OVER (
      PARTITION BY d.branch_id
      ORDER BY COALESCE(NULLIF(d.display_order, 0), 2147483647), d.value, d.id
    ) AS new_display_order
  FROM public.denominations d
)
UPDATE public.denominations d
SET display_order = n.new_display_order
FROM normalized_denominations n
WHERE d.id = n.id
  AND d.display_order IS DISTINCT FROM n.new_display_order;

WITH normalized_subcategory_modifiers AS (
  SELECT
    sm.id,
    ROW_NUMBER() OVER (
      PARTITION BY sm.subcategory_id
      ORDER BY COALESCE(NULLIF(sm.display_order, 0), 2147483647), sm.created_at, sm.id
    ) AS new_display_order
  FROM public.subcategory_modifiers sm
)
UPDATE public.subcategory_modifiers sm
SET display_order = n.new_display_order
FROM normalized_subcategory_modifiers n
WHERE sm.id = n.id
  AND sm.display_order IS DISTINCT FROM n.new_display_order;

DROP INDEX IF EXISTS public.uq_restaurant_tables_branch_visual_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_branch_visual_order
ON public.restaurant_tables (branch_id, visual_order);

DROP INDEX IF EXISTS public.uq_denominations_branch_display_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_denominations_branch_display_order
ON public.denominations (branch_id, display_order);

DROP INDEX IF EXISTS public.uq_subcategory_modifiers_subcategory_display_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategory_modifiers_subcategory_display_order
ON public.subcategory_modifiers (subcategory_id, display_order);
