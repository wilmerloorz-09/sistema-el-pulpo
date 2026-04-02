-- Migración: Globalizar las denominaciones
-- Requerimiento: Las denominaciones deben ser generales (globales) para todas las sucursales.
-- Solo administradores globales pueden gestionarlas.

-- 1. Eliminar la columna branch_id de denominations
-- Como la columna era NOT NULL, solo la eliminamos (asumiendo que los valores son únicos por sucursal anyway).
ALTER TABLE public.denominations
DROP COLUMN IF EXISTS branch_id CASCADE;

-- 2. Actualizar las políticas de RLS para el bucket de imágenes de denominaciones (si existe)
-- Las denominaciones tienen imágenes, que deben ser accesibles globalmente.
-- Asegurémonos de que el administrador global pueda gestionar estas imágenes.

-- Política INSERT para el bucket denomination-images
DROP POLICY IF EXISTS "Global Admin upload denom image" ON storage.objects;
CREATE POLICY "Global Admin upload denom image"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'denomination-images'
  AND public.is_global_admin(auth.uid())
);

-- Política UPDATE para el bucket denomination-images
DROP POLICY IF EXISTS "Global Admin update denom image" ON storage.objects;
CREATE POLICY "Global Admin update denom image"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'denomination-images'
  AND public.is_global_admin(auth.uid())
);

-- Política DELETE para el bucket denomination-images
DROP POLICY IF EXISTS "Global Admin delete denom image" ON storage.objects;
CREATE POLICY "Global Admin delete denom image"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'denomination-images'
  AND public.is_global_admin(auth.uid())
);

-- 3. Actualizar políticas de RLS en la tabla denominations
-- Lectura: Todos los autenticados pueden ver todas las denominaciones.
DROP POLICY IF EXISTS "Authenticated can view denominations" ON public.denominations;
CREATE POLICY "Authenticated can view denominations"
ON public.denominations FOR SELECT
TO authenticated
USING (true);

-- Escritura: Solo administradores globales.
DROP POLICY IF EXISTS "Global Admin manage denominations" ON public.denominations;
CREATE POLICY "Global Admin manage denominations"
ON public.denominations FOR ALL
TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));
