-- Módulo de comensales: catálogo normalizado `clientes` (independiente de profiles/auth).

CREATE TABLE IF NOT EXISTS public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula varchar(10) NOT NULL,
  sexo char(1) NOT NULL,
  nombres varchar(75) NOT NULL,
  apellidos varchar(75) NOT NULL,
  celular varchar(10) NOT NULL,
  correo varchar(150) DEFAULT NULL,
  direccion text DEFAULT NULL,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creado_el timestamptz NOT NULL DEFAULT now(),
  actualizado_el timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_cedula_formato_chk CHECK (cedula ~ '^[0-9]{10}$'),
  CONSTRAINT clientes_sexo_chk CHECK (sexo IN ('M', 'F')),
  CONSTRAINT clientes_celular_formato_chk CHECK (celular ~ '^[0-9]{10}$'),
  CONSTRAINT clientes_nombres_formato_chk CHECK (nombres ~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$'),
  CONSTRAINT clientes_apellidos_formato_chk CHECK (apellidos ~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$'),
  CONSTRAINT clientes_correo_formato_chk CHECK (
    correo IS NULL OR correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

COMMENT ON TABLE public.clientes IS 'Comensales del restaurante; no son usuarios internos del sistema.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_cedula ON public.clientes (cedula);

CREATE INDEX IF NOT EXISTS idx_clientes_busqueda_rapida
  ON public.clientes (cedula, apellidos, correo);

COMMENT ON COLUMN public.clientes.cedula IS 'Cédula ecuatoriana: 10 dígitos numéricos.';
COMMENT ON COLUMN public.clientes.sexo IS 'M = masculino, F = femenino.';
COMMENT ON COLUMN public.clientes.creado_por IS 'Usuario del turno que registró al comensal.';

CREATE OR REPLACE FUNCTION public.clientes_actualizar_marca_tiempo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_el := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_actualizar_marca_tiempo ON public.clientes;
CREATE TRIGGER trg_clientes_actualizar_marca_tiempo
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.clientes_actualizar_marca_tiempo();

-- Usuario habilitado en algún turno de caja abierto (evita recursividad RLS).
CREATE OR REPLACE FUNCTION public.usuario_en_turno_operativo_abierto(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    INNER JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
    WHERE cs.status = 'OPEN'
      AND csu.user_id = COALESCE(p_user_id, auth.uid())
      AND csu.is_enabled = true
  );
$$;

REVOKE ALL ON FUNCTION public.usuario_en_turno_operativo_abierto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_en_turno_operativo_abierto(uuid) TO authenticated;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clientes_select_turno_abierto ON public.clientes;
CREATE POLICY clientes_select_turno_abierto
  ON public.clientes
  FOR SELECT
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()));

DROP POLICY IF EXISTS clientes_insert_turno_abierto ON public.clientes;
CREATE POLICY clientes_insert_turno_abierto
  ON public.clientes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.usuario_en_turno_operativo_abierto(auth.uid())
    AND (creado_por IS NULL OR creado_por = auth.uid())
  );

DROP POLICY IF EXISTS clientes_update_turno_abierto ON public.clientes;
CREATE POLICY clientes_update_turno_abierto
  ON public.clientes
  FOR UPDATE
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()))
  WITH CHECK (public.usuario_en_turno_operativo_abierto(auth.uid()));

DROP POLICY IF EXISTS clientes_delete_turno_abierto ON public.clientes;
CREATE POLICY clientes_delete_turno_abierto
  ON public.clientes
  FOR DELETE
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()));

NOTIFY pgrst, 'reload schema';
