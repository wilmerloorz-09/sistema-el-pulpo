
-- Create branches table
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Superadmins can insert branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Superadmins can update branches" ON public.branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Superadmins can delete branches" ON public.branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'superadmin'));

-- Insert default branch
INSERT INTO public.branches (id, name, address) VALUES ('00000000-0000-0000-0000-000000000001', 'Sucursal Principal', 'Dirección principal') ON CONFLICT DO NOTHING;

-- Trigger for updated_at
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create user_branches junction table
CREATE TABLE IF NOT EXISTS public.user_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  UNIQUE(user_id, branch_id)
);

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view user_branches" ON public.user_branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert user_branches" ON public.user_branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins can update user_branches" ON public.user_branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins can delete user_branches" ON public.user_branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));

-- Assign all existing users to default branch
INSERT INTO public.user_branches (user_id, branch_id)
SELECT id, '00000000-0000-0000-0000-000000000001' FROM public.profiles
ON CONFLICT DO NOTHING;
