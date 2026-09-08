-- Control de jornadas trabajadas, tarifas versionadas, periodos y pagos de personal.
-- Dominio independiente de los turnos/cobros del POS.

INSERT INTO public.modules (code, name, description, is_active)
VALUES
  ('jornadas_personal', 'Jornadas del personal', 'Registro, aprobación y consulta de jornadas trabajadas', true),
  ('pagos_personal', 'Pagos del personal', 'Tarifas, periodos, liquidaciones y pagos del personal', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT r.id, m.id,
  CASE
    WHEN r.code = 'administrador' THEN 'MANAGE'::public.access_level
    WHEN r.code = 'supervisor' AND m.code = 'jornadas_personal' THEN 'OPERATE'::public.access_level
    ELSE 'NONE'::public.access_level
  END
FROM public.roles r
JOIN public.modules m ON m.code IN ('jornadas_personal', 'pagos_personal')
WHERE r.code IN ('administrador', 'supervisor')
ON CONFLICT (role_id, module_id) DO UPDATE
SET access_level = EXCLUDED.access_level;

CREATE TABLE IF NOT EXISTS public.funciones_laborales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  orden smallint NOT NULL DEFAULT 0,
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funciones_laborales_codigo_ck CHECK (codigo = upper(btrim(codigo)) AND codigo <> ''),
  CONSTRAINT funciones_laborales_nombre_ck CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_funciones_laborales_codigo
  ON public.funciones_laborales (upper(codigo));
CREATE INDEX IF NOT EXISTS ix_funciones_laborales_activas
  ON public.funciones_laborales (activo, orden, nombre);

CREATE TABLE IF NOT EXISTS public.modalidades_jornada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  orden smallint NOT NULL DEFAULT 0,
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modalidades_jornada_codigo_ck CHECK (codigo = upper(btrim(codigo)) AND codigo <> ''),
  CONSTRAINT modalidades_jornada_nombre_ck CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_modalidades_jornada_codigo
  ON public.modalidades_jornada (upper(codigo));

CREATE TABLE IF NOT EXISTS public.configuraciones_jornada_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  modalidad_jornada_id uuid NOT NULL REFERENCES public.modalidades_jornada(id) ON DELETE RESTRICT,
  tipo_cupo text NOT NULL DEFAULT 'BASE',
  maximo_por_persona_dia smallint NOT NULL DEFAULT 1,
  activo boolean NOT NULL DEFAULT true,
  vigente_desde date NOT NULL DEFAULT current_date,
  vigente_hasta date,
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuraciones_jornada_tipo_ck CHECK (tipo_cupo IN ('BASE', 'COMPLEMENTARIA')),
  CONSTRAINT configuraciones_jornada_max_ck CHECK (maximo_por_persona_dia >= 1),
  CONSTRAINT configuraciones_jornada_vigencia_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_configuraciones_jornada_vigencia
  ON public.configuraciones_jornada_sucursal
  (sucursal_id, modalidad_jornada_id, vigente_desde);
CREATE INDEX IF NOT EXISTS ix_configuraciones_jornada_sucursal
  ON public.configuraciones_jornada_sucursal (sucursal_id, activo, vigente_desde, vigente_hasta);

CREATE TABLE IF NOT EXISTS public.tipos_dia_especial_laboral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  orden smallint NOT NULL DEFAULT 0,
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tipos_dia_especial_codigo_ck CHECK (codigo = upper(btrim(codigo)) AND codigo <> ''),
  CONSTRAINT tipos_dia_especial_nombre_ck CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tipos_dia_especial_codigo
  ON public.tipos_dia_especial_laboral (upper(codigo));

CREATE TABLE IF NOT EXISTS public.dias_especiales_laborales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  sucursal_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  tipo_dia_especial_laboral_id uuid NOT NULL REFERENCES public.tipos_dia_especial_laboral(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  descripcion text,
  feriado_id uuid REFERENCES public.feriados(id) ON DELETE SET NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dias_especiales_laborales_nombre_ck CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dias_especiales_laborales_scope
  ON public.dias_especiales_laborales
  (fecha, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo_dia_especial_laboral_id)
  WHERE activo;
CREATE INDEX IF NOT EXISTS ix_dias_especiales_laborales_fecha
  ON public.dias_especiales_laborales (fecha, sucursal_id, activo);

CREATE TABLE IF NOT EXISTS public.tarifas_jornada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regla_codigo text NOT NULL,
  version integer NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  funcion_laboral_id uuid NOT NULL REFERENCES public.funciones_laborales(id) ON DELETE RESTRICT,
  sucursal_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  configuracion_jornada_sucursal_id uuid REFERENCES public.configuraciones_jornada_sucursal(id) ON DELETE RESTRICT,
  dias_semana smallint[],
  tipo_dia_especial_laboral_id uuid REFERENCES public.tipos_dia_especial_laboral(id) ON DELETE RESTRICT,
  dia_especial_laboral_id uuid REFERENCES public.dias_especiales_laborales(id) ON DELETE RESTRICT,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  monto numeric(12,2) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'USD',
  prioridad integer NOT NULL DEFAULT 100,
  activa boolean NOT NULL DEFAULT true,
  version_anterior_id uuid REFERENCES public.tarifas_jornada(id) ON DELETE RESTRICT,
  motivo_cambio text NOT NULL,
  creada_por uuid NOT NULL REFERENCES public.profiles(id),
  creada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tarifas_jornada_codigo_ck CHECK (regla_codigo = upper(btrim(regla_codigo)) AND regla_codigo <> ''),
  CONSTRAINT tarifas_jornada_version_ck CHECK (version >= 1),
  CONSTRAINT tarifas_jornada_nombre_ck CHECK (btrim(nombre) <> ''),
  CONSTRAINT tarifas_jornada_monto_ck CHECK (monto >= 0),
  CONSTRAINT tarifas_jornada_moneda_ck CHECK (moneda = 'USD'),
  CONSTRAINT tarifas_jornada_vigencia_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT tarifas_jornada_especial_ck CHECK (
    NOT (tipo_dia_especial_laboral_id IS NOT NULL AND dia_especial_laboral_id IS NOT NULL)
  ),
  CONSTRAINT tarifas_jornada_dias_ck CHECK (
    dias_semana IS NULL OR (
      cardinality(dias_semana) BETWEEN 1 AND 7
      AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    )
  ),
  UNIQUE (regla_codigo, version)
);
CREATE INDEX IF NOT EXISTS ix_tarifas_jornada_resolver
  ON public.tarifas_jornada (funcion_laboral_id, activa, vigente_desde, vigente_hasta, prioridad DESC);
CREATE INDEX IF NOT EXISTS ix_tarifas_jornada_sucursal
  ON public.tarifas_jornada (sucursal_id, configuracion_jornada_sucursal_id);

CREATE TABLE IF NOT EXISTS public.jornadas_trabajadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  persona_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  fecha_laboral date NOT NULL,
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  configuracion_jornada_sucursal_id uuid NOT NULL REFERENCES public.configuraciones_jornada_sucursal(id) ON DELETE RESTRICT,
  funcion_laboral_id uuid NOT NULL REFERENCES public.funciones_laborales(id) ON DELETE RESTRICT,
  cash_shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL,
  tarifa_jornada_id uuid NOT NULL REFERENCES public.tarifas_jornada(id) ON DELETE RESTRICT,
  monto_tarifa_snapshot numeric(12,2) NOT NULL,
  moneda_snapshot char(3) NOT NULL DEFAULT 'USD',
  tarifa_nombre_snapshot text NOT NULL,
  criterios_tarifa_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  prioridad_tarifa_snapshot integer NOT NULL,
  tarifa_resuelta_en timestamptz NOT NULL DEFAULT now(),
  persona_nombre_snapshot text NOT NULL,
  persona_identificacion_snapshot text,
  sucursal_nombre_snapshot text NOT NULL,
  sucursal_codigo_snapshot text,
  modalidad_nombre_snapshot text NOT NULL,
  funcion_nombre_snapshot text NOT NULL,
  estado text NOT NULL DEFAULT 'REGISTRADA',
  observacion text,
  registrada_por uuid NOT NULL REFERENCES public.profiles(id),
  registrada_en timestamptz NOT NULL DEFAULT now(),
  aprobada_por uuid REFERENCES public.profiles(id),
  aprobada_en timestamptz,
  anulada_por uuid REFERENCES public.profiles(id),
  anulada_en timestamptz,
  motivo_anulacion text,
  reemplaza_jornada_id uuid REFERENCES public.jornadas_trabajadas(id) ON DELETE RESTRICT,
  CONSTRAINT jornadas_trabajadas_estado_ck CHECK (estado IN ('REGISTRADA','APROBADA','LIQUIDADA','ANULADA')),
  CONSTRAINT jornadas_trabajadas_monto_ck CHECK (monto_tarifa_snapshot >= 0),
  CONSTRAINT jornadas_trabajadas_anulacion_ck CHECK (
    estado <> 'ANULADA' OR (
      anulada_por IS NOT NULL AND anulada_en IS NOT NULL
      AND motivo_anulacion IS NOT NULL AND btrim(motivo_anulacion) <> ''
    )
  )
);
CREATE INDEX IF NOT EXISTS ix_jornadas_trabajadas_configuracion_activa
  ON public.jornadas_trabajadas (persona_id, fecha_laboral, configuracion_jornada_sucursal_id)
  WHERE estado <> 'ANULADA';
CREATE UNIQUE INDEX IF NOT EXISTS ux_jornadas_reemplazo_activo
  ON public.jornadas_trabajadas (reemplaza_jornada_id)
  WHERE reemplaza_jornada_id IS NOT NULL AND estado <> 'ANULADA';
CREATE INDEX IF NOT EXISTS ix_jornadas_trabajadas_persona_fecha
  ON public.jornadas_trabajadas (persona_id, fecha_laboral DESC);
CREATE INDEX IF NOT EXISTS ix_jornadas_trabajadas_sucursal_fecha
  ON public.jornadas_trabajadas (sucursal_id, fecha_laboral DESC);
