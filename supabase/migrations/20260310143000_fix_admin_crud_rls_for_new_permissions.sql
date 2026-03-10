-- Align admin CRUD RLS with the new branch-based permission model

CREATE OR REPLACE FUNCTION public.can_manage_branch_admin(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_sucursal', 'MANAGE'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_global', 'MANAGE'::public.access_level);
$$;

DROP POLICY IF EXISTS "Admins can insert tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Admins can update tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Admins can delete tables" ON public.restaurant_tables;

CREATE POLICY "Users can insert tables by branch permission"
ON public.restaurant_tables
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can update tables by branch permission"
ON public.restaurant_tables
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can delete tables by branch permission"
ON public.restaurant_tables
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;

CREATE POLICY "Users can insert categories by branch permission"
ON public.categories
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can update categories by branch permission"
ON public.categories
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can delete categories by branch permission"
ON public.categories
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins can insert modifiers" ON public.modifiers;
DROP POLICY IF EXISTS "Admins can update modifiers" ON public.modifiers;
DROP POLICY IF EXISTS "Admins can delete modifiers" ON public.modifiers;

CREATE POLICY "Users can insert modifiers by branch permission"
ON public.modifiers
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can update modifiers by branch permission"
ON public.modifiers
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can delete modifiers by branch permission"
ON public.modifiers
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins can insert payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can update payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can delete payment methods" ON public.payment_methods;

CREATE POLICY "Users can insert payment methods by branch permission"
ON public.payment_methods
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can update payment methods by branch permission"
ON public.payment_methods
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can delete payment methods by branch permission"
ON public.payment_methods
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins can insert denominations" ON public.denominations;
DROP POLICY IF EXISTS "Admins can update denominations" ON public.denominations;
DROP POLICY IF EXISTS "Admins can delete denominations" ON public.denominations;

CREATE POLICY "Users can insert denominations by branch permission"
ON public.denominations
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can update denominations by branch permission"
ON public.denominations
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

CREATE POLICY "Users can delete denominations by branch permission"
ON public.denominations
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Admins can insert subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "Admins can update subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "Admins can delete subcategories" ON public.subcategories;

CREATE POLICY "Users can insert subcategories by branch permission"
ON public.subcategories
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = category_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

CREATE POLICY "Users can update subcategories by branch permission"
ON public.subcategories
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = subcategories.category_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = category_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

CREATE POLICY "Users can delete subcategories by branch permission"
ON public.subcategories
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = subcategories.category_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;

CREATE POLICY "Users can insert products by branch permission"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

CREATE POLICY "Users can update products by branch permission"
ON public.products
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = products.subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

CREATE POLICY "Users can delete products by branch permission"
ON public.products
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subcategories s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = products.subcategory_id
      AND public.can_manage_branch_admin(auth.uid(), c.branch_id)
  )
);

DROP POLICY IF EXISTS "Superadmins can insert branches" ON public.branches;
DROP POLICY IF EXISTS "Superadmins can update branches" ON public.branches;
DROP POLICY IF EXISTS "Superadmins can delete branches" ON public.branches;
DROP POLICY IF EXISTS "Admins can insert branches" ON public.branches;
DROP POLICY IF EXISTS "Admins can update branches" ON public.branches;
DROP POLICY IF EXISTS "Admins can delete branches" ON public.branches;

CREATE POLICY "Global admins can insert branches"
ON public.branches
FOR INSERT
TO authenticated
WITH CHECK (public.is_global_admin(auth.uid()));

CREATE POLICY "Global admins can update branches"
ON public.branches
FOR UPDATE
TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));

CREATE POLICY "Global admins can delete branches"
ON public.branches
FOR DELETE
TO authenticated
USING (public.is_global_admin(auth.uid()));
