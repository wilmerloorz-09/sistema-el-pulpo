-- Caja Chica: permitir registrar/editar la fecha del movimiento (creado_en).

DROP FUNCTION IF EXISTS public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid);
DROP FUNCTION IF EXISTS public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid, timestamptz);

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
  p_concepto_id uuid DEFAULT NULL,
  p_fecha timestamptz DEFAULT NULL
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
  v_fecha timestamptz := COALESCE(p_fecha, now());
  v_saldo_antes numeric(14, 2);
  v_saldo_despues numeric(14, 2);
  v_mov_id uuid := COALESCE(p_movimiento_id, gen_random_uuid());
  v_nombre text;
  v_bucket text := 'comprobantes-caja-chica';
  v_ruta text := nullif(trim(COALESCE(p_ruta_objeto, '')), '');
  v_concepto_nombre text;
  v_saldo numeric(14, 2);
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
  IF v_fecha > (now() + interval '1 day') THEN
    RAISE EXCEPTION 'La fecha no puede ser futura';
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

  -- Valores temporales; el recalculo fija saldos según orden cronológico.
  v_saldo_antes := 0;
  v_saldo_despues := CASE WHEN v_tipo = 'EGRESO' THEN -v_monto ELSE v_monto END;

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
    registrado_por_nombre,
    creado_en
  ) VALUES (
    v_mov_id,
    v_efectiva,
    v_tipo,
    v_monto,
    v_concepto,
    v_concepto_id,
    CASE WHEN v_tipo = 'EGRESO' THEN v_observacion ELSE NULL END,
    v_notas,
    v_saldo_antes,
    v_saldo_despues,
    CASE WHEN v_ruta IS NOT NULL THEN v_bucket ELSE NULL END,
    v_ruta,
    nullif(trim(COALESCE(p_nombre_archivo, '')), ''),
    nullif(trim(COALESCE(p_tipo_mime, '')), ''),
    p_tamano_bytes,
    v_actor,
    v_nombre,
    v_fecha
  );

  v_saldo := public.caja_chica_recalcular_fondo(v_efectiva);

  SELECT m.saldo_antes, m.saldo_despues
  INTO v_saldo_antes, v_saldo_despues
  FROM public.caja_chica_movimientos m
  WHERE m.id = v_mov_id;

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'sucursal_efectiva_id', v_efectiva,
    'tipo', v_tipo,
    'monto', v_monto,
    'saldo_antes', v_saldo_antes,
    'saldo_despues', v_saldo_despues,
    'saldo', v_saldo,
    'creado_en', v_fecha
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer, text, uuid, timestamptz) TO authenticated;

DROP FUNCTION IF EXISTS public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid);
DROP FUNCTION IF EXISTS public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid, timestamptz);

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
  p_concepto_id uuid DEFAULT NULL,
  p_fecha timestamptz DEFAULT NULL
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
  v_fecha timestamptz;
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

  v_fecha := COALESCE(p_fecha, v_row.creado_en);
  IF v_fecha > (now() + interval '1 day') THEN
    RAISE EXCEPTION 'La fecha no puede ser futura';
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
      creado_en = v_fecha,
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
    'saldo', v_saldo,
    'creado_en', v_fecha
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer, text, uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
