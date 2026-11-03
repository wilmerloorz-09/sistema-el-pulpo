-- Caja Chica: catálogo de conceptos (solo admin) + observación en egresos.

CREATE TABLE IF NOT EXISTS public.caja_chica_conceptos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actualizado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_chica_conceptos_nombre_chk CHECK (length(trim(nombre)) > 0)
);

COMMENT ON TABLE public.caja_chica_conceptos IS
  'Catálogo de conceptos/productos para egresos de caja chica. sucursal_id = inventario efectiva.';

CREATE UNIQUE INDEX IF NOT EXISTS caja_chica_conceptos_sucursal_nombre_uniq
  ON public.caja_chica_conceptos (sucursal_id, lower(trim(nombre)))
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_caja_chica_conceptos_sucursal_activo
  ON public.caja_chica_conceptos (sucursal_id, activo, nombre);

DROP TRIGGER IF EXISTS trg_caja_chica_conceptos_sucursal_efectiva ON public.caja_chica_conceptos;
CREATE TRIGGER trg_caja_chica_conceptos_sucursal_efectiva
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.caja_chica_conceptos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_caja_chica_redirigir_sucursal_efectiva();

ALTER TABLE public.caja_chica_conceptos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caja_chica_conceptos_select ON public.caja_chica_conceptos;
CREATE POLICY caja_chica_conceptos_select
ON public.caja_chica_conceptos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(caja_chica_conceptos.sucursal_id) AS s(id)
    WHERE public.can_operate_caja_chica(auth.uid(), s.id)
       OR public.can_manage_branch_admin(auth.uid(), s.id)
       OR public.is_global_admin(auth.uid())
  )
);

ALTER TABLE public.caja_chica_movimientos
  ADD COLUMN IF NOT EXISTS observacion text;

ALTER TABLE public.caja_chica_movimientos
  ADD COLUMN IF NOT EXISTS concepto_id uuid REFERENCES public.caja_chica_conceptos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.caja_chica_movimientos.observacion IS
  'Observación libre del egreso (o detalle cuando el concepto es Otros).';
COMMENT ON COLUMN public.caja_chica_movimientos.concepto_id IS
  'Concepto del catálogo; NULL si es Otros, reposición u histórico libre.';

CREATE OR REPLACE FUNCTION public.caja_chica_puede_admin_conceptos(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.inventario_sucursales_compartidas(p_branch_id) AS s(id)
      WHERE public.can_manage_branch_admin(p_user_id, s.id)
    );
$$;

