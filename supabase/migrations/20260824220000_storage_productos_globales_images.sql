-- Imágenes de productos globales: path global-products/{producto_id}/...
-- Las policies actuales de menu-node-images exigen que la 1ª carpeta sea UUID de sucursal.

DROP POLICY IF EXISTS "Global admins can upload global product images" ON storage.objects;
CREATE POLICY "Global admins can upload global product images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Global admins can update global product images" ON storage.objects;
CREATE POLICY "Global admins can update global product images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
)
WITH CHECK (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Global admins can delete global product images" ON storage.objects;
CREATE POLICY "Global admins can delete global product images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-node-images'
  AND (storage.foldername(name))[1] = 'global-products'
  AND public.is_global_admin(auth.uid())
);
