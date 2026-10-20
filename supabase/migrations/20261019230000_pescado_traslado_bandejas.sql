-- Gestion Pescado: en traslados tambien se descuentan bandejas (0.78 lb c/u).
-- Cantidad recibida = bruta; cantidad que se mueve = total (bruta - bandejas).

ALTER TABLE public.pescado_traslados
  ADD COLUMN IF NOT EXISTS cantidad_bruta_lb numeric(14,3),
  ADD COLUMN IF NOT EXISTS cantidad_bandejas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peso_bandeja_lb numeric(10,3) NOT NULL DEFAULT 0.780,
  ADD COLUMN IF NOT EXISTS descuento_bandejas_lb numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_total_lb numeric(14,3);

UPDATE public.pescado_traslados
SET cantidad_bruta_lb = COALESCE(cantidad_bruta_lb, cantidad_lb),
    cantidad_total_lb = COALESCE(cantidad_total_lb, cantidad_lb)
WHERE cantidad_bruta_lb IS NULL OR cantidad_total_lb IS NULL;

ALTER TABLE public.pescado_traslados
  DROP CONSTRAINT IF EXISTS pescado_traslados_bandejas_chk;
ALTER TABLE public.pescado_traslados
  ADD CONSTRAINT pescado_traslados_bandejas_chk CHECK (cantidad_bandejas >= 0);