CREATE INDEX IF NOT EXISTS ix_jornadas_trabajadas_estado_fecha
  ON public.jornadas_trabajadas (estado, fecha_laboral DESC);

CREATE TABLE IF NOT EXISTS public.periodos_pago_personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado text NOT NULL DEFAULT 'ABIERTO',
  total_personas_snapshot integer,
  total_jornadas_snapshot integer,
  total_general_snapshot numeric(14,2),
  moneda char(3) NOT NULL DEFAULT 'USD',
  creado_por uuid NOT NULL REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  calculado_por uuid REFERENCES public.profiles(id),
  calculado_en timestamptz,
  pagado_en timestamptz,
  anulado_por uuid REFERENCES public.profiles(id),
  anulado_en timestamptz,
  motivo_anulacion text,
  CONSTRAINT periodos_pago_fechas_ck CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT periodos_pago_estado_ck CHECK (estado IN ('ABIERTO','CALCULADO','EN_PAGO','PAGADO','ANULADO')),
  CONSTRAINT periodos_pago_anulacion_ck CHECK (
    estado <> 'ANULADO' OR (
      anulado_por IS NOT NULL AND anulado_en IS NOT NULL
      AND motivo_anulacion IS NOT NULL AND btrim(motivo_anulacion) <> ''
    )
  ),
  CONSTRAINT periodos_pago_no_solapados
    EXCLUDE USING gist (daterange(fecha_inicio, fecha_fin, '[]') WITH &&)
    WHERE (estado <> 'ANULADO')
);
CREATE INDEX IF NOT EXISTS ix_periodos_pago_personal_fechas
  ON public.periodos_pago_personal (fecha_inicio, fecha_fin, estado);

CREATE TABLE IF NOT EXISTS public.liquidaciones_personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  periodo_pago_personal_id uuid NOT NULL REFERENCES public.periodos_pago_personal(id) ON DELETE RESTRICT,
  persona_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  persona_nombre_snapshot text NOT NULL,
  persona_identificacion_snapshot text,
  cantidad_jornadas_snapshot integer NOT NULL,
  total_snapshot numeric(14,2) NOT NULL,
  moneda_snapshot char(3) NOT NULL DEFAULT 'USD',
  estado text NOT NULL DEFAULT 'PENDIENTE',
  creada_por uuid NOT NULL REFERENCES public.profiles(id),
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT liquidaciones_personal_estado_ck CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA')),
  CONSTRAINT liquidaciones_personal_totales_ck CHECK (cantidad_jornadas_snapshot > 0 AND total_snapshot >= 0),
  UNIQUE (periodo_pago_personal_id, persona_id)
);
CREATE INDEX IF NOT EXISTS ix_liquidaciones_personal_periodo
  ON public.liquidaciones_personal (periodo_pago_personal_id, estado);
CREATE INDEX IF NOT EXISTS ix_liquidaciones_personal_persona
  ON public.liquidaciones_personal (persona_id, creada_en DESC);

CREATE TABLE IF NOT EXISTS public.detalles_liquidacion_personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_personal_id uuid NOT NULL REFERENCES public.liquidaciones_personal(id) ON DELETE RESTRICT,
  jornada_trabajada_id uuid NOT NULL REFERENCES public.jornadas_trabajadas(id) ON DELETE RESTRICT,
  fecha_laboral_snapshot date NOT NULL,
  sucursal_id_snapshot uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  sucursal_nombre_snapshot text NOT NULL,
  modalidad_nombre_snapshot text NOT NULL,
  funcion_nombre_snapshot text NOT NULL,
  tarifa_nombre_snapshot text NOT NULL,
  monto_snapshot numeric(12,2) NOT NULL,
  moneda_snapshot char(3) NOT NULL DEFAULT 'USD',
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (liquidacion_personal_id, jornada_trabajada_id)
);
CREATE INDEX IF NOT EXISTS ix_detalles_liquidacion_personal_liquidacion
  ON public.detalles_liquidacion_personal (liquidacion_personal_id, fecha_laboral_snapshot);
CREATE INDEX IF NOT EXISTS ix_detalles_liquidacion_personal_sucursal
  ON public.detalles_liquidacion_personal (sucursal_id_snapshot, fecha_laboral_snapshot);
CREATE INDEX IF NOT EXISTS ix_detalles_liquidacion_personal_jornada
  ON public.detalles_liquidacion_personal (jornada_trabajada_id);

