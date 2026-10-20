-- Gestion Pescado: descuento por bandejas en el ingreso.
-- Peso constante por bandeja: 0.78 lb. Cantidad total = verificada - bandejas*0.78.

ALTER TABLE public.pescado_ingresos
  ADD COLUMN IF NOT EXISTS cantidad_bandejas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peso_bandeja_lb numeric(10,3) NOT NULL DEFAULT 0.780,
  ADD COLUMN IF NOT EXISTS descuento_bandejas_lb numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_total_lb numeric(14,3);

UPDATE public.pescado_ingresos
SET cantidad_total_lb = cantidad_verificada_lb
WHERE cantidad_total_lb IS NULL;

ALTER TABLE public.pescado_ingresos
  DROP CONSTRAINT IF EXISTS pescado_ingresos_bandejas_chk;
ALTER TABLE public.pescado_ingresos
  ADD CONSTRAINT pescado_ingresos_bandejas_chk CHECK (cantidad_bandejas >= 0);

CREATE OR REPLACE FUNCTION public.registrar_ingreso_pescado(
  p_origen text,
  p_cantidad_entregada_lb numeric,
  p_cantidad_verificada_lb numeric,
  p_observacion text DEFAULT NULL,
  p_cantidad_bandejas integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_entregada numeric(14,3);
  v_verificada numeric(14,3);
  v_bandejas integer;
  v_peso_bandeja constant numeric(10,3) := 0.780;
  v_descuento numeric(14,3);
  v_total numeric(14,3);
  v_merma numeric(14,3);
  v_stock uuid;
  v_anterior numeric(14,3);
  v_nueva numeric(14,3);
  v_id uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN RAISE EXCEPTION 'No tienes permiso para registrar ingresos de pescado'; END IF;
  IF p_origen NOT IN ('PREPARACION_INICIAL','PREPARACION_EXTRA') THEN RAISE EXCEPTION 'Origen de ingreso no válido'; END IF;
  v_entregada := round(COALESCE(p_cantidad_entregada_lb,0)::numeric,3);
  v_verificada := round(COALESCE(p_cantidad_verificada_lb,0)::numeric,3);
  v_bandejas := COALESCE(p_cantidad_bandejas,0);
  IF v_entregada <= 0 THEN RAISE EXCEPTION 'La cantidad entregada debe ser mayor a 0'; END IF;
  IF v_verificada <= 0 THEN RAISE EXCEPTION 'La cantidad verificada debe ser mayor a 0'; END IF;
  IF v_bandejas < 0 THEN RAISE EXCEPTION 'La cantidad de bandejas no puede ser negativa'; END IF;

  v_descuento := round((v_bandejas * v_peso_bandeja)::numeric,3);
  v_total := round((v_verificada - v_descuento)::numeric,3);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'La cantidad total debe ser mayor a 0 (verificada % lb - bandejas % lb)',
      trim(to_char(v_verificada,'FM999999990.999')), trim(to_char(v_descuento,'FM999999990.999'));
  END IF;
  v_merma := v_entregada - v_verificada;
  v_nombre := public.pescado_nombre_actor(v_actor);

  INSERT INTO public.pescado_ingresos (
    origen, cantidad_entregada_lb, cantidad_verificada_lb, merma_lb,
    cantidad_bandejas, peso_bandeja_lb, descuento_bandejas_lb, cantidad_total_lb,
    registrado_por, registrado_por_nombre, observacion
  )
  VALUES (
    p_origen, v_entregada, v_verificada, v_merma,
    v_bandejas, v_peso_bandeja, v_descuento, v_total,
    v_actor, v_nombre, NULLIF(btrim(p_observacion),'')
  )
  RETURNING id INTO v_id;

  v_stock := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id=v_stock;
  v_anterior := COALESCE(v_anterior,0);
  v_nueva := v_anterior + v_total;
  UPDATE public.pescado_stock_central SET cantidad_libras=v_nueva, updated_at=now() WHERE id=v_stock;

  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('INGRESO','CENTRAL',v_total,v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
    format('Ingreso %s: entregada %s lb, verificada %s lb, bandejas %s x %s lb = %s lb, total %s lb%s',
      CASE p_origen WHEN 'PREPARACION_INICIAL' THEN 'preparación inicial' ELSE 'preparación extra' END,
      trim(to_char(v_entregada,'FM999999990.999')), trim(to_char(v_verificada,'FM999999990.999')),
      v_bandejas, trim(to_char(v_peso_bandeja,'FM999999990.999')), trim(to_char(v_descuento,'FM999999990.999')),
      trim(to_char(v_total,'FM999999990.999')),
      COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));

  IF v_merma <> 0 THEN
    INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
    VALUES ('MERMA','CENTRAL',abs(v_merma),v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
      format('Diferencia entregada-verificada: %s lb', trim(to_char(v_merma,'FM999999990.999'))));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_ingreso_pescado(text,numeric,numeric,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_pescado(text,numeric,numeric,text,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
