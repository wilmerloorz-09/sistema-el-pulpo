-- Caja Chica: editar y eliminar movimientos, recalculando saldos en cadena.

CREATE OR REPLACE FUNCTION public.caja_chica_recalcular_fondo(p_sucursal_efectiva_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo numeric(14, 2) := 0;
  r record;
  v_despues numeric(14, 2);
BEGIN
  IF p_sucursal_efectiva_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal requerida';
  END IF;

  FOR r IN
    SELECT m.id, m.tipo, m.monto
    FROM public.caja_chica_movimientos m
    WHERE m.sucursal_id = p_sucursal_efectiva_id
    ORDER BY m.creado_en ASC, m.id ASC
  LOOP
    IF r.tipo = 'EGRESO' THEN
      v_despues := v_saldo - r.monto;
    ELSE
      v_despues := v_saldo + r.monto;
    END IF;

    IF v_despues < 0 THEN
      RAISE EXCEPTION 'Operación inválida: el saldo quedaría negativo en el historial';
    END IF;

    UPDATE public.caja_chica_movimientos
    SET saldo_antes = v_saldo,
        saldo_despues = v_despues
    WHERE id = r.id;

    v_saldo := v_despues;
  END LOOP;

  INSERT INTO public.caja_chica_fondos (sucursal_id, saldo)
  VALUES (p_sucursal_efectiva_id, v_saldo)
  ON CONFLICT (sucursal_id) DO UPDATE
  SET saldo = EXCLUDED.saldo,
      actualizado_en = now();

  RETURN v_saldo;
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_recalcular_fondo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_recalcular_fondo(uuid) TO authenticated;

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
  p_tamano_bytes integer DEFAULT NULL
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
  v_ruta text := nullif(trim(COALESCE(p_ruta_objeto, '')), '');
  v_ruta_previa text;
  v_saldo numeric(14, 2);
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
  IF v_concepto IS NULL THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;

  v_ruta_previa := v_row.ruta_objeto;

  UPDATE public.caja_chica_movimientos
  SET tipo = v_tipo,
      monto = v_monto,
      concepto = v_concepto,
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

REVOKE ALL ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_actualizar_movimiento(uuid, text, numeric, text, text, boolean, text, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_eliminar_movimiento(p_movimiento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.caja_chica_movimientos%ROWTYPE;
  v_saldo numeric(14, 2);
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

  DELETE FROM public.caja_chica_movimientos
  WHERE id = p_movimiento_id;

  v_saldo := public.caja_chica_recalcular_fondo(v_row.sucursal_id);

  IF v_row.ruta_objeto IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'comprobantes-caja-chica'
      AND name = v_row.ruta_objeto;
  END IF;

  RETURN jsonb_build_object(
    'id', p_movimiento_id,
    'sucursal_efectiva_id', v_row.sucursal_id,
    'saldo', v_saldo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_eliminar_movimiento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_eliminar_movimiento(uuid) TO authenticated;
