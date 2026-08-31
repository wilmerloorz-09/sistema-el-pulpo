-- Categoría de negocio del producto global (no es el árbol de menú por sucursal).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'categoria_producto_global'
  ) THEN
    CREATE TYPE public.categoria_producto_global AS ENUM ('PLATOS', 'BEBIDAS', 'VARIOS');
  END IF;
END $$;

ALTER TABLE public.productos_globales
  ADD COLUMN IF NOT EXISTS categoria public.categoria_producto_global;

UPDATE public.productos_globales
SET categoria = 'PLATOS'::public.categoria_producto_global
WHERE categoria IS NULL;

ALTER TABLE public.productos_globales
  ALTER COLUMN categoria SET DEFAULT 'PLATOS'::public.categoria_producto_global;

ALTER TABLE public.productos_globales
  ALTER COLUMN categoria SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_productos_globales_categoria
  ON public.productos_globales (categoria);

COMMENT ON COLUMN public.productos_globales.categoria IS
  'Clasificación del catálogo global: PLATOS, BEBIDAS o VARIOS.';
