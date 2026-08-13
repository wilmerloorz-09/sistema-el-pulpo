-- Feriados bancarios para validar fechas de comprobantes de transferencia.
-- sucursal_id NULL = nacional (todas las sucursales).

CREATE TABLE IF NOT EXISTS public.feriados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  nombre text NOT NULL,
  sucursal_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  activo boolean NOT NULL DEFAULT true,
  origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('nacional', 'manual')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feriados_nombre_chk CHECK (length(trim(nombre)) >= 3)
);

COMMENT ON TABLE public.feriados IS
  'Días no hábiles bancarios (además de sábados y domingos). sucursal_id NULL aplica a todas las sucursales.';
COMMENT ON COLUMN public.feriados.origen IS
  'nacional = precarga del calendario oficial; manual = creado o ajustado por administración.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_feriados_fecha_nacional
  ON public.feriados (fecha)
  WHERE sucursal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feriados_fecha_sucursal
  ON public.feriados (fecha, sucursal_id)
  WHERE sucursal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feriados_activos
  ON public.feriados (fecha, activo, sucursal_id);

CREATE OR REPLACE FUNCTION public.feriados_actualizar_marca_tiempo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feriados_actualizar_marca_tiempo ON public.feriados;
CREATE TRIGGER trg_feriados_actualizar_marca_tiempo
BEFORE UPDATE ON public.feriados
FOR EACH ROW
EXECUTE FUNCTION public.feriados_actualizar_marca_tiempo();

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view feriados" ON public.feriados;
CREATE POLICY "Authenticated view feriados"
ON public.feriados
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Global Admin manage feriados" ON public.feriados;
CREATE POLICY "Global Admin manage feriados"
ON public.feriados
FOR ALL TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feriados TO authenticated;
