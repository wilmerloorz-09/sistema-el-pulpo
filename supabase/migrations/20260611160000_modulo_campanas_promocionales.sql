-- Campañas promocionales, predicciones de clientes y permisos por turno.

CREATE TABLE IF NOT EXISTS public.campanas_promocionales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo varchar(150) NOT NULL,
  consumo_minimo numeric(10, 2) NOT NULL,
  porcentaje_descuento numeric(5, 2) NOT NULL,
  descuento_maximo numeric(10, 2) NOT NULL,
  dias_vigencia_descuento integer NOT NULL,
  cartelera_ofertas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ofertas_cumplidas jsonb NOT NULL DEFAULT '[]'::jsonb,
  activa boolean NOT NULL DEFAULT true,
  creado_el timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campanas_consumo_minimo_chk CHECK (consumo_minimo >= 0),
  CONSTRAINT campanas_porcentaje_descuento_chk CHECK (porcentaje_descuento > 0 AND porcentaje_descuento <= 100),
  CONSTRAINT campanas_descuento_maximo_chk CHECK (descuento_maximo >= 0),
  CONSTRAINT campanas_dias_vigencia_chk CHECK (dias_vigencia_descuento > 0),
  CONSTRAINT campanas_cartelera_es_array_chk CHECK (jsonb_typeof(cartelera_ofertas) = 'array'),
  CONSTRAINT campanas_ofertas_cumplidas_es_array_chk CHECK (jsonb_typeof(ofertas_cumplidas) = 'array')
);

COMMENT ON TABLE public.campanas_promocionales IS 'Campañas de predicciones y cupones de descuento sobre órdenes pagadas.';
COMMENT ON COLUMN public.campanas_promocionales.cartelera_ofertas IS 'Array JSON: id_oferta, descripcion, bloqueo_at, cuota.';
COMMENT ON COLUMN public.campanas_promocionales.ofertas_cumplidas IS 'IDs de ofertas ganadoras tras cerrar eventos.';

CREATE TABLE IF NOT EXISTS public.predicciones_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campana_id uuid NOT NULL REFERENCES public.campanas_promocionales(id) ON DELETE RESTRICT,
  orden_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  oferta_seleccionada_id varchar(80) NOT NULL,
  estado_prediccion varchar(20) NOT NULL DEFAULT 'PENDIENTE',
  codigo_cupon varchar(32) UNIQUE,
  cupon_usado_el timestamptz,
  fecha_caducidad_cupon timestamptz,
  registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creado_el timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT predicciones_orden_unica UNIQUE (orden_id),
  CONSTRAINT predicciones_estado_chk CHECK (estado_prediccion IN ('PENDIENTE', 'GANADA', 'PERDIDA'))
);

COMMENT ON TABLE public.predicciones_clientes IS 'Participación de un comensal por orden pagada en una campaña.';
CREATE INDEX IF NOT EXISTS idx_predicciones_campana ON public.predicciones_clientes (campana_id);
CREATE INDEX IF NOT EXISTS idx_predicciones_cliente ON public.predicciones_clientes (cliente_id);

CREATE TABLE IF NOT EXISTS public.permisos_promociones_turnos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_usuario_id uuid NOT NULL UNIQUE REFERENCES public.cash_shift_users(id) ON DELETE CASCADE,
  puede_registrar_promociones boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.permisos_promociones_turnos IS 'Habilita registro de predicciones por usuario en turno.';

