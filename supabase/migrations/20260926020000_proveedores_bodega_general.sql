-- Proveedores de bodega general (catálogo central).
-- Nombres en español.

CREATE TABLE IF NOT EXISTS public.proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruc_cedula text NOT NULL,
  nombre text NOT NULL,
  nombre_comercial text NULL,
  telefono text NULL,
  email text NULL,
  direccion text NULL,
  ciudad text NULL,
  persona_contacto text NULL,
  telefono_contacto text NULL,
  notas text NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedores_ruc_cedula_chk CHECK (length(btrim(ruc_cedula)) >= 5),
  CONSTRAINT proveedores_nombre_chk CHECK (length(btrim(nombre)) >= 2)
);

COMMENT ON TABLE public.proveedores IS
  'Proveedores del catálogo de bodega general (compras e ingresos).';
COMMENT ON COLUMN public.proveedores.ruc_cedula IS
  'RUC (13 dígitos) o cédula (10 dígitos) del proveedor.';
COMMENT ON COLUMN public.proveedores.nombre IS
  'Razón social o nombre legal.';
COMMENT ON COLUMN public.proveedores.nombre_comercial IS
  'Nombre comercial opcional.';
COMMENT ON COLUMN public.proveedores.persona_contacto IS
  'Persona de contacto en el proveedor.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_ruc_cedula_uniq
  ON public.proveedores (lower(btrim(ruc_cedula)));

CREATE INDEX IF NOT EXISTS idx_proveedores_activo
  ON public.proveedores (activo);

CREATE INDEX IF NOT EXISTS idx_proveedores_nombre
  ON public.proveedores (lower(nombre));

CREATE OR REPLACE FUNCTION public.trg_proveedores_set_actualizado_en()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.ruc_cedula := btrim(NEW.ruc_cedula);
  NEW.nombre := btrim(NEW.nombre);
  NEW.nombre_comercial := NULLIF(btrim(COALESCE(NEW.nombre_comercial, '')), '');
  NEW.telefono := NULLIF(btrim(COALESCE(NEW.telefono, '')), '');
  NEW.email := NULLIF(btrim(COALESCE(NEW.email, '')), '');
  NEW.direccion := NULLIF(btrim(COALESCE(NEW.direccion, '')), '');
  NEW.ciudad := NULLIF(btrim(COALESCE(NEW.ciudad, '')), '');
  NEW.persona_contacto := NULLIF(btrim(COALESCE(NEW.persona_contacto, '')), '');
  NEW.telefono_contacto := NULLIF(btrim(COALESCE(NEW.telefono_contacto, '')), '');
  NEW.notas := NULLIF(btrim(COALESCE(NEW.notas, '')), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proveedores_set_actualizado_en ON public.proveedores;
CREATE TRIGGER trg_proveedores_set_actualizado_en
BEFORE INSERT OR UPDATE ON public.proveedores
FOR EACH ROW
EXECUTE FUNCTION public.trg_proveedores_set_actualizado_en();

ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedores_select ON public.proveedores;
CREATE POLICY proveedores_select
ON public.proveedores
FOR SELECT
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

DROP POLICY IF EXISTS proveedores_insert ON public.proveedores;
CREATE POLICY proveedores_insert
ON public.proveedores
FOR INSERT
TO authenticated
WITH CHECK (public.can_operate_bodega_general(auth.uid()));

DROP POLICY IF EXISTS proveedores_update ON public.proveedores;
CREATE POLICY proveedores_update
ON public.proveedores
FOR UPDATE
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()))
WITH CHECK (public.can_operate_bodega_general(auth.uid()));

DROP POLICY IF EXISTS proveedores_delete ON public.proveedores;
CREATE POLICY proveedores_delete
ON public.proveedores
FOR DELETE
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedores TO authenticated;

NOTIFY pgrst, 'reload schema';
