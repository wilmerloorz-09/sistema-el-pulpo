-- Migración: Permitir a administradores globales subir/actualizar avatares de cualquier usuario

-- Política INSERT: admins globales pueden subir a cualquier carpeta del bucket avatars
DROP POLICY IF EXISTS "Avatar upload admin" ON storage.objects;
CREATE POLICY "Avatar upload admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND public.is_global_admin(auth.uid())
);

-- Política UPDATE: admins globales pueden actualizar cualquier avatar
DROP POLICY IF EXISTS "Avatar update admin" ON storage.objects;
CREATE POLICY "Avatar update admin"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.is_global_admin(auth.uid())
);

-- Política DELETE: admins globales pueden borrar avatares
DROP POLICY IF EXISTS "Avatar delete admin" ON storage.objects;
CREATE POLICY "Avatar delete admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.is_global_admin(auth.uid())
);

-- Política UPDATE en profiles: admins globales pueden actualizar avatar_url de cualquier perfil
DROP POLICY IF EXISTS "Admin can update any avatar_url" ON public.profiles;
CREATE POLICY "Admin can update any avatar_url"
ON public.profiles FOR UPDATE
TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));
