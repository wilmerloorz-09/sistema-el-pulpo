-- Gestion Pescado v2: ingreso/salida en Bodega General y traslados entre ubicaciones.
-- Stock canonico en libras. 1 lb = 453.59237 g (conversion en frontend).

CREATE TABLE IF NOT EXISTS public.pescado_ingresos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen text NOT NULL CONSTRAINT pescado_ingresos_origen_chk CHECK (origen IN ('PREPARACION_INICIAL','PREPARACION_EXTRA')),
  cantidad_entregada_lb numeric(14,3) NOT NULL CONSTRAINT pescado_ingresos_entregada_chk CHECK (cantidad_entregada_lb > 0),
  cantidad_verificada_lb numeric(14,3) NOT NULL CONSTRAINT pescado_ingresos_verificada_chk CHECK (cantidad_verificada_lb > 0),
  merma_lb numeric(14,3) NOT NULL DEFAULT 0,
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  observacion text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pescado_salidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cantidad_lb numeric(14,3) NOT NULL CONSTRAINT pescado_salidas_cantidad_chk CHECK (cantidad_lb > 0),
  motivo text NOT NULL CONSTRAINT pescado_salidas_motivo_chk CHECK (motivo IN ('DANO_PRODUCTO','OTROS')),
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  observacion text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pescado_traslados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desde_ambito text NOT NULL CONSTRAINT pescado_traslados_desde_chk CHECK (desde_ambito IN ('CENTRAL','SUCURSAL')),
  desde_sucursal_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  hasta_ambito text NOT NULL CONSTRAINT pescado_traslados_hasta_chk CHECK (hasta_ambito IN ('CENTRAL','SUCURSAL')),
  hasta_sucursal_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  cantidad_lb numeric(14,3) NOT NULL CONSTRAINT pescado_traslados_cantidad_chk CHECK (cantidad_lb > 0),
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  observacion text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_traslados_desde_sucursal_chk CHECK ((desde_ambito='CENTRAL' AND desde_sucursal_id IS NULL) OR (desde_ambito='SUCURSAL' AND desde_sucursal_id IS NOT NULL)),
  CONSTRAINT pescado_traslados_hasta_sucursal_chk CHECK ((hasta_ambito='CENTRAL' AND hasta_sucursal_id IS NULL) OR (hasta_ambito='SUCURSAL' AND hasta_sucursal_id IS NOT NULL))
);

ALTER TABLE public.pescado_movimientos DROP CONSTRAINT IF EXISTS pescado_movimientos_tipo_chk;
ALTER TABLE public.pescado_movimientos ADD CONSTRAINT pescado_movimientos_tipo_chk CHECK (tipo_movimiento IN ('INGRESO_RECEPCION','MERMA','ENVIO','DEVOLUCION','AJUSTE','INGRESO','SALIDA','TRASLADO'));

ALTER TABLE public.pescado_ingresos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_salidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_traslados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pescado_ingresos_select ON public.pescado_ingresos;
CREATE POLICY pescado_ingresos_select ON public.pescado_ingresos FOR SELECT TO authenticated USING (public.can_operate_gestion_pescado(auth.uid()));
DROP POLICY IF EXISTS pescado_salidas_select ON public.pescado_salidas;
CREATE POLICY pescado_salidas_select ON public.pescado_salidas FOR SELECT TO authenticated USING (public.can_operate_gestion_pescado(auth.uid()));
DROP POLICY IF EXISTS pescado_traslados_select ON public.pescado_traslados;
CREATE POLICY pescado_traslados_select ON public.pescado_traslados FOR SELECT TO authenticated USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR (desde_sucursal_id IS NOT NULL AND public.can_devolver_pescado_sucursal(auth.uid(), desde_sucursal_id))
  OR (hasta_sucursal_id IS NOT NULL AND public.can_devolver_pescado_sucursal(auth.uid(), hasta_sucursal_id))
);