CREATE TABLE IF NOT EXISTS public.pagos_personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  liquidacion_personal_id uuid NOT NULL REFERENCES public.liquidaciones_personal(id) ON DELETE RESTRICT,
  monto numeric(14,2) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'USD',
  metodo text NOT NULL,
  referencia text,
  fecha_pago date NOT NULL,
  observacion text,
  estado text NOT NULL DEFAULT 'REALIZADO',
  registrado_por uuid NOT NULL REFERENCES public.profiles(id),
  registrado_en timestamptz NOT NULL DEFAULT now(),
  anulado_por uuid REFERENCES public.profiles(id),
  anulado_en timestamptz,
  motivo_anulacion text,
  CONSTRAINT pagos_personal_monto_ck CHECK (monto >= 0),
  CONSTRAINT pagos_personal_metodo_ck CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','OTRO')),
  CONSTRAINT pagos_personal_estado_ck CHECK (estado IN ('REALIZADO','ANULADO')),
  CONSTRAINT pagos_personal_referencia_ck CHECK (
    metodo <> 'TRANSFERENCIA' OR (referencia IS NOT NULL AND btrim(referencia) <> '')
  ),
  CONSTRAINT pagos_personal_anulacion_ck CHECK (
    estado <> 'ANULADO' OR (
      anulado_por IS NOT NULL AND anulado_en IS NOT NULL
      AND motivo_anulacion IS NOT NULL AND btrim(motivo_anulacion) <> ''
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pagos_personal_realizado
  ON public.pagos_personal (liquidacion_personal_id)
  WHERE estado = 'REALIZADO';
CREATE INDEX IF NOT EXISTS ix_pagos_personal_fecha
  ON public.pagos_personal (fecha_pago DESC, estado);

INSERT INTO public.funciones_laborales (codigo, nombre, orden)
VALUES
  ('CAJA', 'Caja', 10),
  ('MESAS', 'Mesas', 20),
  ('COCINA', 'Cocina', 30),
  ('DESPACHO', 'Despacho', 40),
  ('SERVIR', 'Servir', 50),
  ('EMPAQUE', 'Empaque', 60),
  ('ADMINISTRACION', 'Administración', 70)
ON CONFLICT DO NOTHING;

INSERT INTO public.modalidades_jornada (codigo, nombre, orden)
VALUES ('NORMAL', 'Normal', 10), ('TARDE', 'Tarde', 20)
ON CONFLICT DO NOTHING;

INSERT INTO public.tipos_dia_especial_laboral (codigo, nombre, orden)
VALUES
  ('FERIADO', 'Feriado', 10),
  ('ALTA_AFLUENCIA', 'Alta afluencia', 20),
  ('EVENTO_ESPECIAL', 'Evento especial', 30)
ON CONFLICT DO NOTHING;

INSERT INTO public.configuraciones_jornada_sucursal (
  sucursal_id, modalidad_jornada_id, tipo_cupo, maximo_por_persona_dia, vigente_desde
)
SELECT
  b.id,
  m.id,
  CASE WHEN upper(COALESCE(b.branch_code, '')) = 'P1T' THEN 'COMPLEMENTARIA' ELSE 'BASE' END,
  1,
  DATE '2000-01-01'
FROM public.branches b
JOIN public.modalidades_jornada m
  ON m.codigo = CASE WHEN upper(COALESCE(b.branch_code, '')) = 'P1T' THEN 'TARDE' ELSE 'NORMAL' END
WHERE b.is_active IS TRUE
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_view_jornadas_personal(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'jornadas_personal', 'VIEW'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'pagos_personal', 'VIEW'::public.access_level);
$$;

CREATE OR REPLACE FUNCTION public.can_operate_jornadas_personal(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'jornadas_personal', 'OPERATE'::public.access_level);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pagos_personal(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_admin(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_view_pagos_personal(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_admin(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_operate_pagos_personal(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_admin(p_user_id);
$$;

ALTER TABLE public.funciones_laborales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modalidades_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_jornada_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_dia_especial_laboral ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dias_especiales_laborales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifas_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jornadas_trabajadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos_pago_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidaciones_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalles_liquidacion_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_personal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Personal autenticado ve catalogos laborales" ON public.funciones_laborales
FOR SELECT TO authenticated USING (true);
CREATE POLICY "Personal autenticado ve modalidades" ON public.modalidades_jornada
FOR SELECT TO authenticated USING (true);
CREATE POLICY "Personal ve configuraciones autorizadas" ON public.configuraciones_jornada_sucursal
FOR SELECT TO authenticated USING (public.can_view_jornadas_personal(auth.uid(), sucursal_id));
CREATE POLICY "Personal autenticado ve tipos especiales" ON public.tipos_dia_especial_laboral
FOR SELECT TO authenticated USING (true);
CREATE POLICY "Personal ve dias especiales autorizados" ON public.dias_especiales_laborales
FOR SELECT TO authenticated USING (
  sucursal_id IS NULL OR public.can_view_jornadas_personal(auth.uid(), sucursal_id)
);
CREATE POLICY "Personal ve tarifas autorizadas" ON public.tarifas_jornada
FOR SELECT TO authenticated USING (
  public.can_manage_pagos_personal(auth.uid())
  OR (sucursal_id IS NOT NULL AND public.can_view_jornadas_personal(auth.uid(), sucursal_id))
);
CREATE POLICY "Personal ve jornadas autorizadas" ON public.jornadas_trabajadas
FOR SELECT TO authenticated USING (public.can_view_jornadas_personal(auth.uid(), sucursal_id));
CREATE POLICY "Gestores ven periodos de personal" ON public.periodos_pago_personal
FOR SELECT TO authenticated USING (public.can_view_pagos_personal(auth.uid()));
CREATE POLICY "Gestores ven liquidaciones de personal" ON public.liquidaciones_personal
FOR SELECT TO authenticated USING (public.can_view_pagos_personal(auth.uid()));
CREATE POLICY "Gestores ven detalles de personal" ON public.detalles_liquidacion_personal
FOR SELECT TO authenticated USING (public.can_view_pagos_personal(auth.uid()));
CREATE POLICY "Gestores ven pagos de personal" ON public.pagos_personal
FOR SELECT TO authenticated USING (public.can_view_pagos_personal(auth.uid()));

CREATE OR REPLACE FUNCTION public.resolver_tarifa_jornada(
  p_fecha date,
  p_sucursal_id uuid,
  p_configuracion_jornada_sucursal_id uuid,
  p_funcion_laboral_id uuid
)
RETURNS TABLE (
  tarifa_jornada_id uuid,
  regla_codigo text,
  tarifa_nombre text,
  monto numeric,
  moneda text,
  prioridad integer,
  criterios jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_top record;
  v_ties integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_jornadas_personal(auth.uid(), p_sucursal_id) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar tarifas de esta sucursal';
  END IF;

  WITH candidates AS (
    SELECT
      t.*,
      (
        CASE WHEN t.dia_especial_laboral_id IS NOT NULL THEN 16 ELSE 0 END
        + CASE WHEN t.tipo_dia_especial_laboral_id IS NOT NULL THEN 8 ELSE 0 END
        + CASE WHEN t.sucursal_id IS NOT NULL THEN 4 ELSE 0 END
        + CASE WHEN t.configuracion_jornada_sucursal_id IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN t.dias_semana IS NOT NULL THEN 1 ELSE 0 END
      ) AS especificidad
    FROM public.tarifas_jornada t
    WHERE t.activa
      AND t.funcion_laboral_id = p_funcion_laboral_id
      AND p_fecha BETWEEN t.vigente_desde AND COALESCE(t.vigente_hasta, 'infinity'::date)
      AND (t.sucursal_id IS NULL OR t.sucursal_id = p_sucursal_id)
      AND (
        t.configuracion_jornada_sucursal_id IS NULL
        OR t.configuracion_jornada_sucursal_id = p_configuracion_jornada_sucursal_id
      )
      AND (t.dias_semana IS NULL OR extract(isodow FROM p_fecha)::smallint = ANY(t.dias_semana))
      AND (
        t.dia_especial_laboral_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.dias_especiales_laborales d
          WHERE d.id = t.dia_especial_laboral_id AND d.activo AND d.fecha = p_fecha
            AND (d.sucursal_id IS NULL OR d.sucursal_id = p_sucursal_id)
        )
      )
      AND (
        t.tipo_dia_especial_laboral_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.dias_especiales_laborales d
          WHERE d.tipo_dia_especial_laboral_id = t.tipo_dia_especial_laboral_id
            AND d.activo AND d.fecha = p_fecha
            AND (d.sucursal_id IS NULL OR d.sucursal_id = p_sucursal_id)
        )
      )
  )
  SELECT * INTO v_top
  FROM candidates c
  ORDER BY c.prioridad DESC, c.especificidad DESC, c.creada_en DESC
  LIMIT 1;

  IF v_top.id IS NULL THEN
    RAISE EXCEPTION 'No existe una tarifa aplicable para la combinación seleccionada';
  END IF;

  WITH candidates AS (
    SELECT t.*,
      (CASE WHEN t.dia_especial_laboral_id IS NOT NULL THEN 16 ELSE 0 END
       + CASE WHEN t.tipo_dia_especial_laboral_id IS NOT NULL THEN 8 ELSE 0 END
       + CASE WHEN t.sucursal_id IS NOT NULL THEN 4 ELSE 0 END
       + CASE WHEN t.configuracion_jornada_sucursal_id IS NOT NULL THEN 2 ELSE 0 END
       + CASE WHEN t.dias_semana IS NOT NULL THEN 1 ELSE 0 END) AS especificidad
    FROM public.tarifas_jornada t
    WHERE t.activa AND t.funcion_laboral_id = p_funcion_laboral_id
      AND p_fecha BETWEEN t.vigente_desde AND COALESCE(t.vigente_hasta, 'infinity'::date)
      AND (t.sucursal_id IS NULL OR t.sucursal_id = p_sucursal_id)
      AND (t.configuracion_jornada_sucursal_id IS NULL OR t.configuracion_jornada_sucursal_id = p_configuracion_jornada_sucursal_id)
      AND (t.dias_semana IS NULL OR extract(isodow FROM p_fecha)::smallint = ANY(t.dias_semana))
      AND (t.dia_especial_laboral_id IS NULL OR EXISTS (
        SELECT 1 FROM public.dias_especiales_laborales d WHERE d.id=t.dia_especial_laboral_id AND d.activo AND d.fecha=p_fecha AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
      ))
      AND (t.tipo_dia_especial_laboral_id IS NULL OR EXISTS (
        SELECT 1 FROM public.dias_especiales_laborales d WHERE d.tipo_dia_especial_laboral_id=t.tipo_dia_especial_laboral_id AND d.activo AND d.fecha=p_fecha AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
      ))
  )
  SELECT count(*) INTO v_ties FROM candidates c
  WHERE c.prioridad = v_top.prioridad AND c.especificidad = v_top.especificidad;

  IF v_ties > 1 THEN
    RAISE EXCEPTION 'Configuración ambigua: existen % tarifas con igual prioridad', v_ties;
  END IF;

  RETURN QUERY SELECT
    v_top.id, v_top.regla_codigo, v_top.nombre, v_top.monto,
    v_top.moneda::text, v_top.prioridad,
    jsonb_build_object(
      'sucursal_id', v_top.sucursal_id,
      'configuracion_jornada_sucursal_id', v_top.configuracion_jornada_sucursal_id,
      'dias_semana', v_top.dias_semana,
      'tipo_dia_especial_laboral_id', v_top.tipo_dia_especial_laboral_id,
      'dia_especial_laboral_id', v_top.dia_especial_laboral_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_funcion_laboral(
  p_id uuid, p_codigo text, p_nombre text, p_descripcion text, p_activo boolean, p_orden smallint
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  INSERT INTO public.funciones_laborales(id,codigo,nombre,descripcion,activo,orden,creado_por,actualizado_por)
  VALUES(v_id,upper(btrim(p_codigo)),btrim(p_nombre),nullif(btrim(p_descripcion),''),COALESCE(p_activo,true),COALESCE(p_orden,0),auth.uid(),auth.uid())
  ON CONFLICT(id) DO UPDATE SET codigo=EXCLUDED.codigo,nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion,
    activo=EXCLUDED.activo,orden=EXCLUDED.orden,actualizado_por=auth.uid(),actualizado_en=now();
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.guardar_modalidad_jornada(
  p_id uuid, p_codigo text, p_nombre text, p_descripcion text, p_activo boolean, p_orden smallint
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  INSERT INTO public.modalidades_jornada(id,codigo,nombre,descripcion,activo,orden,creado_por,actualizado_por)
  VALUES(v_id,upper(btrim(p_codigo)),btrim(p_nombre),nullif(btrim(p_descripcion),''),COALESCE(p_activo,true),COALESCE(p_orden,0),auth.uid(),auth.uid())
  ON CONFLICT(id) DO UPDATE SET codigo=EXCLUDED.codigo,nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion,
    activo=EXCLUDED.activo,orden=EXCLUDED.orden,actualizado_por=auth.uid(),actualizado_en=now();
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.guardar_configuracion_jornada_sucursal(
  p_id uuid, p_sucursal_id uuid, p_modalidad_jornada_id uuid, p_tipo_cupo text,
  p_maximo_por_persona_dia smallint, p_activo boolean, p_vigente_desde date, p_vigente_hasta date
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sucursal_id::text||':'||p_modalidad_jornada_id::text,0));
  IF EXISTS (
    SELECT 1 FROM public.configuraciones_jornada_sucursal c
    WHERE c.id<>v_id AND c.sucursal_id=p_sucursal_id AND c.modalidad_jornada_id=p_modalidad_jornada_id
      AND daterange(c.vigente_desde,COALESCE(c.vigente_hasta,'infinity'::date),'[]')
          && daterange(p_vigente_desde,COALESCE(p_vigente_hasta,'infinity'::date),'[]')
  ) THEN RAISE EXCEPTION 'La configuración se solapa con otra vigencia'; END IF;
  INSERT INTO public.configuraciones_jornada_sucursal(id,sucursal_id,modalidad_jornada_id,tipo_cupo,maximo_por_persona_dia,activo,vigente_desde,vigente_hasta,creado_por,actualizado_por)
  VALUES(v_id,p_sucursal_id,p_modalidad_jornada_id,upper(p_tipo_cupo),p_maximo_por_persona_dia,COALESCE(p_activo,true),p_vigente_desde,p_vigente_hasta,auth.uid(),auth.uid())
  ON CONFLICT(id) DO UPDATE SET modalidad_jornada_id=EXCLUDED.modalidad_jornada_id,tipo_cupo=EXCLUDED.tipo_cupo,
    maximo_por_persona_dia=EXCLUDED.maximo_por_persona_dia,activo=EXCLUDED.activo,vigente_desde=EXCLUDED.vigente_desde,
    vigente_hasta=EXCLUDED.vigente_hasta,actualizado_por=auth.uid(),actualizado_en=now();
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.guardar_tipo_dia_especial_laboral(
  p_id uuid, p_codigo text, p_nombre text, p_descripcion text, p_activo boolean
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  INSERT INTO public.tipos_dia_especial_laboral(id,codigo,nombre,descripcion,activo,creado_por,actualizado_por)
  VALUES(v_id,upper(btrim(p_codigo)),btrim(p_nombre),nullif(btrim(p_descripcion),''),COALESCE(p_activo,true),auth.uid(),auth.uid())
  ON CONFLICT(id) DO UPDATE SET codigo=EXCLUDED.codigo,nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion,
    activo=EXCLUDED.activo,actualizado_por=auth.uid(),actualizado_en=now();
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.guardar_dia_especial_laboral(
  p_id uuid, p_fecha date, p_sucursal_id uuid, p_tipo_id uuid, p_nombre text, p_descripcion text, p_activo boolean
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  INSERT INTO public.dias_especiales_laborales(id,fecha,sucursal_id,tipo_dia_especial_laboral_id,nombre,descripcion,activo,creado_por,actualizado_por)
  VALUES(v_id,p_fecha,p_sucursal_id,p_tipo_id,btrim(p_nombre),nullif(btrim(p_descripcion),''),COALESCE(p_activo,true),auth.uid(),auth.uid())
  ON CONFLICT(id) DO UPDATE SET fecha=EXCLUDED.fecha,sucursal_id=EXCLUDED.sucursal_id,
    tipo_dia_especial_laboral_id=EXCLUDED.tipo_dia_especial_laboral_id,nombre=EXCLUDED.nombre,
    descripcion=EXCLUDED.descripcion,activo=EXCLUDED.activo,actualizado_por=auth.uid(),actualizado_en=now();
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crear_version_tarifa_jornada(
  p_regla_codigo text, p_nombre text, p_descripcion text, p_funcion_laboral_id uuid,
  p_sucursal_id uuid, p_configuracion_id uuid, p_dias_semana smallint[],
  p_tipo_dia_especial_id uuid, p_dia_especial_id uuid, p_vigente_desde date,
  p_vigente_hasta date, p_monto numeric, p_prioridad integer, p_motivo text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := gen_random_uuid(); v_version integer; v_previous uuid; v_previous_start date;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(upper(btrim(p_regla_codigo)),0));
  IF p_configuracion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.configuraciones_jornada_sucursal c
    WHERE c.id=p_configuracion_id AND (p_sucursal_id IS NULL OR c.sucursal_id=p_sucursal_id)
  ) THEN RAISE EXCEPTION 'La configuración no pertenece al alcance de la tarifa'; END IF;
  IF p_dia_especial_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dias_especiales_laborales d
    WHERE d.id=p_dia_especial_id
      AND (p_sucursal_id IS NULL OR d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
  ) THEN RAISE EXCEPTION 'El día especial no pertenece al alcance de la tarifa'; END IF;
  SELECT id,version,vigente_desde INTO v_previous,v_version,v_previous_start FROM public.tarifas_jornada
  WHERE regla_codigo=upper(btrim(p_regla_codigo)) ORDER BY version DESC LIMIT 1 FOR UPDATE;
  v_version := COALESCE(v_version,0)+1;
  IF v_previous IS NOT NULL THEN
    IF p_vigente_desde<=v_previous_start THEN
      RAISE EXCEPTION 'La nueva versión debe iniciar después de la versión anterior';
    END IF;
    UPDATE public.tarifas_jornada SET vigente_hasta=p_vigente_desde-1
    WHERE id=v_previous AND (vigente_hasta IS NULL OR vigente_hasta>=p_vigente_desde);
  END IF;
  INSERT INTO public.tarifas_jornada(
    id,regla_codigo,version,nombre,descripcion,funcion_laboral_id,sucursal_id,
    configuracion_jornada_sucursal_id,dias_semana,tipo_dia_especial_laboral_id,
    dia_especial_laboral_id,vigente_desde,vigente_hasta,monto,prioridad,activa,
    version_anterior_id,motivo_cambio,creada_por
  ) VALUES (
    v_id,upper(btrim(p_regla_codigo)),v_version,btrim(p_nombre),nullif(btrim(p_descripcion),''),
    p_funcion_laboral_id,p_sucursal_id,p_configuracion_id,p_dias_semana,p_tipo_dia_especial_id,
    p_dia_especial_id,p_vigente_desde,p_vigente_hasta,p_monto,p_prioridad,true,
    v_previous,btrim(p_motivo),auth.uid()
  );
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'TARIFA_VERSION_CREADA','tarifas_jornada',v_id::text,jsonb_build_object('regla_codigo',upper(btrim(p_regla_codigo)),'version',v_version,'monto',p_monto));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_jornada_trabajada(
  p_persona_id uuid, p_fecha date, p_sucursal_id uuid, p_configuracion_id uuid,
  p_funcion_laboral_id uuid, p_cash_shift_id uuid DEFAULT NULL, p_observacion text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_config record; v_tarifa record; v_persona record; v_branch record;
  v_funcion record; v_modalidad record; v_id uuid:=gen_random_uuid(); v_codigo text;
  v_same_count integer; v_base_count integer;
BEGIN
  IF NOT public.can_operate_jornadas_personal(auth.uid(),p_sucursal_id) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_persona_id::text||':'||p_fecha::text,0));
  SELECT c.* INTO v_config FROM public.configuraciones_jornada_sucursal c
  WHERE c.id=p_configuracion_id AND c.sucursal_id=p_sucursal_id AND c.activo
    AND p_fecha BETWEEN c.vigente_desde AND COALESCE(c.vigente_hasta,'infinity'::date);
  IF v_config.id IS NULL THEN RAISE EXCEPTION 'Configuración de jornada inválida o fuera de vigencia'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_persona_id AND is_active) THEN RAISE EXCEPTION 'La persona no está activa'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.funciones_laborales WHERE id=p_funcion_laboral_id AND activo) THEN RAISE EXCEPTION 'La función laboral no está activa'; END IF;
  IF p_cash_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_shifts s
    WHERE s.id=p_cash_shift_id AND s.branch_id=p_sucursal_id
  ) THEN RAISE EXCEPTION 'El turno POS no pertenece a la sucursal de la jornada'; END IF;
  SELECT count(*) INTO v_same_count FROM public.jornadas_trabajadas
  WHERE persona_id=p_persona_id AND fecha_laboral=p_fecha AND configuracion_jornada_sucursal_id=p_configuracion_id AND estado<>'ANULADA';
  IF v_same_count>=v_config.maximo_por_persona_dia THEN RAISE EXCEPTION 'Esta jornada ya fue registrada para la persona y fecha'; END IF;
  IF v_config.tipo_cupo='BASE' THEN
    SELECT count(*) INTO v_base_count
    FROM public.jornadas_trabajadas j JOIN public.configuraciones_jornada_sucursal c ON c.id=j.configuracion_jornada_sucursal_id
    WHERE j.persona_id=p_persona_id AND j.fecha_laboral=p_fecha AND j.estado<>'ANULADA' AND c.tipo_cupo='BASE';
    IF v_base_count>0 THEN RAISE EXCEPTION 'La persona ya tiene una jornada base registrada en esta fecha'; END IF;
  END IF;
  SELECT * INTO v_tarifa FROM public.resolver_tarifa_jornada(p_fecha,p_sucursal_id,p_configuracion_id,p_funcion_laboral_id);
  SELECT id,COALESCE(NULLIF(full_name,''),username,'Usuario') nombre,identity_number INTO v_persona FROM public.profiles WHERE id=p_persona_id;
  SELECT id,name,COALESCE(display_code,branch_code) codigo INTO v_branch FROM public.branches WHERE id=p_sucursal_id;
  SELECT id,nombre INTO v_funcion FROM public.funciones_laborales WHERE id=p_funcion_laboral_id;
  SELECT m.id,m.nombre INTO v_modalidad FROM public.modalidades_jornada m WHERE m.id=v_config.modalidad_jornada_id;
  v_codigo:='JOR-'||to_char(p_fecha,'YYMMDD')||'-'||lpad(public.next_human_sequence('jornadas_personal',p_sucursal_id,to_char(p_fecha,'YYYYMMDD'))::text,4,'0');
  INSERT INTO public.jornadas_trabajadas(
    id,codigo,persona_id,fecha_laboral,sucursal_id,configuracion_jornada_sucursal_id,
    funcion_laboral_id,cash_shift_id,tarifa_jornada_id,monto_tarifa_snapshot,moneda_snapshot,
    tarifa_nombre_snapshot,criterios_tarifa_snapshot,prioridad_tarifa_snapshot,persona_nombre_snapshot,
    persona_identificacion_snapshot,sucursal_nombre_snapshot,sucursal_codigo_snapshot,
    modalidad_nombre_snapshot,funcion_nombre_snapshot,observacion,registrada_por
  ) VALUES (
    v_id,v_codigo,p_persona_id,p_fecha,p_sucursal_id,p_configuracion_id,p_funcion_laboral_id,
    p_cash_shift_id,v_tarifa.tarifa_jornada_id,v_tarifa.monto,v_tarifa.moneda,v_tarifa.tarifa_nombre,
    v_tarifa.criterios,v_tarifa.prioridad,v_persona.nombre,v_persona.identity_number,v_branch.name,
    v_branch.codigo,v_modalidad.nombre,v_funcion.nombre,nullif(btrim(p_observacion),''),auth.uid()
  );
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'JORNADA_REGISTRADA','jornadas_trabajadas',v_id::text,jsonb_build_object('persona_id',p_persona_id,'fecha',p_fecha,'monto',v_tarifa.monto));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.aprobar_jornada_trabajada(p_jornada_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid;
BEGIN
  SELECT sucursal_id INTO v_branch FROM public.jornadas_trabajadas WHERE id=p_jornada_id FOR UPDATE;
  IF NOT public.can_operate_jornadas_personal(auth.uid(),v_branch) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  UPDATE public.jornadas_trabajadas SET estado='APROBADA',aprobada_por=auth.uid(),aprobada_en=now()
  WHERE id=p_jornada_id AND estado='REGISTRADA';
  IF NOT FOUND THEN RAISE EXCEPTION 'La jornada no está disponible para aprobación'; END IF;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id) VALUES(auth.uid(),'JORNADA_APROBADA','jornadas_trabajadas',p_jornada_id::text);
END $$;

CREATE OR REPLACE FUNCTION public.anular_jornada_trabajada(p_jornada_id uuid,p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; v_state text;
BEGIN
  SELECT sucursal_id,estado INTO v_branch,v_state FROM public.jornadas_trabajadas WHERE id=p_jornada_id FOR UPDATE;
  IF NOT public.can_operate_jornadas_personal(auth.uid(),v_branch) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF v_state IS NULL THEN RAISE EXCEPTION 'Jornada no encontrada'; END IF;
  IF v_state='ANULADA' THEN RAISE EXCEPTION 'La jornada ya está anulada'; END IF;
  IF v_state='LIQUIDADA' THEN RAISE EXCEPTION 'No se puede anular una jornada liquidada'; END IF;
  IF btrim(COALESCE(p_motivo,''))='' THEN RAISE EXCEPTION 'El motivo es obligatorio'; END IF;
  UPDATE public.jornadas_trabajadas SET estado='ANULADA',anulada_por=auth.uid(),anulada_en=now(),motivo_anulacion=btrim(p_motivo)
  WHERE id=p_jornada_id AND estado<>'ANULADA';
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'JORNADA_ANULADA','jornadas_trabajadas',p_jornada_id::text,jsonb_build_object('motivo',btrim(p_motivo)));
END $$;

CREATE OR REPLACE FUNCTION public.reemplazar_jornada_trabajada(
  p_jornada_id uuid, p_motivo text, p_fecha date, p_sucursal_id uuid,
  p_configuracion_id uuid, p_funcion_laboral_id uuid, p_observacion text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_persona uuid; v_state text; v_new_id uuid;
BEGIN
  SELECT persona_id,estado INTO v_persona,v_state FROM public.jornadas_trabajadas WHERE id=p_jornada_id FOR UPDATE;
  IF v_persona IS NULL THEN RAISE EXCEPTION 'Jornada no encontrada'; END IF;
  IF v_state NOT IN ('REGISTRADA','APROBADA') THEN RAISE EXCEPTION 'La jornada no se puede reemplazar en su estado actual'; END IF;
  PERFORM public.anular_jornada_trabajada(p_jornada_id,p_motivo);
  v_new_id:=public.registrar_jornada_trabajada(v_persona,p_fecha,p_sucursal_id,p_configuracion_id,p_funcion_laboral_id,NULL,p_observacion);
  UPDATE public.jornadas_trabajadas SET reemplaza_jornada_id=p_jornada_id WHERE id=v_new_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'JORNADA_REEMPLAZADA','jornadas_trabajadas',v_new_id::text,jsonb_build_object('reemplaza',p_jornada_id));
  RETURN v_new_id;
END $$;

CREATE OR REPLACE FUNCTION public.crear_periodo_pago_personal(p_fecha_inicio date,p_fecha_fin date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_codigo text;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF p_fecha_fin<p_fecha_inicio THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('periodos_pago_personal',0));
  IF EXISTS(SELECT 1 FROM public.periodos_pago_personal WHERE estado<>'ANULADO' AND daterange(fecha_inicio,fecha_fin,'[]')&&daterange(p_fecha_inicio,p_fecha_fin,'[]'))
  THEN RAISE EXCEPTION 'El período se solapa con otro período activo'; END IF;
  v_codigo:='PER-'||to_char(p_fecha_inicio,'YYMMDD')||'-'||lpad(public.next_human_sequence('periodos_pago_personal',NULL,to_char(p_fecha_inicio,'YYYY'))::text,4,'0');
  INSERT INTO public.periodos_pago_personal(id,codigo,fecha_inicio,fecha_fin,creado_por) VALUES(v_id,v_codigo,p_fecha_inicio,p_fecha_fin,auth.uid());
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.calcular_periodo_pago_personal(p_periodo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period record; v_person record; v_liq uuid; v_total numeric;
  v_count integer; v_seq bigint; v_jornada_ids uuid[];
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('calcular_periodos_pago_personal',0));
  SELECT * INTO v_period FROM public.periodos_pago_personal WHERE id=p_periodo_id FOR UPDATE;
  IF v_period.estado<>'ABIERTO' THEN RAISE EXCEPTION 'El período no está abierto'; END IF;
  SELECT array_agg(eligible.id ORDER BY eligible.id) INTO v_jornada_ids
  FROM (
    SELECT j.id
    FROM public.jornadas_trabajadas j
    WHERE j.estado='APROBADA' AND j.fecha_laboral BETWEEN v_period.fecha_inicio AND v_period.fecha_fin
      AND NOT EXISTS (
        SELECT 1 FROM public.detalles_liquidacion_personal d
        JOIN public.liquidaciones_personal l ON l.id=d.liquidacion_personal_id
        JOIN public.periodos_pago_personal p ON p.id=l.periodo_pago_personal_id
        WHERE d.jornada_trabajada_id=j.id AND p.estado<>'ANULADO'
      )
    ORDER BY j.id
    FOR UPDATE OF j
  ) eligible;
  IF COALESCE(cardinality(v_jornada_ids),0)=0 THEN
    RAISE EXCEPTION 'No hay jornadas aprobadas en el período';
  END IF;
  FOR v_person IN
    SELECT persona_id,min(persona_nombre_snapshot) persona_nombre,min(persona_identificacion_snapshot) identificacion,
      count(*) cantidad,sum(monto_tarifa_snapshot) total
    FROM public.jornadas_trabajadas
    WHERE id=ANY(v_jornada_ids)
    GROUP BY persona_id
  LOOP
    v_liq:=gen_random_uuid(); v_seq:=public.next_human_sequence('liquidaciones_personal',NULL,to_char(v_period.fecha_inicio,'YYYYMMDD'));
    INSERT INTO public.liquidaciones_personal(id,codigo,periodo_pago_personal_id,persona_id,persona_nombre_snapshot,persona_identificacion_snapshot,cantidad_jornadas_snapshot,total_snapshot,creada_por)
    VALUES(v_liq,'LIQ-'||to_char(v_period.fecha_inicio,'YYMMDD')||'-'||lpad(v_seq::text,5,'0'),p_periodo_id,v_person.persona_id,v_person.persona_nombre,v_person.identificacion,v_person.cantidad,v_person.total,auth.uid());
    INSERT INTO public.detalles_liquidacion_personal(
      liquidacion_personal_id,jornada_trabajada_id,fecha_laboral_snapshot,sucursal_id_snapshot,sucursal_nombre_snapshot,
      modalidad_nombre_snapshot,funcion_nombre_snapshot,tarifa_nombre_snapshot,monto_snapshot,moneda_snapshot
    )
    SELECT v_liq,id,fecha_laboral,sucursal_id,sucursal_nombre_snapshot,modalidad_nombre_snapshot,funcion_nombre_snapshot,tarifa_nombre_snapshot,monto_tarifa_snapshot,moneda_snapshot
    FROM public.jornadas_trabajadas
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids);
    UPDATE public.jornadas_trabajadas SET estado='LIQUIDADA'
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids) AND estado='APROBADA';
  END LOOP;
  SELECT count(*),COALESCE(sum(cantidad_jornadas_snapshot),0),COALESCE(sum(total_snapshot),0)
  INTO v_count,v_seq,v_total FROM public.liquidaciones_personal WHERE periodo_pago_personal_id=p_periodo_id;
  UPDATE public.periodos_pago_personal SET estado='CALCULADO',total_personas_snapshot=v_count,total_jornadas_snapshot=v_seq,
    total_general_snapshot=v_total,calculado_por=auth.uid(),calculado_en=now() WHERE id=p_periodo_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'PERIODO_CALCULADO','periodos_pago_personal',p_periodo_id::text,jsonb_build_object('total',v_total,'personas',v_count));
