-- Denomination images in catalog and storage

ALTER TABLE public.denominations
ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'denomination-images',
  'denomination-images',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can view denomination images" ON storage.objects;
CREATE POLICY "Public can view denomination images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'denomination-images');

DROP POLICY IF EXISTS "Branch admins can upload denomination images" ON storage.objects;
CREATE POLICY "Branch admins can upload denomination images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'denomination-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Branch admins can delete denomination images" ON storage.objects;
CREATE POLICY "Branch admins can delete denomination images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'denomination-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
