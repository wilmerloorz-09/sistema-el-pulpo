-- Recursive menu tree for drill-down navigation

CREATE TABLE IF NOT EXISTS public.menu_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.menu_nodes(id) ON DELETE SET NULL,
  name text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN ('category', 'product')),
  depth integer NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  icon text,
  price numeric(10,2),
  description text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_nodes_product_price_chk CHECK (
    (node_type = 'product' AND price IS NOT NULL)
    OR (node_type = 'category')
  )
);

CREATE INDEX IF NOT EXISTS idx_menu_nodes_branch_parent_order
  ON public.menu_nodes(branch_id, parent_id, display_order, name);

CREATE INDEX IF NOT EXISTS idx_menu_nodes_branch_depth
  ON public.menu_nodes(branch_id, depth);

CREATE OR REPLACE FUNCTION public.fn_set_menu_node_depth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_depth integer;
  v_parent_type text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    RETURN NEW;
  END IF;

  SELECT depth, node_type
  INTO v_parent_depth, v_parent_type
  FROM public.menu_nodes
  WHERE id = NEW.parent_id;

  IF v_parent_depth IS NULL THEN
    RAISE EXCEPTION 'Parent menu node % does not exist', NEW.parent_id;
  END IF;

  IF v_parent_type <> 'category' THEN
    RAISE EXCEPTION 'A product node cannot be a parent';
  END IF;

  NEW.depth := v_parent_depth + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_node_depth ON public.menu_nodes;
CREATE TRIGGER trg_menu_node_depth
BEFORE INSERT OR UPDATE OF parent_id
ON public.menu_nodes
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_menu_node_depth();

DROP TRIGGER IF EXISTS update_menu_nodes_updated_at ON public.menu_nodes;
CREATE TRIGGER update_menu_nodes_updated_at
BEFORE UPDATE ON public.menu_nodes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.menu_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view menu nodes" ON public.menu_nodes;
CREATE POLICY "Users can view menu nodes"
ON public.menu_nodes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active_branch_id = menu_nodes.branch_id
  )
  OR public.can_manage_branch_admin(auth.uid(), menu_nodes.branch_id)
);

DROP POLICY IF EXISTS "Users can insert menu nodes by branch permission" ON public.menu_nodes;
CREATE POLICY "Users can insert menu nodes by branch permission"
ON public.menu_nodes
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Users can update menu nodes by branch permission" ON public.menu_nodes;
CREATE POLICY "Users can update menu nodes by branch permission"
ON public.menu_nodes
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Users can delete menu nodes by branch permission" ON public.menu_nodes;
CREATE POLICY "Users can delete menu nodes by branch permission"
ON public.menu_nodes
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_nodes TO authenticated;

INSERT INTO public.menu_nodes (
  id,
  branch_id,
  parent_id,
  name,
  node_type,
  display_order,
  is_active,
  description,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.branch_id,
  NULL,
  c.description,
  'category',
  COALESCE(c.display_order, 0),
  COALESCE(c.is_active, true),
  c.description,
  COALESCE(c.created_at, now()),
  COALESCE(c.updated_at, now())
FROM public.categories c
ON CONFLICT (id) DO UPDATE
SET
  branch_id = EXCLUDED.branch_id,
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  node_type = EXCLUDED.node_type,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.menu_nodes (
  id,
  branch_id,
  parent_id,
  name,
  node_type,
  display_order,
  is_active,
  description,
  created_at,
  updated_at
)
SELECT
  s.id,
  c.branch_id,
  s.category_id,
  s.description,
  'category',
  COALESCE(s.display_order, 0),
  COALESCE(s.is_active, true),
  s.description,
  COALESCE(s.created_at, now()),
  COALESCE(s.updated_at, now())
FROM public.subcategories s
JOIN public.categories c ON c.id = s.category_id
ON CONFLICT (id) DO UPDATE
SET
  branch_id = EXCLUDED.branch_id,
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  node_type = EXCLUDED.node_type,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.menu_nodes (
  id,
  branch_id,
  parent_id,
  name,
  node_type,
  display_order,
  is_active,
  price,
  description,
  image_url,
  created_at,
  updated_at
)
SELECT
  p.id,
  c.branch_id,
  p.subcategory_id,
  p.description,
  'product',
  COALESCE(p.display_order, 0),
  COALESCE(p.is_active, true),
  p.unit_price,
  NULL,
  NULL,
  COALESCE(p.created_at, now()),
  COALESCE(p.updated_at, now())
FROM public.products p
JOIN public.subcategories s ON s.id = p.subcategory_id
JOIN public.categories c ON c.id = s.category_id
ON CONFLICT (id) DO UPDATE
SET
  branch_id = EXCLUDED.branch_id,
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  node_type = EXCLUDED.node_type,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  updated_at = EXCLUDED.updated_at;