END $$;

CREATE OR REPLACE FUNCTION public.anular_periodo_pago_personal(p_periodo_id uuid,p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period record;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF btrim(COALESCE(p_motivo,''))='' THEN RAISE EXCEPTION 'El motivo es obligatorio'; END IF;
  SELECT * INTO v_period FROM public.periodos_pago_personal WHERE id=p_periodo_id FOR UPDATE;
  IF v_period.id IS NULL OR v_period.estado='ANULADO' THEN RAISE EXCEPTION 'Período no disponible'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.pagos_personal pg
    JOIN public.liquidaciones_personal l ON l.id=pg.liquidacion_personal_id
    WHERE l.periodo_pago_personal_id=p_periodo_id AND pg.estado='REALIZADO'
  ) THEN RAISE EXCEPTION 'Anule primero los pagos realizados del período'; END IF;
  UPDATE public.jornadas_trabajadas j SET estado='APROBADA'
  WHERE j.id IN (
    SELECT d.jornada_trabajada_id FROM public.detalles_liquidacion_personal d
    JOIN public.liquidaciones_personal l ON l.id=d.liquidacion_personal_id
    WHERE l.periodo_pago_personal_id=p_periodo_id
  ) AND j.estado='LIQUIDADA'
    AND NOT EXISTS (
      SELECT 1 FROM public.detalles_liquidacion_personal other_d
      JOIN public.liquidaciones_personal other_l ON other_l.id=other_d.liquidacion_personal_id
      JOIN public.periodos_pago_personal other_p ON other_p.id=other_l.periodo_pago_personal_id
      WHERE other_d.jornada_trabajada_id=j.id AND other_p.id<>p_periodo_id AND other_p.estado<>'ANULADO'
    );
  UPDATE public.liquidaciones_personal SET estado='ANULADA',actualizada_en=now()
  WHERE periodo_pago_personal_id=p_periodo_id AND estado<>'ANULADA';
  UPDATE public.periodos_pago_personal SET estado='ANULADO',anulado_por=auth.uid(),anulado_en=now(),
    motivo_anulacion=btrim(p_motivo) WHERE id=p_periodo_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'PERIODO_PERSONAL_ANULADO','periodos_pago_personal',p_periodo_id::text,jsonb_build_object('motivo',btrim(p_motivo)));
