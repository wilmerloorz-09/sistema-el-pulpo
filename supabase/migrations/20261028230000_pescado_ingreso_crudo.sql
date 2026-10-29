-- Ingreso de pescado cocido: descuenta Bonito/Albacora (fresco) en preparación.
-- Validación: (bonito + albacora) > peso entregado; stock fresco suficiente.

ALTER TABLE public.pescado_ingresos
  ADD COLUMN IF NOT EXISTS bonito_lb numeric(14, 3) NULL
    CONSTRAINT pescado_ingresos_bonito_chk CHECK (bonito_lb IS NULL OR bonito_lb >= 0);

ALTER TABLE public.pescado_ingresos
  ADD COLUMN IF NOT EXISTS albacora_lb numeric(14, 3) NULL
    CONSTRAINT pescado_ingresos_albacora_chk CHECK (albacora_lb IS NULL OR albacora_lb >= 0);

COMMENT ON COLUMN public.pescado_ingresos.bonito_lb IS
  'Pescado crudo Bonito (lb) descontado de fresco en preparación inicial/extra.';
COMMENT ON COLUMN public.pescado_ingresos.albacora_lb IS
  'Pescado crudo Albacora (lb) descontado de fresco en preparación inicial/extra.';

DROP FUNCTION IF EXISTS public.registrar_ingreso_pescado(text, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.registrar_ingreso_pescado(text, numeric, numeric, text, integer);

CREATE OR REPLACE FUNCTION public.registrar_ingreso_pescado(
  p_origen text,
  p_cantidad_entregada_lb numeric,
  p_cantidad_verificada_lb numeric,
  p_observacion text DEFAULT NULL,
  p_cantidad_bandejas integer DEFAULT 0,
  p_bonito_lb numeric DEFAULT 0,
  p_albacora_lb numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_requiere_crudo boolean;
  v_bonito numeric(14,3);
  v_albacora numeric(14,3);
  v_crudo_total numeric(14,3);
  v_prod_bonito uuid;
  v_prod_albacora uuid;
  v_stock_bonito numeric(14,3);
  v_stock_albacora numeric(14,3);
  v_ant_fresco numeric(14,3);
  v_nueva_fresco numeric(14,3);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ingresos de pescado';
  END IF;
  IF p_origen NOT IN ('PREPARACION_INICIAL','PREPARACION_EXTRA','OTROS') THEN
    RAISE EXCEPTION 'Origen de ingreso no válido';
  END IF;

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

  v_requiere_crudo := p_origen IN ('PREPARACION_INICIAL','PREPARACION_EXTRA');
  v_bonito := round(COALESCE(p_bonito_lb,0)::numeric,3);
  v_albacora := round(COALESCE(p_albacora_lb,0)::numeric,3);

  IF NOT v_requiere_crudo THEN
    v_bonito := 0;
    v_albacora := 0;
  ELSE
    IF v_bonito < 0 OR v_albacora < 0 THEN
      RAISE EXCEPTION 'Las cantidades de pescado crudo no pueden ser negativas';
    END IF;
    v_crudo_total := round((v_bonito + v_albacora)::numeric,3);
    IF v_crudo_total <= 0 THEN
      RAISE EXCEPTION 'Ingresa la cantidad de pescado crudo (Bonito y/o Albacora)';
    END IF;
    IF v_crudo_total <= v_entregada THEN
      RAISE EXCEPTION
        'El pescado crudo (%s lb) debe ser mayor que el peso entregado (%s lb)',
        trim(to_char(v_crudo_total,'FM999999990.999')),
        trim(to_char(v_entregada,'FM999999990.999'));
    END IF;

    SELECT id INTO v_prod_bonito
    FROM public.pescado_fresco_productos
    WHERE codigo = 'BONITO' AND activo = true
    LIMIT 1;
    SELECT id INTO v_prod_albacora
    FROM public.pescado_fresco_productos
    WHERE codigo = 'ALBACORA' AND activo = true
    LIMIT 1;

    IF v_prod_bonito IS NULL OR v_prod_albacora IS NULL THEN
      RAISE EXCEPTION 'Catálogo de pescado fresco incompleto (Bonito/Albacora)';
    END IF;

    -- Asegurar filas de stock y bloquear
    INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
    VALUES (v_prod_bonito, 0)
    ON CONFLICT (producto_id) DO NOTHING;
    INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
    VALUES (v_prod_albacora, 0)
    ON CONFLICT (producto_id) DO NOTHING;

    SELECT cantidad_lb INTO v_stock_bonito
    FROM public.pescado_fresco_stock
    WHERE producto_id = v_prod_bonito
    FOR UPDATE;
    SELECT cantidad_lb INTO v_stock_albacora
    FROM public.pescado_fresco_stock
    WHERE producto_id = v_prod_albacora
    FOR UPDATE;

    v_stock_bonito := COALESCE(v_stock_bonito, 0);
    v_stock_albacora := COALESCE(v_stock_albacora, 0);

    IF v_bonito > v_stock_bonito THEN
      RAISE EXCEPTION
        'Stock insuficiente de Bonito: hay %s lb y se solicitan %s lb',
        trim(to_char(v_stock_bonito,'FM999999990.999')),
        trim(to_char(v_bonito,'FM999999990.999'));
    END IF;
    IF v_albacora > v_stock_albacora THEN
      RAISE EXCEPTION
        'Stock insuficiente de Albacora: hay %s lb y se solicitan %s lb',
        trim(to_char(v_stock_albacora,'FM999999990.999')),
        trim(to_char(v_albacora,'FM999999990.999'));
    END IF;
  END IF;

  INSERT INTO public.pescado_ingresos (
    origen, cantidad_entregada_lb, cantidad_verificada_lb, merma_lb,
    cantidad_bandejas, peso_bandeja_lb, descuento_bandejas_lb, cantidad_total_lb,
    bonito_lb, albacora_lb,
    registrado_por, registrado_por_nombre, observacion
  )
  VALUES (
    p_origen, v_entregada, v_verificada, v_merma,
    v_bandejas, v_peso_bandeja, v_descuento, v_total,
    CASE WHEN v_requiere_crudo THEN v_bonito ELSE NULL END,
    CASE WHEN v_requiere_crudo THEN v_albacora ELSE NULL END,
    v_actor, v_nombre, NULLIF(btrim(p_observacion),'')
  )
  RETURNING id INTO v_id;

  -- Descontar pescado fresco (crudo)
  IF v_requiere_crudo AND v_bonito > 0 THEN
    v_ant_fresco := v_stock_bonito;
    v_nueva_fresco := v_ant_fresco - v_bonito;
    UPDATE public.pescado_fresco_stock
    SET cantidad_lb = v_nueva_fresco, actualizado_en = now()
    WHERE producto_id = v_prod_bonito;

    INSERT INTO public.pescado_fresco_movimientos (
      producto_id, tipo_movimiento, cantidad_lb, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, registrado_por_nombre
    )
    VALUES (
      v_prod_bonito, 'SALIDA', v_bonito, v_ant_fresco, v_nueva_fresco,
      format('Preparación pescado cocido (ingreso %s)', v_id::text),
      v_actor, v_nombre
    );
  END IF;

  IF v_requiere_crudo AND v_albacora > 0 THEN
    v_ant_fresco := v_stock_albacora;
    v_nueva_fresco := v_ant_fresco - v_albacora;
    UPDATE public.pescado_fresco_stock
    SET cantidad_lb = v_nueva_fresco, actualizado_en = now()
    WHERE producto_id = v_prod_albacora;

    INSERT INTO public.pescado_fresco_movimientos (
      producto_id, tipo_movimiento, cantidad_lb, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, registrado_por_nombre
    )
    VALUES (
      v_prod_albacora, 'SALIDA', v_albacora, v_ant_fresco, v_nueva_fresco,
      format('Preparación pescado cocido (ingreso %s)', v_id::text),
      v_actor, v_nombre
    );
  END IF;

  v_stock := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id=v_stock;
  v_anterior := COALESCE(v_anterior,0);
  v_nueva := v_anterior + v_total;
  UPDATE public.pescado_stock_central SET cantidad_libras=v_nueva, updated_at=now() WHERE id=v_stock;

  INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
  VALUES ('INGRESO','CENTRAL',v_total,v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
    format('Ingreso %s: entregada %s lb, verificada %s lb, bandejas %s x %s lb = %s lb, total %s lb%s%s',
      CASE p_origen WHEN 'PREPARACION_INICIAL' THEN 'preparación inicial' WHEN 'PREPARACION_EXTRA' THEN 'preparación extra' ELSE 'otros' END,
      trim(to_char(v_entregada,'FM999999990.999')), trim(to_char(v_verificada,'FM999999990.999')),
      v_bandejas, trim(to_char(v_peso_bandeja,'FM999999990.999')), trim(to_char(v_descuento,'FM999999990.999')),
      trim(to_char(v_total,'FM999999990.999')),
      CASE WHEN v_requiere_crudo THEN
        format(', crudo Bonito %s lb + Albacora %s lb = %s lb',
          trim(to_char(v_bonito,'FM999999990.999')),
          trim(to_char(v_albacora,'FM999999990.999')),
          trim(to_char(v_bonito + v_albacora,'FM999999990.999')))
      ELSE '' END,
      COALESCE(' · ' || NULLIF(btrim(p_observacion),''),'')));

  IF v_merma <> 0 THEN
    INSERT INTO public.pescado_movimientos (tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva, referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas)
    VALUES ('MERMA','CENTRAL',abs(v_merma),v_anterior,v_nueva,'ingreso',v_id,v_actor,v_nombre,
      format('Diferencia entregada-verificada: %s lb', trim(to_char(v_merma,'FM999999990.999'))));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_ingreso_pescado(text, numeric, numeric, text, integer, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_pescado(text, numeric, numeric, text, integer, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
