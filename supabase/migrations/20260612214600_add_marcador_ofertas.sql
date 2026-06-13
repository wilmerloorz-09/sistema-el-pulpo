-- Migration: 20260612214600_add_marcador_ofertas.sql
ALTER TABLE public.predicciones_clientes
ADD COLUMN prediccion_marcador_local integer DEFAULT NULL,
ADD COLUMN prediccion_marcador_visitante integer DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.cerrar_oferta_campana(
  p_campana_id uuid,
  p_oferta_id text,
  p_es_ganadora boolean,
  p_marcador_final_local integer DEFAULT NULL,
  p_marcador_final_visitante integer DEFAULT NULL
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

  -- Update the arrays of fulfilled offers
  UPDATE public.campanas_promocionales
  SET ofertas_cumplidas = COALESCE(to_jsonb(v_ganadoras), '[]'::jsonb)
  WHERE id = p_campana_id;

  -- If marcador is provided, update the offer in the JSON array to include the final scores
  IF p_marcador_final_local IS NOT NULL AND p_marcador_final_visitante IS NOT NULL THEN
    UPDATE public.campanas_promocionales
    SET cartelera_ofertas = (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'id_oferta' = trim(p_oferta_id) THEN
            elem || jsonb_build_object(
              'marcador_final_local', p_marcador_final_local, 
              'marcador_final_visitante', p_marcador_final_visitante
            )
          ELSE
            elem
        END
      )
      FROM jsonb_array_elements(v_campana.cartelera_ofertas) AS elem
    )
    WHERE id = p_campana_id;
  END IF;

  -- Evaluate predictions
  IF p_marcador_final_local IS NOT NULL AND p_marcador_final_visitante IS NOT NULL THEN
    -- It is a MARCADOR offer
    -- Winners are those who guessed both scores exactly
    UPDATE public.predicciones_clientes pc
    SET
      estado_prediccion = CASE 
        WHEN pc.prediccion_marcador_local = p_marcador_final_local AND pc.prediccion_marcador_visitante = p_marcador_final_visitante THEN 'GANADA'
        ELSE 'PERDIDA'
      END,
      codigo_cupon = CASE 
        WHEN pc.prediccion_marcador_local = p_marcador_final_local AND pc.prediccion_marcador_visitante = p_marcador_final_visitante THEN public.generar_codigo_cupon_promocion()
        ELSE NULL
      END,
      fecha_caducidad_cupon = CASE 
        WHEN pc.prediccion_marcador_local = p_marcador_final_local AND pc.prediccion_marcador_visitante = p_marcador_final_visitante THEN now() + make_interval(days => v_dias)
        ELSE NULL
      END
    WHERE pc.campana_id = p_campana_id
      AND pc.estado_prediccion = 'PENDIENTE'
      AND pc.oferta_seleccionada_id = trim(p_oferta_id);
      
    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
    
  ELSIF p_es_ganadora THEN
    -- Standard RESULTADO offer marked as ganadora
    UPDATE public.predicciones_clientes pc
    SET
      estado_prediccion = 'GANADA',
      codigo_cupon = public.generar_codigo_cupon_promocion(),
      fecha_caducidad_cupon = now() + make_interval(days => v_dias)
    WHERE pc.campana_id = p_campana_id
      AND pc.estado_prediccion = 'PENDIENTE'
      AND pc.oferta_seleccionada_id = trim(p_oferta_id);

    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
  ELSE
    -- Standard RESULTADO offer marked as perdedora
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
    'predicciones_actualizadas', v_actualizadas,
    'marcador_final_local', p_marcador_final_local,
    'marcador_final_visitante', p_marcador_final_visitante
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_oferta_campana(uuid, text, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cerrar_oferta_campana(uuid, text, boolean, integer, integer) TO authenticated;
