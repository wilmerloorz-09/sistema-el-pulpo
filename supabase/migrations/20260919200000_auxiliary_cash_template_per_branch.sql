-- Plantilla de caja auxiliar: una por sucursal, separada de las plantillas de cajero.

ALTER TABLE public.cash_register_templates
  ADD COLUMN IF NOT EXISTS is_auxiliary boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cash_register_templates.is_auxiliary IS
  'True: plantilla unica de caja auxiliar de la sucursal. False: plantillas de apertura de cajero.';

-- Marcar plantillas ya usadas como auxiliar o con nombre tipico.
UPDATE public.cash_register_templates t
SET is_auxiliary = true,
    updated_at = now()
WHERE t.is_auxiliary = false
  AND (
    lower(t.name) LIKE '%auxiliar%'
    OR EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.auxiliary_caja_template_id = t.id
    )
  );

-- Si una sucursal quedo con varias auxiliares, conservar una (preferida la referenciada).
WITH ranked AS (
  SELECT
    t.id,
    t.branch_id,
    row_number() OVER (
      PARTITION BY t.branch_id
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM public.cash_shifts cs WHERE cs.auxiliary_caja_template_id = t.id
        ) THEN 0 ELSE 1 END,
        t.updated_at DESC,
        t.created_at DESC
    ) AS rn
  FROM public.cash_register_templates t
  WHERE t.is_auxiliary = true
)
UPDATE public.cash_register_templates t
SET is_auxiliary = false,
    updated_at = now()
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_templates_one_auxiliary_per_branch
  ON public.cash_register_templates (branch_id)
  WHERE is_auxiliary = true;

NOTIFY pgrst, 'reload schema';