CREATE OR REPLACE FUNCTION public.trasladar_pescado(
  p_desde_ambito text,
  p_desde_sucursal_id uuid,
  p_hasta_ambito text,
  p_hasta_sucursal_id uuid,
  p_cantidad_lb numeric,
  p_observacion text DEFAULT NULL,
  p_cantidad_bandejas integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_bruta numeric(14,3);
  v_bandejas integer;
  v_peso_bandeja constant numeric(10,3) := 0.780;
  v_descuento numeric(14,3);
  v_qty numeric(14,3);
  v_nombre text;
  v_id uuid;
  v_desde_stock uuid;
  v_hasta_stock uuid;
  v_ant_desde numeric(14,3);
  v_new_desde numeric(14,3);
  v_ant_hasta numeric(14,3);
  v_new_hasta numeric(14,3);
  v_es_central_desde boolean;
  v_es_central_hasta boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_desde_ambito NOT IN ('CENTRAL','SUCURSAL') OR p_hasta_ambito NOT IN ('CENTRAL','SUCURSAL') THEN RAISE EXCEPTION 'Ubicación no válida'; END IF;
  IF p_desde_ambito='SUCURSAL' AND p_desde_sucursal_id IS NULL THEN RAISE EXCEPTION 'Selecciona la sucursal de origen'; END IF;
  IF p_hasta_ambito='SUCURSAL' AND p_hasta_sucursal_id IS NULL THEN RAISE EXCEPTION 'Selecciona la sucursal destino'; END IF;
  IF p_desde_ambito=p_hasta_ambito AND COALESCE(p_desde_sucursal_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(p_hasta_sucursal_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'El origen y el destino deben ser diferentes';
  END IF;

  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    IF NOT (p_desde_ambito='SUCURSAL' AND p_hasta_ambito='CENTRAL' AND public.can_devolver_pescado_sucursal(v_actor,p_desde_sucursal_id)) THEN
      RAISE EXCEPTION 'No tienes permiso para realizar este movimiento';
    END IF;
  END IF;

  v_bruta := round(COALESCE(p_cantidad_lb,0)::numeric,3);
  IF v_bruta <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  v_bandejas := COALESCE(p_cantidad_bandejas,0);
  IF v_bandejas < 0 THEN RAISE EXCEPTION 'La cantidad de bandejas no puede ser negativa'; END IF;
  v_descuento := round((v_bandejas * v_peso_bandeja)::numeric,3);
  v_qty := round((v_bruta - v_descuento)::numeric,3);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad total debe ser mayor a 0 (cantidad % lb - bandejas % lb)',
      trim(to_char(v_bruta,'FM999999990.999')), trim(to_char(v_descuento,'FM999999990.999'));
  END IF;

  v_nombre := public.pescado_nombre_actor(v_actor);
  v_es_central_desde := p_desde_ambito='CENTRAL';
  v_es_central_hasta := p_hasta_ambito='CENTRAL';

  IF v_es_central_desde THEN
    v_desde_stock := public.pescado_asegurar_stock_central();
    SELECT cantidad_libras INTO v_ant_desde FROM public.pescado_stock_central WHERE id=v_desde_stock;
  ELSE
    v_desde_stock := public.pescado_asegurar_stock_sucursal(p_desde_sucursal_id);
    SELECT cantidad_libras INTO v_ant_desde FROM public.pescado_stock_sucursal WHERE id=v_desde_stock;
  END IF;
  v_ant_desde := COALESCE(v_ant_desde,0);
  IF v_ant_desde < v_qty THEN RAISE EXCEPTION 'Stock insuficiente en origen. Disponible: % lb, solicitado: % lb', trim(to_char(v_ant_desde,'FM999999990.999')), trim(to_char(v_qty,'FM999999990.999')); END IF;
  v_new_desde := v_ant_desde - v_qty;

  IF v_es_central_hasta THEN
    v_hasta_stock := public.pescado_asegurar_stock_central();
    SELECT cantidad_libras INTO v_ant_hasta FROM public.pescado_stock_central WHERE id=v_hasta_stock;
  ELSE
    v_hasta_stock := public.pescado_asegurar_stock_sucursal(p_hasta_sucursal_id);
    SELECT cantidad_libras INTO v_ant_hasta FROM public.pescado_stock_sucursal WHERE id=v_hasta_stock;
  END IF;
  v_ant_hasta := COALESCE(v_ant_hasta,0);
  v_new_hasta := v_ant_hasta + v_qty;

  IF v_es_central_desde THEN
    UPDATE public.pescado_stock_central SET cantidad_libras=v_new_desde, updated_at=now() WHERE id=v_desde_stock;
  ELSE
    UPDATE public.pescado_stock_sucursal SET cantidad_libras=v_new_desde, updated_at=now() WHERE id=v_desde_stock;
  END IF;
  IF v_es_central_hasta THEN
    UPDATE public.pescado_stock_central SET cantidad_libras=v_new_hasta, updated_at=now() WHERE id=v_hasta_stock;
  ELSE
    UPDATE public.pescado_stock_sucursal SET cantidad_libras=v_new_hasta, updated_at=now() WHERE id=v_hasta_stock;
  END IF;

  INSERT INTO public.pescado_traslados (
    desde_ambito, desde_sucursal_id, hasta_ambito, hasta_sucursal_id, cantidad_lb,
    cantidad_bruta_lb, cantidad_bandejas, peso_bandeja_lb, descuento_bandejas_lb, cantidad_total_lb,
    registrado_por, registrado_por_nombre, observacion
  )
  VALUES (
    p_desde_ambito, CASE WHEN v_es_central_desde THEN NULL ELSE p_desde_sucursal_id END,
    p_hasta_ambito, CASE WHEN v_es_central_hasta THEN NULL ELSE p_hasta_sucursal_id END,
    v_qty, v_bruta, v_bandejas, v_peso_bandeja, v_descuento, v_qty,
    v_actor, v_nombre, NULLIF(btrim(p_observacion),'')
  )
  RETURNING id INTO v_id;

  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('TRASLADO', p_desde_ambito, CASE WHEN v_es_central_desde THEN p_hasta_sucursal_id ELSE p_desde_sucursal_id END, v_qty, v_ant_desde, v_new_desde, 'traslado', v_id, v_actor, v_nombre,
    format('Salida por traslado: bruta %s lb, bandejas %s x %s lb = %s lb, total %s lb%s',
      trim(to_char(v_bruta,'FM999999990.999')), v_bandejas, trim(to_char(v_peso_bandeja,'FM999999990.999')),
      trim(to_char(v_descuento,'FM999999990.999')), trim(to_char(v_qty,'FM999999990.999')),
      COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));
  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('TRASLADO', p_hasta_ambito, CASE WHEN v_es_central_hasta THEN p_desde_sucursal_id ELSE p_hasta_sucursal_id END, v_qty, v_ant_hasta, v_new_hasta, 'traslado', v_id, v_actor, v_nombre,
    format('Ingreso por traslado: total %s lb%s', trim(to_char(v_qty,'FM999999990.999')), COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trasladar_pescado(text,uuid,text,uuid,numeric,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trasladar_pescado(text,uuid,text,uuid,numeric,text,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
