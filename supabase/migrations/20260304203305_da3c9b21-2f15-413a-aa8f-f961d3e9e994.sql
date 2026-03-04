
DROP POLICY IF EXISTS "Superadmins can insert branches" ON public.branches;
DROP POLICY IF EXISTS "Superadmins can update branches" ON public.branches;
DROP POLICY IF EXISTS "Superadmins can delete branches" ON public.branches;

CREATE POLICY "Admins can insert branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update branches" ON public.branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete branches" ON public.branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));
