-- Included products configuration for BULK menu products

CREATE TABLE IF NOT EXISTS public.bulk_included_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_node_id uuid NOT NULL REFERENCES public.menu_nodes(id) ON DELETE CASCADE,
  included_node_id uuid NOT NULL REFERENCES public.menu_nodes(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_included_products_unique UNIQUE (menu_node_id, included_node_id),
  CONSTRAINT bulk_included_products_not_same_chk CHECK (menu_node_id <> included_node_id)
);

CREATE TABLE IF NOT EXISTS public.bulk_included_product_ranges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_included_product_id uuid NOT NULL REFERENCES public.bulk_included_products(id) ON DELETE CASCADE,
  amount_from numeric(12,2) NOT NULL,
  amount_to numeric(12,2) NOT NULL,
  included_quantity integer NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_included_product_ranges_amount_chk CHECK (amount_from >= 0 AND amount_to >= amount_from),
  CONSTRAINT bulk_included_product_ranges_quantity_chk CHECK (included_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_bulk_included_products_node
  ON public.bulk_included_products(menu_node_id, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_bulk_included_products_included
  ON public.bulk_included_products(included_node_id);

CREATE INDEX IF NOT EXISTS idx_bulk_included_product_ranges_parent
  ON public.bulk_included_product_ranges(bulk_included_product_id, display_order);

CREATE OR REPLACE FUNCTION public.validate_bulk_included_product_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_node public.menu_nodes%ROWTYPE;
  included_node public.menu_nodes%ROWTYPE;
BEGIN
  SELECT * INTO source_node
  FROM public.menu_nodes
  WHERE id = NEW.menu_node_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el producto de A Granel origen.';
  END IF;

  SELECT * INTO included_node
  FROM public.menu_nodes
  WHERE id = NEW.included_node_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el producto incluido.';
  END IF;

  IF source_node.branch_id <> included_node.branch_id THEN
    RAISE EXCEPTION 'El producto origen y el producto incluido deben pertenecer a la misma sucursal.';
  END IF;

  IF source_node.menu_scope <> 'BULK' OR included_node.menu_scope <> 'TABLE' THEN
    RAISE EXCEPTION 'El producto origen debe ser de A Granel y el producto incluido debe venir de Menu Mesa.';
  END IF;

  IF source_node.node_type <> 'product' OR included_node.node_type <> 'product' THEN
    RAISE EXCEPTION 'Los productos incluidos solo se pueden asignar entre nodos producto.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_bulk_included_product_assignment ON public.bulk_included_products;
CREATE TRIGGER trg_validate_bulk_included_product_assignment
BEFORE INSERT OR UPDATE ON public.bulk_included_products
FOR EACH ROW
EXECUTE FUNCTION public.validate_bulk_included_product_assignment();

DROP TRIGGER IF EXISTS update_bulk_included_products_updated_at ON public.bulk_included_products;
CREATE TRIGGER update_bulk_included_products_updated_at
BEFORE UPDATE ON public.bulk_included_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bulk_included_product_ranges_updated_at ON public.bulk_included_product_ranges;
CREATE TRIGGER update_bulk_included_product_ranges_updated_at
BEFORE UPDATE ON public.bulk_included_product_ranges
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bulk_included_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_included_product_ranges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bulk included products" ON public.bulk_included_products;
CREATE POLICY "Users can view bulk included products"
ON public.bulk_included_products
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = bulk_included_products.menu_node_id
      AND (
        public.is_global_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.active_branch_id = mn.branch_id
        )
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'admin_sucursal', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'mesas', 'VIEW'::public.access_level)
      )
  )
);

DROP POLICY IF EXISTS "Users can manage bulk included products" ON public.bulk_included_products;
CREATE POLICY "Users can manage bulk included products"
ON public.bulk_included_products
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = bulk_included_products.menu_node_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = bulk_included_products.menu_node_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
);

DROP POLICY IF EXISTS "Users can view bulk included product ranges" ON public.bulk_included_product_ranges;
CREATE POLICY "Users can view bulk included product ranges"
ON public.bulk_included_product_ranges
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE bip.id = bulk_included_product_ranges.bulk_included_product_id
      AND (
        public.is_global_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.active_branch_id = mn.branch_id
        )
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'admin_sucursal', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'mesas', 'VIEW'::public.access_level)
      )
  )
);

DROP POLICY IF EXISTS "Users can manage bulk included product ranges" ON public.bulk_included_product_ranges;
CREATE POLICY "Users can manage bulk included product ranges"
ON public.bulk_included_product_ranges
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE bip.id = bulk_included_product_ranges.bulk_included_product_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.bulk_included_products bip
    JOIN public.menu_nodes mn ON mn.id = bip.menu_node_id
    WHERE bip.id = bulk_included_product_ranges.bulk_included_product_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_included_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_included_product_ranges TO authenticated;
