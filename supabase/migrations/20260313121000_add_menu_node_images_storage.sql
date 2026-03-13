-- Storage bucket and policies for menu node images

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-node-images',
  'menu-node-images',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can view menu node images" ON storage.objects;
CREATE POLICY "Public can view menu node images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'menu-node-images');

DROP POLICY IF EXISTS "Branch admins can upload menu node images" ON storage.objects;
CREATE POLICY "Branch admins can upload menu node images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Branch admins can delete menu node images" ON storage.objects;
CREATE POLICY "Branch admins can delete menu node images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);