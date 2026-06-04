-- Migración: Agregar monto_descuento_ganado a predicciones_clientes y actualizar RPCs de cierre

ALTER TABLE public.predicciones_clientes 
ADD COLUMN IF NOT EXISTS monto_descuento_ganado numeric(10, 2);

COMMENT ON COLUMN public.predicciones_clientes.monto_descuento_ganado IS 'Descuento calculado al momento de ganar la oferta (total_orden * porcentaje_campana).';

-- 1. Actualizar cerrar_oferta_campana (Cierre individual)
CREATE OR REPLACE FUNCTION public.cerrar_oferta_campana(
  p_campana_id uuid,
  p_oferta_id text,
  p_es_ganadora boolean
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
  v_actualizadas integer := 0;
BEGIN
  IF NOT public.puede_gestionar_campanas_promocionales(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar ofertas de campaña';
  END IF;

  IF p_campana_id IS NULL OR p_oferta_id IS NULL OR trim(p_oferta_id) = '' THEN
    RAISE EXCEPTION 'Campaña u oferta inválida';
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
  FROM jsonb_array_elements_text(COALESCE(v_campana.ofertas_cumplidas, '[]'::jsonb)) AS value;

  IF p_es_ganadora THEN
    IF NOT (p_oferta_id = ANY (v_ganadoras)) THEN
      v_ganadoras := array_append(v_ganadoras, trim(p_oferta_id));
    END IF;
  ELSE
    v_ganadoras := array_remove(v_ganadoras, trim(p_oferta_id));
  END IF;

  v_dias := v_campana.dias_vigencia_descuento;

  UPDATE public.campanas_promocionales
  SET ofertas_cumplidas = COALESCE(to_jsonb(v_ganadoras), '[]'::jsonb)
  WHERE id = p_campana_id;

  IF p_es_ganadora THEN
    UPDATE public.predicciones_clientes pc
    SET
      estado_prediccion = 'GANADA',
      codigo_cupon = public.generar_codigo_cupon_promocion(),
      fecha_caducidad_cupon = now() + make_interval(days => v_dias),
      monto_descuento_ganado = CASE
        WHEN v_campana.descuento_maximo > 0 THEN
          LEAST(
            (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE order_id = pc.orden_id) * (v_campana.porcentaje_descuento / 100.0),
            v_campana.descuento_maximo
          )
        ELSE
          (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE order_id = pc.orden_id) * (v_campana.porcentaje_descuento / 100.0)
      END
    WHERE pc.campana_id = p_campana_id
      AND pc.estado_prediccion = 'PENDIENTE'
      AND pc.oferta_seleccionada_id = trim(p_oferta_id);

    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
  ELSE
    UPDATE public.predicciones_clientes pc
    SET estado_prediccion = 'PERDIDA'
    WHERE pc.campana_id = p_campana_id
      AND pc.estado_prediccion = 'PENDIENTE'
      AND pc.oferta_seleccionada_id = trim(p_oferta_id);

    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'campana_id', p_campana_id,
    'oferta_id', trim(p_oferta_id),
    'es_ganadora', p_es_ganadora,
    'ofertas_ganadoras', to_jsonb(v_ganadoras),
    'predicciones_actualizadas', v_actualizadas
  );
END;
$$;

-- 2. Actualizar cerrar_ofertas_campana (Cierre múltiple legacy)
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
  IF NOT public.is_global_admin(auth.uid()) AND NOT public.puede_gestionar_campanas_promocionales(auth.uid()) THEN
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
    fecha_caducidad_cupon = now() + make_interval(days => v_dias),
    monto_descuento_ganado = CASE
      WHEN v_campana.descuento_maximo > 0 THEN
        LEAST(
          (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE order_id = pc.orden_id) * (v_campana.porcentaje_descuento / 100.0),
          v_campana.descuento_maximo
        )
      ELSE
        (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE order_id = pc.orden_id) * (v_campana.porcentaje_descuento / 100.0)
    END
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
