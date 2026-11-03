-- Caja Chica: la foto del comprobante es opcional (egreso y reposición).

ALTER TABLE public.caja_chica_movimientos
  DROP CONSTRAINT IF EXISTS caja_chica_movimientos_egreso_foto_chk;

COMMENT ON TABLE public.caja_chica_movimientos IS
  'Historial de egresos y reposiciones de caja chica. La foto de comprobante es opcional.';

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
  p_tamano_bytes integer DEFAULT NULL
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
  v_saldo_antes numeric(14, 2);
  v_saldo_despues numeric(14, 2);
  v_mov_id uuid := COALESCE(p_movimiento_id, gen_random_uuid());
  v_nombre text;
  v_bucket text := 'comprobantes-caja-chica';
  v_ruta text := nullif(trim(COALESCE(p_ruta_objeto, '')), '');
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
  IF v_concepto IS NULL THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

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