END $$;

CREATE OR REPLACE FUNCTION public.obtener_resumen_periodo_pago_personal(p_periodo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  SELECT jsonb_build_object(
    'periodo',to_jsonb(p),
    'total_pendiente',COALESCE(sum(l.total_snapshot) FILTER(WHERE l.estado='PENDIENTE'),0),
    'total_pagado',COALESCE(sum(l.total_snapshot) FILTER(WHERE l.estado='PAGADA'),0),
    'liquidaciones',count(l.id)
  ) INTO v_result
  FROM public.periodos_pago_personal p
  LEFT JOIN public.liquidaciones_personal l ON l.periodo_pago_personal_id=p.id AND l.estado<>'ANULADA'
  WHERE p.id=p_periodo_id
  GROUP BY p.id;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_pago_personal(
  p_liquidacion_id uuid,p_metodo text,p_referencia text,p_fecha_pago date,p_observacion text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_liq record; v_period record; v_period_id uuid; v_id uuid:=gen_random_uuid(); v_codigo text; v_pending integer;
BEGIN
  IF NOT public.can_operate_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  SELECT periodo_pago_personal_id INTO v_period_id FROM public.liquidaciones_personal WHERE id=p_liquidacion_id;
  IF v_period_id IS NULL THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  SELECT * INTO v_period FROM public.periodos_pago_personal WHERE id=v_period_id FOR UPDATE;
  SELECT * INTO v_liq FROM public.liquidaciones_personal WHERE id=p_liquidacion_id FOR UPDATE;
  IF v_liq.estado<>'PENDIENTE' OR v_period.estado NOT IN('CALCULADO','EN_PAGO') THEN RAISE EXCEPTION 'Liquidación no disponible para pago'; END IF;
  IF upper(p_metodo)='TRANSFERENCIA' AND btrim(COALESCE(p_referencia,''))='' THEN RAISE EXCEPTION 'La referencia es obligatoria'; END IF;
  v_codigo:='NOM-'||to_char(p_fecha_pago,'YYMMDD')||'-'||lpad(public.next_human_sequence('pagos_personal',NULL,to_char(p_fecha_pago,'YYYYMMDD'))::text,5,'0');
  INSERT INTO public.pagos_personal(id,codigo,liquidacion_personal_id,monto,moneda,metodo,referencia,fecha_pago,observacion,registrado_por)
  VALUES(v_id,v_codigo,p_liquidacion_id,v_liq.total_snapshot,v_liq.moneda_snapshot,upper(p_metodo),nullif(btrim(p_referencia),''),p_fecha_pago,nullif(btrim(p_observacion),''),auth.uid());
  UPDATE public.liquidaciones_personal SET estado='PAGADA',actualizada_en=now() WHERE id=p_liquidacion_id;
  SELECT count(*) INTO v_pending FROM public.liquidaciones_personal WHERE periodo_pago_personal_id=v_liq.periodo_pago_personal_id AND estado='PENDIENTE';
  UPDATE public.periodos_pago_personal SET estado=CASE WHEN v_pending=0 THEN 'PAGADO' ELSE 'EN_PAGO' END,
    pagado_en=CASE WHEN v_pending=0 THEN now() ELSE NULL END WHERE id=v_liq.periodo_pago_personal_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'PAGO_PERSONAL_REGISTRADO','pagos_personal',v_id::text,jsonb_build_object('liquidacion_id',p_liquidacion_id,'monto',v_liq.total_snapshot));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.anular_pago_personal(p_pago_id uuid,p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pago record; v_period_id uuid; v_paid integer;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF btrim(COALESCE(p_motivo,''))='' THEN RAISE EXCEPTION 'El motivo es obligatorio'; END IF;
  SELECT l.periodo_pago_personal_id INTO v_period_id FROM public.pagos_personal pg
  JOIN public.liquidaciones_personal l ON l.id=pg.liquidacion_personal_id WHERE pg.id=p_pago_id;
  IF v_period_id IS NULL THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;
  PERFORM 1 FROM public.periodos_pago_personal WHERE id=v_period_id FOR UPDATE;
  PERFORM l.id FROM public.liquidaciones_personal l
  JOIN public.pagos_personal pg ON pg.liquidacion_personal_id=l.id
  WHERE pg.id=p_pago_id FOR UPDATE OF l;
  SELECT * INTO v_pago FROM public.pagos_personal WHERE id=p_pago_id FOR UPDATE;
  IF v_pago.id IS NULL THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;
  IF v_pago.estado<>'REALIZADO' THEN RAISE EXCEPTION 'El pago ya está anulado'; END IF;
  UPDATE public.pagos_personal SET estado='ANULADO',anulado_por=auth.uid(),anulado_en=now(),motivo_anulacion=btrim(p_motivo) WHERE id=p_pago_id;
  UPDATE public.liquidaciones_personal SET estado='PENDIENTE',actualizada_en=now() WHERE id=v_pago.liquidacion_personal_id;
  SELECT count(*) INTO v_paid FROM public.liquidaciones_personal WHERE periodo_pago_personal_id=v_period_id AND estado='PAGADA';
  UPDATE public.periodos_pago_personal SET estado=CASE WHEN v_paid>0 THEN 'EN_PAGO' ELSE 'CALCULADO' END,pagado_en=NULL WHERE id=v_period_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,after_data)
  VALUES(auth.uid(),'PAGO_PERSONAL_ANULADO','pagos_personal',p_pago_id::text,jsonb_build_object('motivo',btrim(p_motivo)));
END $$;

GRANT SELECT ON public.funciones_laborales,public.modalidades_jornada,public.configuraciones_jornada_sucursal,
  public.tipos_dia_especial_laboral,public.dias_especiales_laborales,public.tarifas_jornada,
  public.jornadas_trabajadas,public.periodos_pago_personal,public.liquidaciones_personal,
  public.detalles_liquidacion_personal,public.pagos_personal TO authenticated;

REVOKE INSERT,UPDATE,DELETE ON public.funciones_laborales,public.modalidades_jornada,
  public.configuraciones_jornada_sucursal,public.tipos_dia_especial_laboral,
  public.dias_especiales_laborales,public.tarifas_jornada,public.jornadas_trabajadas,
  public.periodos_pago_personal,public.liquidaciones_personal,public.detalles_liquidacion_personal,
  public.pagos_personal FROM authenticated;

REVOKE ALL ON FUNCTION public.can_view_jornadas_personal(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_operate_jornadas_personal(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_pagos_personal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_pagos_personal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_operate_pagos_personal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_tarifa_jornada(date,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_funcion_laboral(uuid,text,text,text,boolean,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_modalidad_jornada(uuid,text,text,text,boolean,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_configuracion_jornada_sucursal(uuid,uuid,uuid,text,smallint,boolean,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_tipo_dia_especial_laboral(uuid,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_dia_especial_laboral(uuid,date,uuid,uuid,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_jornada_trabajada(uuid,date,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aprobar_jornada_trabajada(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anular_jornada_trabajada(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reemplazar_jornada_trabajada(uuid,text,date,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_periodo_pago_personal(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calcular_periodo_pago_personal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anular_periodo_pago_personal(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obtener_resumen_periodo_pago_personal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_pago_personal(uuid,text,text,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anular_pago_personal(uuid,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_view_jornadas_personal(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_operate_jornadas_personal(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_pagos_personal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_pagos_personal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_operate_pagos_personal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_tarifa_jornada(date,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_funcion_laboral(uuid,text,text,text,boolean,smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_modalidad_jornada(uuid,text,text,text,boolean,smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_configuracion_jornada_sucursal(uuid,uuid,uuid,text,smallint,boolean,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_tipo_dia_especial_laboral(uuid,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_dia_especial_laboral(uuid,date,uuid,uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_jornada_trabajada(uuid,date,uuid,uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_jornada_trabajada(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_jornada_trabajada(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reemplazar_jornada_trabajada(uuid,text,date,uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_periodo_pago_personal(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_periodo_pago_personal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_periodo_pago_personal(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_resumen_periodo_pago_personal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_personal(uuid,text,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_pago_personal(uuid,text) TO authenticated;

COMMENT ON TABLE public.jornadas_trabajadas IS 'Jornadas laborales pagables; no representa marcación de asistencia.';
COMMENT ON TABLE public.tarifas_jornada IS 'Versiones append-only de reglas de tarifa por jornada.';
COMMENT ON TABLE public.pagos_personal IS 'Pago único de una liquidación de personal; separado de cobros POS.';

-- ---------------------------------------------------------------------------
-- Modelo definitivo: la jornada se deriva exclusivamente del usuario del turno.
-- Esta sección reemplaza el alta manual y la modalidad laboral paralela al POS.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reemplazar_jornada_trabajada(uuid,text,date,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.registrar_jornada_trabajada(uuid,date,uuid,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.aprobar_jornada_trabajada(uuid);
DROP FUNCTION IF EXISTS public.resolver_tarifa_jornada(date,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text);
DROP FUNCTION IF EXISTS public.guardar_configuracion_jornada_sucursal(uuid,uuid,uuid,text,smallint,boolean,date,date);
DROP FUNCTION IF EXISTS public.guardar_modalidad_jornada(uuid,text,text,text,boolean,smallint);

ALTER TABLE public.funciones_laborales
  ADD COLUMN shift_role_key text;
ALTER TABLE public.funciones_laborales
  ADD CONSTRAINT funciones_laborales_shift_role_ck CHECK (
    shift_role_key IS NULL OR shift_role_key IN ('VENTA','DESPACHO','SERVIR','EMPAQUE','CAJA','SUPERVISOR')
  );
CREATE UNIQUE INDEX ux_funciones_laborales_shift_role
  ON public.funciones_laborales (shift_role_key)
  WHERE shift_role_key IS NOT NULL;

UPDATE public.funciones_laborales SET shift_role_key='CAJA' WHERE codigo='CAJA';
UPDATE public.funciones_laborales SET shift_role_key='VENTA', nombre='Venta / Mesas' WHERE codigo='MESAS';
UPDATE public.funciones_laborales SET shift_role_key='DESPACHO' WHERE codigo='DESPACHO';
UPDATE public.funciones_laborales SET shift_role_key='SERVIR' WHERE codigo='SERVIR';
UPDATE public.funciones_laborales SET shift_role_key='EMPAQUE' WHERE codigo='EMPAQUE';
UPDATE public.funciones_laborales SET shift_role_key='SUPERVISOR' WHERE codigo='ADMINISTRACION';

DROP INDEX IF EXISTS public.ix_tarifas_jornada_sucursal;
ALTER TABLE public.tarifas_jornada
  DROP COLUMN configuracion_jornada_sucursal_id;
CREATE INDEX ix_tarifas_jornada_sucursal
  ON public.tarifas_jornada (sucursal_id, funcion_laboral_id);

DROP INDEX IF EXISTS public.ix_jornadas_trabajadas_configuracion_activa;
DROP INDEX IF EXISTS public.ux_jornadas_reemplazo_activo;
ALTER TABLE public.jornadas_trabajadas
  DROP CONSTRAINT jornadas_trabajadas_estado_ck,
  DROP CONSTRAINT jornadas_trabajadas_cash_shift_id_fkey,
  DROP COLUMN configuracion_jornada_sucursal_id,
  DROP COLUMN modalidad_nombre_snapshot,
  DROP COLUMN reemplaza_jornada_id,
  ADD COLUMN cash_shift_user_id uuid REFERENCES public.cash_shift_users(id) ON DELETE RESTRICT,
  ADD COLUMN roles_snapshot text[] NOT NULL DEFAULT ARRAY[]::text[],
  ALTER COLUMN cash_shift_id SET NOT NULL,
  ALTER COLUMN cash_shift_id DROP DEFAULT,
  ALTER COLUMN funcion_laboral_id DROP NOT NULL,
  ALTER COLUMN tarifa_jornada_id DROP NOT NULL,
  ALTER COLUMN monto_tarifa_snapshot DROP NOT NULL,
  ALTER COLUMN registrada_por DROP NOT NULL;
ALTER TABLE public.jornadas_trabajadas
  ADD CONSTRAINT jornadas_trabajadas_cash_shift_id_fkey
  FOREIGN KEY (cash_shift_id) REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT jornadas_trabajadas_estado_ck
  CHECK (estado IN ('SIN_TARIFA','APROBADA','LIQUIDADA','ANULADA'));
CREATE UNIQUE INDEX ux_jornadas_cash_shift_user
  ON public.jornadas_trabajadas (cash_shift_user_id)
  WHERE cash_shift_user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_jornadas_persona_turno
  ON public.jornadas_trabajadas (cash_shift_id, persona_id);

ALTER TABLE public.detalles_liquidacion_personal
  DROP COLUMN modalidad_nombre_snapshot,
  ADD COLUMN roles_snapshot text[] NOT NULL DEFAULT ARRAY[]::text[];

DROP TABLE public.configuraciones_jornada_sucursal;
DROP TABLE public.modalidades_jornada;

CREATE OR REPLACE FUNCTION public.roles_laborales_turno(p_row public.cash_shift_users)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN COALESCE(p_row.can_serve_tables,false) THEN 'VENTA' END,
    CASE WHEN COALESCE(p_row.can_dispatch_orders,false) THEN 'DESPACHO' END,
    CASE WHEN COALESCE(p_row.can_serve_plates,false) THEN 'SERVIR' END,
    CASE WHEN COALESCE(p_row.can_pack_orders,false) THEN 'EMPAQUE' END,
    CASE WHEN COALESCE(p_row.can_use_caja,false) THEN 'CAJA' END,
    CASE WHEN COALESCE(p_row.is_supervisor,false) THEN 'SUPERVISOR' END
  ], NULL);
$$;

CREATE OR REPLACE FUNCTION public.resolver_tarifa_roles_jornada(
  p_fecha date,
  p_sucursal_id uuid,
  p_roles text[]
)
RETURNS TABLE (
  tarifa_jornada_id uuid,
  funcion_laboral_id uuid,
  funcion_nombre text,
  tarifa_nombre text,
  monto numeric,
  moneda text,
  prioridad integer,
  criterios jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      t.*,
      f.nombre AS funcion_nombre,
      f.shift_role_key AS role_key,
      (
        CASE WHEN t.dia_especial_laboral_id IS NOT NULL THEN 8 ELSE 0 END
        + CASE WHEN t.tipo_dia_especial_laboral_id IS NOT NULL THEN 4 ELSE 0 END
        + CASE WHEN t.sucursal_id IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN t.dias_semana IS NOT NULL THEN 1 ELSE 0 END
      ) AS especificidad
    FROM public.tarifas_jornada t
    JOIN public.funciones_laborales f ON f.id=t.funcion_laboral_id
    WHERE t.activa
      AND f.activo
      AND f.shift_role_key=ANY(COALESCE(p_roles,ARRAY[]::text[]))
      AND p_fecha BETWEEN t.vigente_desde AND COALESCE(t.vigente_hasta,'infinity'::date)
      AND (t.sucursal_id IS NULL OR t.sucursal_id=p_sucursal_id)
      AND (t.dias_semana IS NULL OR extract(isodow FROM p_fecha)::smallint=ANY(t.dias_semana))
      AND (
        t.dia_especial_laboral_id IS NULL OR EXISTS (
          SELECT 1 FROM public.dias_especiales_laborales d
          WHERE d.id=t.dia_especial_laboral_id AND d.activo AND d.fecha=p_fecha
            AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
        )
      )
      AND (
        t.tipo_dia_especial_laboral_id IS NULL OR EXISTS (
          SELECT 1 FROM public.dias_especiales_laborales d
          WHERE d.tipo_dia_especial_laboral_id=t.tipo_dia_especial_laboral_id
            AND d.activo AND d.fecha=p_fecha
            AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
        )
      )
  ),
  role_winners AS (
    SELECT DISTINCT ON (c.role_key) c.*
    FROM candidates c
    ORDER BY c.role_key, c.prioridad DESC, c.especificidad DESC, c.creada_en DESC
  )
  SELECT
    c.id,
    c.funcion_laboral_id,
    c.funcion_nombre,
    c.nombre,
    c.monto,
    c.moneda::text,
    c.prioridad,
    jsonb_build_object(
      'roles_turno',p_roles,
      'sucursal_id',c.sucursal_id,
      'dias_semana',c.dias_semana,
      'tipo_dia_especial_laboral_id',c.tipo_dia_especial_laboral_id,
      'dia_especial_laboral_id',c.dia_especial_laboral_id
    )
  FROM role_winners c
  ORDER BY c.monto DESC, c.prioridad DESC, c.especificidad DESC, c.creada_en DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_jornada_usuario_turno(p_cash_shift_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_csu public.cash_shift_users%ROWTYPE;
  v_shift record;
  v_persona record;
  v_branch record;
  v_tarifa record;
  v_roles text[];
  v_existing record;
  v_id uuid;
  v_fecha date;
BEGIN
  SELECT * INTO v_csu FROM public.cash_shift_users WHERE id=p_cash_shift_user_id;
  SELECT * INTO v_existing FROM public.jornadas_trabajadas WHERE cash_shift_user_id=p_cash_shift_user_id FOR UPDATE;

  IF v_csu.id IS NULL OR NOT COALESCE(v_csu.is_enabled,false) THEN
    IF v_existing.id IS NOT NULL AND v_existing.estado='LIQUIDADA' THEN
      RAISE EXCEPTION 'No se puede quitar del turno una jornada ya liquidada';
    END IF;
    DELETE FROM public.jornadas_trabajadas
    WHERE cash_shift_user_id=p_cash_shift_user_id AND estado<>'LIQUIDADA';
    RETURN NULL;
  END IF;

  IF v_existing.estado='LIQUIDADA' THEN
    RAISE EXCEPTION 'No se pueden cambiar funciones de una jornada ya liquidada';
  END IF;

  SELECT id,branch_id,cashier_id,opened_at,status
  INTO v_shift
  FROM public.cash_shifts WHERE id=v_csu.shift_id;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Turno no encontrado'; END IF;

  SELECT id,COALESCE(NULLIF(full_name,''),NULLIF(alias,''),username,'Usuario') nombre,identity_number
  INTO v_persona FROM public.profiles WHERE id=v_csu.user_id;
  SELECT id,name,COALESCE(display_code,branch_code) codigo
  INTO v_branch FROM public.branches WHERE id=v_shift.branch_id;

  v_fecha := (v_shift.opened_at AT TIME ZONE 'America/Guayaquil')::date;
  v_roles := public.roles_laborales_turno(v_csu);
  SELECT * INTO v_tarifa
  FROM public.resolver_tarifa_roles_jornada(v_fecha,v_shift.branch_id,v_roles);
  v_id := COALESCE(v_existing.id,gen_random_uuid());

  INSERT INTO public.jornadas_trabajadas(
    id,codigo,persona_id,fecha_laboral,sucursal_id,cash_shift_id,cash_shift_user_id,
    funcion_laboral_id,tarifa_jornada_id,monto_tarifa_snapshot,moneda_snapshot,
    tarifa_nombre_snapshot,criterios_tarifa_snapshot,prioridad_tarifa_snapshot,
    tarifa_resuelta_en,persona_nombre_snapshot,persona_identificacion_snapshot,
    sucursal_nombre_snapshot,sucursal_codigo_snapshot,funcion_nombre_snapshot,
    roles_snapshot,estado,registrada_por
  ) VALUES (
    v_id,'JOR-'||replace(p_cash_shift_user_id::text,'-',''),v_csu.user_id,v_fecha,v_shift.branch_id,
    v_shift.id,v_csu.id,v_tarifa.funcion_laboral_id,v_tarifa.tarifa_jornada_id,v_tarifa.monto,
    COALESCE(v_tarifa.moneda,'USD'),COALESCE(v_tarifa.tarifa_nombre,'Sin tarifa configurada'),
    COALESCE(v_tarifa.criterios,jsonb_build_object('roles_turno',v_roles)),
    COALESCE(v_tarifa.prioridad,0),now(),v_persona.nombre,v_persona.identity_number,
    v_branch.name,v_branch.codigo,COALESCE(v_tarifa.funcion_nombre,'Sin función tarifada'),
    v_roles,CASE WHEN v_tarifa.tarifa_jornada_id IS NULL THEN 'SIN_TARIFA' ELSE 'APROBADA' END,
    v_shift.cashier_id
  )
  ON CONFLICT(cash_shift_user_id) WHERE cash_shift_user_id IS NOT NULL DO UPDATE SET
    persona_id=EXCLUDED.persona_id,
    fecha_laboral=EXCLUDED.fecha_laboral,
    sucursal_id=EXCLUDED.sucursal_id,
    cash_shift_id=EXCLUDED.cash_shift_id,
    funcion_laboral_id=EXCLUDED.funcion_laboral_id,
    tarifa_jornada_id=EXCLUDED.tarifa_jornada_id,
    monto_tarifa_snapshot=EXCLUDED.monto_tarifa_snapshot,
    moneda_snapshot=EXCLUDED.moneda_snapshot,
    tarifa_nombre_snapshot=EXCLUDED.tarifa_nombre_snapshot,
    criterios_tarifa_snapshot=EXCLUDED.criterios_tarifa_snapshot,
    prioridad_tarifa_snapshot=EXCLUDED.prioridad_tarifa_snapshot,
    tarifa_resuelta_en=now(),
    persona_nombre_snapshot=EXCLUDED.persona_nombre_snapshot,
    persona_identificacion_snapshot=EXCLUDED.persona_identificacion_snapshot,
    sucursal_nombre_snapshot=EXCLUDED.sucursal_nombre_snapshot,
    sucursal_codigo_snapshot=EXCLUDED.sucursal_codigo_snapshot,
    funcion_nombre_snapshot=EXCLUDED.funcion_nombre_snapshot,
    roles_snapshot=EXCLUDED.roles_snapshot,
    estado=EXCLUDED.estado;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_jornada_usuario_turno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.jornadas_trabajadas
      WHERE cash_shift_user_id=OLD.id AND estado='LIQUIDADA'
    ) THEN
      RAISE EXCEPTION 'No se puede quitar del turno una jornada ya liquidada';
    END IF;
    DELETE FROM public.jornadas_trabajadas
    WHERE cash_shift_user_id=OLD.id AND estado<>'LIQUIDADA';
    RETURN OLD;
  END IF;
  PERFORM public.sincronizar_jornada_usuario_turno(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_shift_users_jornada_insert_update
AFTER INSERT OR UPDATE OF is_enabled,can_serve_tables,can_dispatch_orders,can_serve_plates,can_pack_orders,can_use_caja,is_supervisor
ON public.cash_shift_users
FOR EACH ROW EXECUTE FUNCTION public.trg_sincronizar_jornada_usuario_turno();

CREATE TRIGGER trg_cash_shift_users_jornada_delete
BEFORE DELETE ON public.cash_shift_users
FOR EACH ROW EXECUTE FUNCTION public.trg_sincronizar_jornada_usuario_turno();

CREATE OR REPLACE FUNCTION public.crear_version_tarifa_jornada(
  p_regla_codigo text, p_nombre text, p_descripcion text, p_funcion_laboral_id uuid,
  p_sucursal_id uuid, p_dias_semana smallint[], p_tipo_dia_especial_id uuid,
  p_dia_especial_id uuid, p_vigente_desde date, p_vigente_hasta date,
  p_monto numeric, p_prioridad integer, p_motivo text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_version integer; v_previous uuid; v_previous_start date; v_row record;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF p_monto<0 THEN RAISE EXCEPTION 'El monto no puede ser negativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(upper(btrim(p_regla_codigo)),0));
  SELECT id,version,vigente_desde INTO v_previous,v_version,v_previous_start
  FROM public.tarifas_jornada
  WHERE regla_codigo=upper(btrim(p_regla_codigo))
  ORDER BY version DESC LIMIT 1 FOR UPDATE;
  v_version:=COALESCE(v_version,0)+1;
  IF v_previous IS NOT NULL THEN
    IF p_vigente_desde<=v_previous_start THEN RAISE EXCEPTION 'La nueva versión debe iniciar después de la anterior'; END IF;
    UPDATE public.tarifas_jornada SET vigente_hasta=p_vigente_desde-1
    WHERE id=v_previous AND (vigente_hasta IS NULL OR vigente_hasta>=p_vigente_desde);
  END IF;
  INSERT INTO public.tarifas_jornada(
    id,regla_codigo,version,nombre,descripcion,funcion_laboral_id,sucursal_id,dias_semana,
    tipo_dia_especial_laboral_id,dia_especial_laboral_id,vigente_desde,vigente_hasta,
    monto,prioridad,activa,version_anterior_id,motivo_cambio,creada_por
  ) VALUES (
    v_id,upper(btrim(p_regla_codigo)),v_version,btrim(p_nombre),nullif(btrim(p_descripcion),''),
    p_funcion_laboral_id,p_sucursal_id,p_dias_semana,p_tipo_dia_especial_id,p_dia_especial_id,
    p_vigente_desde,p_vigente_hasta,p_monto,COALESCE(p_prioridad,100),true,v_previous,btrim(p_motivo),auth.uid()
  );
  FOR v_row IN
    SELECT csu.id
    FROM public.cash_shift_users csu
    LEFT JOIN public.jornadas_trabajadas j ON j.cash_shift_user_id=csu.id
    WHERE csu.is_enabled AND COALESCE(j.estado,'')<>'LIQUIDADA'
  LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_jornadas_desde_turnos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row record; v_count integer:=0;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  FOR v_row IN SELECT id FROM public.cash_shift_users WHERE is_enabled LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_periodo_pago_personal(p_periodo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period record; v_person record; v_liq uuid; v_total numeric;
  v_count integer; v_seq bigint; v_jornada_ids uuid[];
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('calcular_periodos_pago_personal',0));
  SELECT * INTO v_period FROM public.periodos_pago_personal WHERE id=p_periodo_id FOR UPDATE;
  IF v_period.estado<>'ABIERTO' THEN RAISE EXCEPTION 'El período no está abierto'; END IF;
  SELECT array_agg(eligible.id ORDER BY eligible.id) INTO v_jornada_ids
  FROM (
    SELECT j.id
    FROM public.jornadas_trabajadas j
    JOIN public.cash_shifts cs ON cs.id=j.cash_shift_id AND cs.status='CLOSED'
    WHERE j.estado='APROBADA'
      AND j.tarifa_jornada_id IS NOT NULL
      AND j.fecha_laboral BETWEEN v_period.fecha_inicio AND v_period.fecha_fin
      AND NOT EXISTS (
        SELECT 1 FROM public.detalles_liquidacion_personal d
        JOIN public.liquidaciones_personal l ON l.id=d.liquidacion_personal_id
        JOIN public.periodos_pago_personal p ON p.id=l.periodo_pago_personal_id
        WHERE d.jornada_trabajada_id=j.id AND p.estado<>'ANULADO'
      )
    ORDER BY j.id FOR UPDATE OF j
  ) eligible;
  IF COALESCE(cardinality(v_jornada_ids),0)=0 THEN
    RAISE EXCEPTION 'No hay jornadas con tarifa de turnos cerrados en el período';
  END IF;
  FOR v_person IN
    SELECT persona_id,min(persona_nombre_snapshot) persona_nombre,min(persona_identificacion_snapshot) identificacion,
      count(*) cantidad,sum(monto_tarifa_snapshot) total
    FROM public.jornadas_trabajadas WHERE id=ANY(v_jornada_ids) GROUP BY persona_id
  LOOP
    v_liq:=gen_random_uuid();
    v_seq:=public.next_human_sequence('liquidaciones_personal',NULL,to_char(v_period.fecha_inicio,'YYYYMMDD'));
    INSERT INTO public.liquidaciones_personal(
      id,codigo,periodo_pago_personal_id,persona_id,persona_nombre_snapshot,
      persona_identificacion_snapshot,cantidad_jornadas_snapshot,total_snapshot,creada_por
    ) VALUES (
      v_liq,'LIQ-'||to_char(v_period.fecha_inicio,'YYMMDD')||'-'||lpad(v_seq::text,5,'0'),
      p_periodo_id,v_person.persona_id,v_person.persona_nombre,v_person.identificacion,
      v_person.cantidad,v_person.total,auth.uid()
    );
    INSERT INTO public.detalles_liquidacion_personal(
      liquidacion_personal_id,jornada_trabajada_id,fecha_laboral_snapshot,sucursal_id_snapshot,
      sucursal_nombre_snapshot,roles_snapshot,funcion_nombre_snapshot,tarifa_nombre_snapshot,
      monto_snapshot,moneda_snapshot
    )
    SELECT v_liq,id,fecha_laboral,sucursal_id,sucursal_nombre_snapshot,roles_snapshot,
      funcion_nombre_snapshot,tarifa_nombre_snapshot,monto_tarifa_snapshot,moneda_snapshot
    FROM public.jornadas_trabajadas
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids);
    UPDATE public.jornadas_trabajadas SET estado='LIQUIDADA'
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids) AND estado='APROBADA';
  END LOOP;
  SELECT count(*),COALESCE(sum(cantidad_jornadas_snapshot),0),COALESCE(sum(total_snapshot),0)
  INTO v_count,v_seq,v_total FROM public.liquidaciones_personal WHERE periodo_pago_personal_id=p_periodo_id;
  UPDATE public.periodos_pago_personal SET estado='CALCULADO',total_personas_snapshot=v_count,
    total_jornadas_snapshot=v_seq,total_general_snapshot=v_total,calculado_por=auth.uid(),calculado_en=now()
  WHERE id=p_periodo_id;
END;
$$;

-- Materializa el histórico disponible. Las filas sin tarifa quedan visibles y no bloquean el turno.
DO $$
DECLARE v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.cash_shift_users WHERE is_enabled LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
  END LOOP;
END;
$$;

ALTER TABLE public.jornadas_trabajadas
  ALTER COLUMN cash_shift_user_id SET NOT NULL;

REVOKE ALL ON FUNCTION public.roles_laborales_turno(public.cash_shift_users) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_tarifa_roles_jornada(date,uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sincronizar_jornada_usuario_turno(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_sincronizar_jornada_usuario_turno() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sincronizar_jornadas_desde_turnos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_jornadas_desde_turnos() TO authenticated;

COMMENT ON TABLE public.jornadas_trabajadas IS
  'Jornadas pagables creadas y sincronizadas automáticamente desde cash_shift_users.';
COMMENT ON COLUMN public.jornadas_trabajadas.roles_snapshot IS
  'Funciones operativas activas en el turno; la función pagada corresponde a la tarifa aplicable más alta.';
