-- Stabilize user admin module: enforce unique branch assignments and allow superadmin in user CRUD policies

-- 1) Ensure helper exists
CREATE OR REPLACE FUNCTION public.is_admin_or_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'superadmin'::public.app_role);
$$;

-- 2) user_branches: remove duplicates and enforce unique pair used by ON CONFLICT
WITH duplicated AS (
  SELECT ctid
  FROM (
    SELECT ctid,
           row_number() OVER (PARTITION BY user_id, branch_id ORDER BY id) AS rn
    FROM public.user_branches
  ) t
  WHERE t.rn > 1
)
DELETE FROM public.user_branches ub
USING duplicated d
WHERE ub.ctid = d.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_branches_user_id_branch_id
  ON public.user_branches(user_id, branch_id);

-- 3) user_roles policies: admin + superadmin can manage roles
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "Admins can insert roles" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

CREATE POLICY "Admins can update roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.is_admin_or_superadmin(auth.uid()));

CREATE POLICY "Admins can delete roles" ON public.user_roles
FOR DELETE TO authenticated
USING (public.is_admin_or_superadmin(auth.uid()));

-- 4) profiles policies used by Users CRUD UI
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;

CREATE POLICY "Admins can insert profiles" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.is_admin_or_superadmin(auth.uid()) OR auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id OR public.is_admin_or_superadmin(auth.uid()))
WITH CHECK (auth.uid() = id OR public.is_admin_or_superadmin(auth.uid()));

CREATE POLICY "Admins can delete profiles" ON public.profiles
FOR DELETE TO authenticated
USING (public.is_admin_or_superadmin(auth.uid()));
