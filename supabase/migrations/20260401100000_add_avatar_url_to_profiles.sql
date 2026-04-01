-- Migración: Agregar campo avatar_url a profiles y actualizar RPC

-- 1. Agregar columna avatar_url a la tabla profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT NULL;

-- 2. Crear bucket de storage para avatares (si no existe)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Política: cualquier usuario autenticado puede subir su propio avatar
DROP POLICY IF EXISTS "Avatar upload own" ON storage.objects;
CREATE POLICY "Avatar upload own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Política: sobrescribir propio avatar
DROP POLICY IF EXISTS "Avatar update own" ON storage.objects;
CREATE POLICY "Avatar update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Política: lectura pública de avatares
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
CREATE POLICY "Avatar public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- 6. Actualizar la función admin_list_users_access para incluir avatar_url
CREATE OR REPLACE FUNCTION public.admin_list_users_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'username', p.username,
    'email', p.email,
    'is_active', p.is_active,
    'active_branch_id', p.active_branch_id,
    'avatar_url', p.avatar_url,
    'is_protected_superadmin', COALESCE(p.is_protected_superadmin, false),
    'global_roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.name), '[]'::jsonb)
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      WHERE ugr.user_id = p.id AND ugr.is_active = true
    ),
    'branch_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', ubr.branch_id, 'branch_name', b.name, 'role_code', r.code, 'role_name', r.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.user_branch_roles ubr
      JOIN public.roles r ON r.id = ubr.role_id
      JOIN public.branches b ON b.id = ubr.branch_id
      WHERE ubr.user_id = p.id AND ubr.is_active = true
    )
  ) ORDER BY p.full_name), '[]'::jsonb)
  FROM public.profiles p
  WHERE public.is_global_admin(auth.uid())
     OR public.has_branch_permission(
       auth.uid(),
       (SELECT active_branch_id FROM public.profiles WHERE id = auth.uid()),
       'admin_sucursal',
       'MANAGE'::public.access_level
     );
$$;
