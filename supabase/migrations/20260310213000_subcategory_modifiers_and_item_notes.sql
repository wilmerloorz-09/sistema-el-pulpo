-- Modifiers by subcategory + structured item note support

-- 1) Mapping table: subcategory <-> modifiers
CREATE TABLE IF NOT EXISTS public.subcategory_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategory_id uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.modifiers(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subcategory_id, modifier_id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_modifiers_subcategory
  ON public.subcategory_modifiers(subcategory_id, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_subcategory_modifiers_modifier
  ON public.subcategory_modifiers(modifier_id);

DROP TRIGGER IF EXISTS update_subcategory_modifiers_updated_at ON public.subcategory_modifiers;
CREATE TRIGGER update_subcategory_modifiers_updated_at
BEFORE UPDATE ON public.subcategory_modifiers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Optional free note per order item (separated from structured modifiers)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS item_note text;

-- 3) Backfill baseline association (safe default)
-- Associates active modifiers to all active subcategories in the same branch.
WITH active_subcategories AS (
  SELECT s.id AS subcategory_id, c.branch_id
  FROM public.subcategories s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.is_active = true
),
active_modifiers AS (
  SELECT m.id AS modifier_id, m.branch_id, m.description
  FROM public.modifiers m
  WHERE m.is_active = true
),
seed_matrix AS (
  SELECT s.subcategory_id, m.modifier_id,
         ROW_NUMBER() OVER (PARTITION BY s.subcategory_id ORDER BY m.description) - 1 AS display_order
  FROM active_subcategories s
  JOIN active_modifiers m ON m.branch_id = s.branch_id
)
INSERT INTO public.subcategory_modifiers (subcategory_id, modifier_id, is_active, display_order)
SELECT subcategory_id, modifier_id, true, display_order
FROM seed_matrix
ON CONFLICT (subcategory_id, modifier_id) DO NOTHING;

-- 4) RLS
ALTER TABLE public.subcategory_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view subcategory modifiers" ON public.subcategory_modifiers;
CREATE POLICY "Users can view subcategory modifiers"
ON public.subcategory_modifiers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = subcategory_modifiers.subcategory_id
      AND (
        public.is_global_admin(auth.uid())
        OR public.has_branch_permission(auth.uid(), c.branch_id, 'admin_sucursal', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), c.branch_id, 'mesas', 'VIEW'::public.access_level)
      )
  )
);

DROP POLICY IF EXISTS "Users can manage subcategory modifiers" ON public.subcategory_modifiers;
CREATE POLICY "Users can manage subcategory modifiers"
ON public.subcategory_modifiers
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = subcategory_modifiers.subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = subcategory_modifiers.subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategory_modifiers TO authenticated;