REVOKE ALL ON FUNCTION public.caja_chica_puede_admin_conceptos(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_puede_admin_conceptos(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_listar_conceptos(
  p_sucursal_id uuid,
  p_incluir_inactivos boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  sucursal_id uuid,
  nombre text,
  activo boolean,
  creado_en timestamptz,
  actualizado_en timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id)
     AND NOT public.caja_chica_puede_admin_conceptos(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver conceptos de caja chica';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  RETURN QUERY
  SELECT
    c.id,
    c.sucursal_id,
    c.nombre,
    c.activo,
    c.creado_en,
    c.actualizado_en
  FROM public.caja_chica_conceptos c
  WHERE c.sucursal_id = v_efectiva
    AND (p_incluir_inactivos OR c.activo = true)
  ORDER BY c.nombre ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_listar_conceptos(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_listar_conceptos(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_guardar_concepto(
  p_sucursal_id uuid,
  p_nombre text,
  p_concepto_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_nombre text := nullif(trim(COALESCE(p_nombre, '')), '');
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT public.caja_chica_puede_admin_conceptos(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar conceptos de caja chica';
  END IF;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre del concepto es obligatorio';
  END IF;
  IF lower(v_nombre) IN ('otros', 'reposición de fondos', 'reposicion de fondos') THEN
    RAISE EXCEPTION 'Ese nombre está reservado';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  IF p_concepto_id IS NULL THEN
    INSERT INTO public.caja_chica_conceptos (sucursal_id, nombre, creado_por, actualizado_por)
    VALUES (v_efectiva, v_nombre, v_actor, v_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.caja_chica_conceptos
    SET nombre = v_nombre,
        activo = true,
        actualizado_por = v_actor,
        actualizado_en = now()
    WHERE id = p_concepto_id
      AND sucursal_id = v_efectiva
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Concepto no encontrado';
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'nombre', v_nombre);
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_guardar_concepto(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_guardar_concepto(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_eliminar_concepto(p_concepto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.caja_chica_conceptos%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_row
  FROM public.caja_chica_conceptos c
  WHERE c.id = p_concepto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Concepto no encontrado';
  END IF;

  IF NOT public.caja_chica_puede_admin_conceptos(v_actor, v_row.sucursal_id) THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar conceptos de caja chica';
  END IF;

  UPDATE public.caja_chica_conceptos
  SET activo = false,
      actualizado_por = v_actor,
      actualizado_en = now()
  WHERE id = p_concepto_id;

  RETURN jsonb_build_object('id', p_concepto_id, 'activo', false);
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_eliminar_concepto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_eliminar_concepto(uuid) TO authenticated;

-- Actualizar listado de movimientos para incluir observación y concepto_id.
DROP FUNCTION IF EXISTS public.caja_chica_listar_movimientos(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.caja_chica_listar_movimientos(
  p_sucursal_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  sucursal_id uuid,
  tipo text,
  monto numeric,
  concepto text,
  concepto_id uuid,
  observacion text,
  notas text,
  saldo_antes numeric,
  saldo_despues numeric,
  ruta_objeto text,
  nombre_bucket text,
  registrado_por_nombre text,
  creado_en timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  RETURN QUERY
  SELECT
    m.id,
    m.sucursal_id,
    m.tipo,
    m.monto,
    m.concepto,
    m.concepto_id,
    m.observacion,
    m.notas,
    m.saldo_antes,
    m.saldo_despues,
    m.ruta_objeto,
    m.nombre_bucket,
    m.registrado_por_nombre,
    m.creado_en
  FROM public.caja_chica_movimientos m
  WHERE m.sucursal_id = v_efectiva
  ORDER BY m.creado_en DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_listar_movimientos(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_listar_movimientos(uuid, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer);
DROP FUNCTION IF EXISTS public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.caja_chica_registrar_movimiento(
  p_sucursal_id uuid,
  p_tipo text,
  p_monto numeric,
  p_concepto text,
  p_notas text DEFAULT NULL,
  p_movimiento_id uuid DEFAULT NULL,
  p_ruta_objeto text DEFAULT NULL,
  p_nombre_archivo text DEFAULT NULL,
  p_tipo_mime text DEFAULT NULL,
  p_tamano_bytes integer DEFAULT NULL,
  p_observacion text DEFAULT NULL,
  p_concepto_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_tipo text := upper(trim(COALESCE(p_tipo, '')));
  v_monto numeric(14, 2) := round(COALESCE(p_monto, 0), 2);
  v_concepto text := nullif(trim(COALESCE(p_concepto, '')), '');
  v_notas text := nullif(trim(COALESCE(p_notas, '')), '');
  v_observacion text := nullif(trim(COALESCE(p_observacion, '')), '');
  v_concepto_id uuid := p_concepto_id;
  v_saldo_antes numeric(14, 2);
  v_saldo_despues numeric(14, 2);
  v_mov_id uuid := COALESCE(p_movimiento_id, gen_random_uuid());
  v_nombre text;
  v_bucket text := 'comprobantes-caja-chica';
  v_ruta text := nullif(trim(COALESCE(p_ruta_objeto, '')), '');
  v_concepto_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal requerida';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;
  IF v_tipo NOT IN ('EGRESO', 'REPOSICION') THEN
    RAISE EXCEPTION 'Tipo inválido (EGRESO o REPOSICION)';
  END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  IF v_tipo = 'REPOSICION' THEN
    v_concepto := 'Reposición de fondos';
    v_concepto_id := NULL;
  ELSE
    IF v_concepto_id IS NOT NULL THEN
      SELECT c.nombre INTO v_concepto_nombre
      FROM public.caja_chica_conceptos c
      WHERE c.id = v_concepto_id
        AND c.sucursal_id = v_efectiva
        AND c.activo = true;
      IF v_concepto_nombre IS NULL THEN
        RAISE EXCEPTION 'Concepto no válido o inactivo';
      END IF;
      v_concepto := v_concepto_nombre;
    ELSE
      IF v_concepto IS NULL OR lower(v_concepto) <> 'otros' THEN
        RAISE EXCEPTION 'Selecciona un concepto del catálogo u Otros';
      END IF;
      v_concepto := 'Otros';
      v_concepto_id := NULL;
    END IF;
  END IF;

  SELECT COALESCE(
    (SELECT trim(concat_ws(' ', p.first_name, p.last_name)) FROM public.profiles p WHERE p.id = v_actor),
    (SELECT p.full_name FROM public.profiles p WHERE p.id = v_actor),
    (SELECT p.username FROM public.profiles p WHERE p.id = v_actor),
    'Usuario'
  ) INTO v_nombre;

  INSERT INTO public.caja_chica_fondos (sucursal_id, saldo)
  VALUES (v_efectiva, 0)
  ON CONFLICT (sucursal_id) DO NOTHING;

  SELECT f.saldo INTO v_saldo_antes
  FROM public.caja_chica_fondos f
  WHERE f.sucursal_id = v_efectiva
  FOR UPDATE;

  v_saldo_antes := COALESCE(v_saldo_antes, 0);

  IF v_tipo = 'EGRESO' THEN
    IF v_monto > v_saldo_antes THEN
      RAISE EXCEPTION 'Saldo insuficiente (disponible: %)', v_saldo_antes;
    END IF;
    v_saldo_despues := v_saldo_antes - v_monto;
  ELSE
    v_saldo_despues := v_saldo_antes + v_monto;
  END IF;

  UPDATE public.caja_chica_fondos
  SET saldo = v_saldo_despues,
      actualizado_en = now()
  WHERE sucursal_id = v_efectiva;

  INSERT INTO public.caja_chica_movimientos (
    id,
    sucursal_id,
    tipo,
    monto,
    concepto,
    concepto_id,
    observacion,
    notas,
    saldo_antes,
    saldo_despues,
    nombre_bucket,
    ruta_objeto,
    nombre_archivo,
    tipo_mime,
    tamano_bytes,
    registrado_por,
    registrado_por_nombre
  ) VALUES (
    v_mov_id,
    v_efectiva,
    v_tipo,
    v_monto,
    v_concepto,
    v_concepto_id,
    v_observacion,
    v_notas,
    v_saldo_antes,
    v_saldo_despues,
    CASE WHEN v_ruta IS NOT NULL THEN v_bucket ELSE NULL END,
    v_ruta,
    nullif(trim(COALESCE(p_nombre_archivo, '')), ''),
    nullif(trim(COALESCE(p_tipo_mime, '')), ''),
    p_tamano_bytes,
    v_actor,
    v_nombre
  );

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'sucursal_efectiva_id', v_efectiva,
    'tipo', v_tipo,
    'monto', v_monto,
    'saldo_antes', v_saldo_antes,
    'saldo_despues', v_saldo_despues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer);
DROP FUNCTION IF EXISTS public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.caja_chica_actualizar_movimiento(
  p_movimiento_id uuid,
  p_tipo text,
  p_monto numeric,
  p_concepto text,
  p_notas text DEFAULT NULL,
  p_actualizar_comprobante boolean DEFAULT false,
  p_ruta_objeto text DEFAULT NULL,
  p_nombre_archivo text DEFAULT NULL,
  p_tipo_mime text DEFAULT NULL,
  p_tamano_bytes integer DEFAULT NULL,
  p_observacion text DEFAULT NULL,
  p_concepto_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.caja_chica_movimientos%ROWTYPE;
  v_tipo text := upper(trim(COALESCE(p_tipo, '')));
  v_monto numeric(14, 2) := round(COALESCE(p_monto, 0), 2);
  v_concepto text := nullif(trim(COALESCE(p_concepto, '')), '');
  v_notas text := nullif(trim(COALESCE(p_notas, '')), '');
  v_observacion text := nullif(trim(COALESCE(p_observacion, '')), '');
  v_concepto_id uuid := p_concepto_id;
  v_ruta text := nullif(trim(COALESCE(p_ruta_objeto, '')), '');
  v_ruta_previa text;
  v_saldo numeric(14, 2);
  v_concepto_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_movimiento_id IS NULL THEN
    RAISE EXCEPTION 'Movimiento requerido';
  END IF;

  SELECT * INTO v_row
  FROM public.caja_chica_movimientos m
  WHERE m.id = p_movimiento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado';
  END IF;

  IF NOT public.can_operate_caja_chica(v_actor, v_row.sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;

  IF v_tipo NOT IN ('EGRESO', 'REPOSICION') THEN
    RAISE EXCEPTION 'Tipo inválido (EGRESO o REPOSICION)';
  END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  IF v_tipo = 'REPOSICION' THEN
    v_concepto := 'Reposición de fondos';
    v_concepto_id := NULL;
  ELSE
    IF v_concepto_id IS NOT NULL THEN
      SELECT c.nombre INTO v_concepto_nombre
      FROM public.caja_chica_conceptos c
      WHERE c.id = v_concepto_id
        AND c.sucursal_id = v_row.sucursal_id
        AND c.activo = true;
      IF v_concepto_nombre IS NULL THEN
        -- Permitir conservar concepto histórico inactivo al editar sin cambiarlo
        SELECT c.nombre INTO v_concepto_nombre
        FROM public.caja_chica_conceptos c
        WHERE c.id = v_concepto_id
          AND c.sucursal_id = v_row.sucursal_id
          AND c.id = v_row.concepto_id;
      END IF;
      IF v_concepto_nombre IS NULL THEN
        RAISE EXCEPTION 'Concepto no válido o inactivo';
      END IF;
      v_concepto := v_concepto_nombre;
    ELSE
      IF v_concepto IS NULL OR lower(v_concepto) <> 'otros' THEN
        RAISE EXCEPTION 'Selecciona un concepto del catálogo u Otros';
      END IF;
      v_concepto := 'Otros';
      v_concepto_id := NULL;
    END IF;
  END IF;

  v_ruta_previa := v_row.ruta_objeto;

  UPDATE public.caja_chica_movimientos
  SET tipo = v_tipo,
      monto = v_monto,
      concepto = v_concepto,
      concepto_id = v_concepto_id,
      observacion = CASE WHEN v_tipo = 'EGRESO' THEN v_observacion ELSE NULL END,
      notas = v_notas,
      nombre_bucket = CASE
        WHEN p_actualizar_comprobante THEN
          CASE WHEN v_ruta IS NOT NULL THEN 'comprobantes-caja-chica' ELSE NULL END
        ELSE nombre_bucket
      END,
      ruta_objeto = CASE
        WHEN p_actualizar_comprobante THEN v_ruta
        ELSE ruta_objeto
      END,
      nombre_archivo = CASE
        WHEN p_actualizar_comprobante THEN nullif(trim(COALESCE(p_nombre_archivo, '')), '')
        ELSE nombre_archivo
      END,
      tipo_mime = CASE
        WHEN p_actualizar_comprobante THEN nullif(trim(COALESCE(p_tipo_mime, '')), '')
        ELSE tipo_mime
      END,
      tamano_bytes = CASE
        WHEN p_actualizar_comprobante THEN p_tamano_bytes
        ELSE tamano_bytes
      END
  WHERE id = p_movimiento_id;

  v_saldo := public.caja_chica_recalcular_fondo(v_row.sucursal_id);

  IF p_actualizar_comprobante
     AND v_ruta_previa IS NOT NULL
     AND (v_ruta IS NULL OR v_ruta <> v_ruta_previa)
  THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'comprobantes-caja-chica'
      AND name = v_ruta_previa;
  END IF;

  RETURN jsonb_build_object(
    'id', p_movimiento_id,
    'sucursal_efectiva_id', v_row.sucursal_id,
    'saldo', v_saldo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid) TO authenticated;