CREATE OR REPLACE FUNCTION public.registrar_ingreso_pescado(
  p_origen text,
  p_cantidad_entregada_lb numeric,
  p_cantidad_verificada_lb numeric,
  p_observacion text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_entregada numeric(14,3);
  v_verificada numeric(14,3);
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
  IF v_entregada <= 0 THEN RAISE EXCEPTION 'La cantidad entregada debe ser mayor a 0'; END IF;
  IF v_verificada <= 0 THEN RAISE EXCEPTION 'La cantidad verificada debe ser mayor a 0'; END IF;
  v_merma := v_entregada - v_verificada;
  v_nombre := public.pescado_nombre_actor(v_actor);

  INSERT INTO public.pescado_ingresos (origen, cantidad_entregada_lb, cantidad_verificada_lb, merma_lb, registrado_por, registrado_por_nombre, observacion)
  VALUES (p_origen, v_entregada, v_verificada, v_merma, v_actor, v_nombre, NULLIF(btrim(p_observacion),''))
  RETURNING id INTO v_id;

  v_stock := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id=v_stock;
  v_anterior := COALESCE(v_anterior,0);
  v_nueva := v_anterior + v_verificada;
  UPDATE public.pescado_stock_central SET cantidad_libras=v_nueva, updated_at=now() WHERE id=v_stock;

  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('INGRESO','CENTRAL',v_verificada,v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
    format('Ingreso %s: entregada %s lb, verificada %s lb, diferencia %s lb%s',
      CASE p_origen WHEN 'PREPARACION_INICIAL' THEN 'preparación inicial' ELSE 'preparación extra' END,
      trim(to_char(v_entregada,'FM999999990.999')), trim(to_char(v_verificada,'FM999999990.999')), trim(to_char(v_merma,'FM999999990.999')),
      COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));

  IF v_merma <> 0 THEN
    INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
    VALUES ('MERMA','CENTRAL',abs(v_merma),v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
      format('Diferencia entregada-verificada: %s lb', trim(to_char(v_merma,'FM999999990.999'))));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_salida_pescado(
  p_cantidad_lb numeric,
  p_motivo text,
  p_observacion text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_qty numeric(14,3);
  v_stock uuid;
  v_anterior numeric(14,3);
  v_nueva numeric(14,3);
  v_id uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN RAISE EXCEPTION 'No tienes permiso para registrar salidas de pescado'; END IF;
  IF p_motivo NOT IN ('DANO_PRODUCTO','OTROS') THEN RAISE EXCEPTION 'Motivo de salida no válido'; END IF;
  v_qty := round(COALESCE(p_cantidad_lb,0)::numeric,3);
  IF v_qty <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  v_nombre := public.pescado_nombre_actor(v_actor);
  v_stock := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id=v_stock;
  v_anterior := COALESCE(v_anterior,0);
  IF v_anterior < v_qty THEN RAISE EXCEPTION 'Stock de Bodega General insuficiente. Disponible: % lb, solicitado: % lb', trim(to_char(v_anterior,'FM999999990.999')), trim(to_char(v_qty,'FM999999990.999')); END IF;
  v_nueva := v_anterior - v_qty;
  INSERT INTO public.pescado_salidas (cantidad_lb, motivo, registrado_por, registrado_por_nombre, observacion)
  VALUES (v_qty,p_motivo,v_actor,v_nombre,NULLIF(btrim(p_observacion),''))
  RETURNING id INTO v_id;
  UPDATE public.pescado_stock_central SET cantidad_libras=v_nueva, updated_at=now() WHERE id=v_stock;
  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('SALIDA','CENTRAL',v_qty,v_anterior,v_nueva,'salida',v_id,v_actor,v_nombre,
    format('Salida por %s%s', CASE p_motivo WHEN 'DANO_PRODUCTO' THEN 'daño del producto' ELSE 'otros' END, COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trasladar_pescado(
  p_desde_ambito text,
  p_desde_sucursal_id uuid,
  p_hasta_ambito text,
  p_hasta_sucursal_id uuid,
  p_cantidad_lb numeric,
  p_observacion text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
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

  v_qty := round(COALESCE(p_cantidad_lb,0)::numeric,3);
  IF v_qty <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
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

  INSERT INTO public.pescado_traslados (desde_ambito, desde_sucursal_id, hasta_ambito, hasta_sucursal_id, cantidad_lb, registrado_por, registrado_por_nombre, observacion)
  VALUES (p_desde_ambito, CASE WHEN v_es_central_desde THEN NULL ELSE p_desde_sucursal_id END, p_hasta_ambito, CASE WHEN v_es_central_hasta THEN NULL ELSE p_hasta_sucursal_id END, v_qty, v_actor, v_nombre, NULLIF(btrim(p_observacion),''))
  RETURNING id INTO v_id;

  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('TRASLADO', p_desde_ambito, CASE WHEN v_es_central_desde THEN p_hasta_sucursal_id ELSE p_desde_sucursal_id END, v_qty, v_ant_desde, v_new_desde, 'traslado', v_id, v_actor, v_nombre,
    format('Salida por traslado%s', COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));
  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('TRASLADO', p_hasta_ambito, CASE WHEN v_es_central_hasta THEN p_desde_sucursal_id ELSE p_hasta_sucursal_id END, v_qty, v_ant_hasta, v_new_hasta, 'traslado', v_id, v_actor, v_nombre,
    format('Ingreso por traslado%s', COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_stock_pescado()
RETURNS TABLE (ambito text, sucursal_id uuid, sucursal_nombre text, cantidad_libras numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT 'CENTRAL'::text AS ambito, NULL::uuid AS sucursal_id, 'Bodega General'::text AS sucursal_nombre, c.cantidad_libras
    FROM public.pescado_stock_central c WHERE c.codigo='PESCADO'
    UNION ALL
    SELECT 'SUCURSAL'::text, b.id, b.name, COALESCE(s.cantidad_libras,0)
    FROM public.branches b
    LEFT JOIN public.pescado_stock_sucursal s ON s.sucursal_id=b.id
    WHERE COALESCE(b.is_active,true)=true
  ) q ORDER BY CASE WHEN q.ambito='CENTRAL' THEN 0 ELSE 1 END, q.sucursal_nombre;
$$;

REVOKE ALL ON FUNCTION public.registrar_ingreso_pescado(text,numeric,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_pescado(text,numeric,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_salida_pescado(numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_salida_pescado(numeric,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.trasladar_pescado(text,uuid,text,uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trasladar_pescado(text,uuid,text,uuid,numeric,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
