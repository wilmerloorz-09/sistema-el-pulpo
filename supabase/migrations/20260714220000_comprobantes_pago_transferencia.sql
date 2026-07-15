-- Comprobantes de transferencia: Storage + metadatos simples ligados a payments.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-pago',
  'comprobantes-pago',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.comprobantes_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  nombre_bucket text NOT NULL DEFAULT 'comprobantes-pago',
  ruta_objeto text NOT NULL,
  nombre_archivo text NOT NULL,
  tipo_mime text NOT NULL,
  tamano_bytes integer NOT NULL CHECK (tamano_bytes > 0),
  subido_por_usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comprobantes_pago_ruta_unica UNIQUE (ruta_objeto)
);

COMMENT ON TABLE public.comprobantes_pago IS
  'Metadatos de fotos de comprobante de transferencia; el archivo vive en Storage.';
COMMENT ON COLUMN public.comprobantes_pago.pago_id IS
  'Pago al que pertenece el comprobante.';
COMMENT ON COLUMN public.comprobantes_pago.ruta_objeto IS
  'Ruta del archivo dentro del bucket comprobantes-pago.';

CREATE INDEX IF NOT EXISTS idx_comprobantes_pago_pago_id
  ON public.comprobantes_pago (pago_id);

CREATE INDEX IF NOT EXISTS idx_comprobantes_pago_sucursal_id
  ON public.comprobantes_pago (sucursal_id);

ALTER TABLE public.comprobantes_pago ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios autenticados ven comprobantes_pago" ON public.comprobantes_pago;
CREATE POLICY "Usuarios autenticados ven comprobantes_pago"
ON public.comprobantes_pago
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), sucursal_id)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  OR public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Cajeros insertan comprobantes_pago" ON public.comprobantes_pago;
CREATE POLICY "Cajeros insertan comprobantes_pago"
ON public.comprobantes_pago
FOR INSERT
TO authenticated
WITH CHECK (
  subido_por_usuario_id = auth.uid()
  AND (
    public.can_operate_cash_branch(auth.uid(), sucursal_id)
    OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
    OR public.is_global_admin(auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE p.id = pago_id
      AND o.branch_id = sucursal_id
  )
);

DROP POLICY IF EXISTS "Admins borran comprobantes_pago" ON public.comprobantes_pago;
CREATE POLICY "Admins borran comprobantes_pago"
ON public.comprobantes_pago
FOR DELETE
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), sucursal_id)
  OR public.is_global_admin(auth.uid())
);

-- Storage: lectura autenticada (URLs firmadas / listado controlado por path de sucursal)
DROP POLICY IF EXISTS "Authenticated read comprobantes-pago" ON storage.objects;
CREATE POLICY "Authenticated read comprobantes-pago"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprobantes-pago'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND (
    public.can_operate_cash_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_global_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS "Cajeros upload comprobantes-pago" ON storage.objects;
CREATE POLICY "Cajeros upload comprobantes-pago"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprobantes-pago'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND (
    public.can_operate_cash_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_global_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS "Admins delete comprobantes-pago storage" ON storage.objects;
CREATE POLICY "Admins delete comprobantes-pago storage"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'comprobantes-pago'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND (
    public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_global_admin(auth.uid())
  )
);
