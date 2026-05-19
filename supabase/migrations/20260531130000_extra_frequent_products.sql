-- Productos frecuentes para ordenes Extra (max 10 por sucursal).

CREATE TABLE IF NOT EXISTS public.extra_frequent_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_node_id uuid NOT NULL REFERENCES public.menu_nodes(id) ON DELETE CASCADE,
  display_order integer NOT NULL CHECK (display_order >= 1 AND display_order <= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extra_frequent_products_branch_node_unique UNIQUE (branch_id, menu_node_id),
  CONSTRAINT extra_frequent_products_branch_order_unique UNIQUE (branch_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_extra_frequent_products_branch_order
  ON public.extra_frequent_products (branch_id, display_order);

ALTER TABLE public.extra_frequent_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view extra frequent products" ON public.extra_frequent_products;
CREATE POLICY "Users can view extra frequent products"
ON public.extra_frequent_products
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active_branch_id = extra_frequent_products.branch_id
  )
  OR public.can_manage_branch_admin(auth.uid(), extra_frequent_products.branch_id)
);

DROP POLICY IF EXISTS "Admins insert extra frequent products" ON public.extra_frequent_products;
CREATE POLICY "Admins insert extra frequent products"
ON public.extra_frequent_products
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins update extra frequent products" ON public.extra_frequent_products;
CREATE POLICY "Admins update extra frequent products"
ON public.extra_frequent_products
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins delete extra frequent products" ON public.extra_frequent_products;
CREATE POLICY "Admins delete extra frequent products"
ON public.extra_frequent_products
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));
