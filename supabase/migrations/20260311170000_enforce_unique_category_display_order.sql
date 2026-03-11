-- Evita numeros de orden duplicados en categorias dentro de la misma sucursal.
-- Si ya existen duplicados, los reordena al final antes de crear la restriccion.

WITH ranked_duplicates AS (
  SELECT
    c.id,
    c.branch_id,
    c.display_order,
    ROW_NUMBER() OVER (
      PARTITION BY c.branch_id, c.display_order
      ORDER BY c.created_at, c.id
    ) AS duplicate_rank
  FROM public.categories c
),
branch_max AS (
  SELECT
    c.branch_id,
    COALESCE(MAX(c.display_order), 0) AS max_display_order
  FROM public.categories c
  GROUP BY c.branch_id
),
reassigned AS (
  SELECT
    r.id,
    bm.max_display_order
      + ROW_NUMBER() OVER (
          PARTITION BY r.branch_id
          ORDER BY r.display_order, r.id
        ) AS new_display_order
  FROM ranked_duplicates r
  JOIN branch_max bm ON bm.branch_id = r.branch_id
  WHERE r.duplicate_rank > 1
)
UPDATE public.categories c
SET display_order = r.new_display_order,
    updated_at = now()
FROM reassigned r
WHERE c.id = r.id;

DROP INDEX IF EXISTS public.uq_categories_branch_display_order;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_branch_display_order
ON public.categories (branch_id, display_order);