CREATE OR REPLACE FUNCTION public.crear_permiso_promociones_turno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.permisos_promociones_turnos (turno_usuario_id, puede_registrar_promociones)
  VALUES (NEW.id, true)
  ON CONFLICT (turno_usuario_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crear_permiso_promociones_turno ON public.cash_shift_users;
CREATE TRIGGER trg_crear_permiso_promociones_turno
  AFTER INSERT ON public.cash_shift_users
  FOR EACH ROW
  EXECUTE FUNCTION public.crear_permiso_promociones_turno();

INSERT INTO public.permisos_promociones_turnos (turno_usuario_id, puede_registrar_promociones)
SELECT csu.id, true
FROM public.cash_shift_users csu
ON CONFLICT (turno_usuario_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.usuario_puede_registrar_promociones(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ppt.puede_registrar_promociones
      FROM public.cash_shifts cs
      INNER JOIN public.cash_shift_users csu ON csu.shift_id = cs.id
      LEFT JOIN public.permisos_promociones_turnos ppt ON ppt.turno_usuario_id = csu.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = COALESCE(p_user_id, auth.uid())
        AND csu.is_enabled = true
      ORDER BY cs.opened_at DESC
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.usuario_puede_registrar_promociones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_puede_registrar_promociones(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generar_codigo_cupon_promocion()
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigo varchar(32);
  v_intentos integer := 0;
BEGIN
  LOOP
    v_intentos := v_intentos + 1;
    v_codigo := 'CPN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.predicciones_clientes pc WHERE pc.codigo_cupon = v_codigo
    );
    IF v_intentos > 25 THEN
      RAISE EXCEPTION 'No se pudo generar un código de cupón único';
    END IF;
  END LOOP;
  RETURN v_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION public.cerrar_ofertas_campana(
  p_campana_id uuid,
  p_ofertas_ganadoras jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campana public.campanas_promocionales%ROWTYPE;
  v_ganadoras text[];
  v_dias integer;
  v_actualizadas_ganadas integer := 0;
  v_actualizadas_perdidas integer := 0;
BEGIN
  IF NOT public.is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar ofertas de campaña';
  END IF;

  IF p_campana_id IS NULL THEN
    RAISE EXCEPTION 'Campaña inválida';
  END IF;

  IF jsonb_typeof(p_ofertas_ganadoras) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las ofertas ganadoras deben ser un arreglo JSON';
  END IF;

  SELECT * INTO v_campana
  FROM public.campanas_promocionales
  WHERE id = p_campana_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaña no encontrada';
  END IF;

  SELECT COALESCE(array_agg(trim(both '"' from value::text)), ARRAY[]::text[])
  INTO v_ganadoras
  FROM jsonb_array_elements_text(p_ofertas_ganadoras) AS value;

  v_dias := v_campana.dias_vigencia_descuento;

  UPDATE public.campanas_promocionales
  SET ofertas_cumplidas = COALESCE(to_jsonb(v_ganadoras), '[]'::jsonb)
  WHERE id = p_campana_id;

  UPDATE public.predicciones_clientes pc
  SET
    estado_prediccion = 'GANADA',
    codigo_cupon = public.generar_codigo_cupon_promocion(),
    fecha_caducidad_cupon = now() + make_interval(days => v_dias)
  WHERE pc.campana_id = p_campana_id
    AND pc.estado_prediccion = 'PENDIENTE'
    AND pc.oferta_seleccionada_id = ANY (v_ganadoras);

  GET DIAGNOSTICS v_actualizadas_ganadas = ROW_COUNT;

  UPDATE public.predicciones_clientes pc
  SET estado_prediccion = 'PERDIDA'
  WHERE pc.campana_id = p_campana_id
    AND pc.estado_prediccion = 'PENDIENTE'
    AND NOT (pc.oferta_seleccionada_id = ANY (v_ganadoras));

  GET DIAGNOSTICS v_actualizadas_perdidas = ROW_COUNT;

  RETURN jsonb_build_object(
    'campana_id', p_campana_id,
    'ofertas_ganadoras', to_jsonb(v_ganadoras),
    'ganadas', v_actualizadas_ganadas,
    'perdidas', v_actualizadas_perdidas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_ofertas_campana(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cerrar_ofertas_campana(uuid, jsonb) TO authenticated;

ALTER TABLE public.campanas_promocionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predicciones_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permisos_promociones_turnos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campanas_select_operativo ON public.campanas_promocionales;
CREATE POLICY campanas_select_operativo
  ON public.campanas_promocionales
  FOR SELECT
  TO authenticated
  USING (
    public.is_global_admin(auth.uid())
    OR public.usuario_en_turno_operativo_abierto(auth.uid())
  );

-- Políticas de escritura: ver migración 20260611161000 (admin sucursal + global).
DROP POLICY IF EXISTS campanas_insert_admin ON public.campanas_promocionales;
DROP POLICY IF EXISTS campanas_update_admin ON public.campanas_promocionales;
DROP POLICY IF EXISTS campanas_delete_admin ON public.campanas_promocionales;

DROP POLICY IF EXISTS predicciones_select_operativo ON public.predicciones_clientes;
CREATE POLICY predicciones_select_operativo
  ON public.predicciones_clientes
  FOR SELECT
  TO authenticated
  USING (
    public.is_global_admin(auth.uid())
    OR public.usuario_puede_registrar_promociones(auth.uid())
  );

DROP POLICY IF EXISTS predicciones_insert_operativo ON public.predicciones_clientes;
CREATE POLICY predicciones_insert_operativo
  ON public.predicciones_clientes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.usuario_puede_registrar_promociones(auth.uid())
    AND (registrado_por IS NULL OR registrado_por = auth.uid())
  );

DROP POLICY IF EXISTS predicciones_update_admin ON public.predicciones_clientes;
CREATE POLICY predicciones_update_admin
  ON public.predicciones_clientes
  FOR UPDATE
  TO authenticated
  USING (public.is_global_admin(auth.uid()))
  WITH CHECK (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS permisos_promociones_select ON public.permisos_promociones_turnos;
CREATE POLICY permisos_promociones_select
  ON public.permisos_promociones_turnos
  FOR SELECT
  TO authenticated
  USING (
    public.is_global_admin(auth.uid())
    OR public.usuario_en_turno_operativo_abierto(auth.uid())
  );

DROP POLICY IF EXISTS permisos_promociones_admin ON public.permisos_promociones_turnos;
CREATE POLICY permisos_promociones_admin
  ON public.permisos_promociones_turnos
  FOR ALL
  TO authenticated
  USING (public.is_global_admin(auth.uid()))
  WITH CHECK (public.is_global_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
