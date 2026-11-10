-- Actualiza una preparación ya registrada (misma preparación, no un ingreso nuevo).
-- Revierte el efecto previo en stock fresco/central y aplica los nuevos valores.

CREATE OR REPLACE FUNCTION public.actualizar_ingreso_pescado(
  p_ingreso_id uuid,
  p_origen text,
  p_cantidad_entregada_lb numeric,
  p_cantidad_verificada_lb numeric,
  p_observacion text DEFAULT NULL::text,
  p_cantidad_bandejas integer DEFAULT 0,
  p_bonito_lb numeric DEFAULT 0,
  p_albacora_lb numeric DEFAULT 0,
  p_pesos_bandejas_lb numeric[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_old record;
  v_entregada numeric(14,3);
  v_verificada numeric(14,3);
  v_bandejas integer;
  v_peso_bandeja numeric(10,3) := 0.780;
  v_descuento numeric(14,3);
  v_total numeric(14,3);
  v_merma numeric(14,3);
  v_stock uuid;
  v_anterior numeric(14,3);
  v_nueva numeric(14,3);
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
  v_peso numeric;
  v_suma_bandejas numeric(14,3) := 0;
  v_modo_bandejas boolean := false;
  v_old_bonito numeric(14,3);
  v_old_albacora numeric(14,3);
  v_old_total numeric(14,3);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para actualizar ingresos de pescado';
  END IF;
  IF p_origen NOT IN ('PREPARACION_INICIAL','PREPARACION_EXTRA','OTROS') THEN
    RAISE EXCEPTION 'Origen de ingreso no válido';
  END IF;

  SELECT *
  INTO v_old
  FROM public.pescado_ingresos
  WHERE id = p_ingreso_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la preparación a actualizar';
  END IF;

  v_old_bonito := round(COALESCE(v_old.bonito_lb, 0)::numeric, 3);
  v_old_albacora := round(COALESCE(v_old.albacora_lb, 0)::numeric, 3);
  v_old_total := round(COALESCE(v_old.cantidad_total_lb, v_old.cantidad_verificada_lb, 0)::numeric, 3);

  v_entregada := round(COALESCE(p_cantidad_entregada_lb,0)::numeric,3);
  IF v_entregada <= 0 THEN RAISE EXCEPTION 'La cantidad entregada debe ser mayor a 0'; END IF;

  v_modo_bandejas := p_pesos_bandejas_lb IS NOT NULL AND cardinality(p_pesos_bandejas_lb) > 0;

  IF v_modo_bandejas THEN
    v_bandejas := cardinality(p_pesos_bandejas_lb);
    FOREACH v_peso IN ARRAY p_pesos_bandejas_lb LOOP
      IF COALESCE(v_peso, 0) <= 0 THEN
        RAISE EXCEPTION 'Cada bandeja debe tener un peso mayor a 0';
      END IF;
      v_suma_bandejas := v_suma_bandejas + round(v_peso::numeric, 3);
    END LOOP;
    v_verificada := round(v_suma_bandejas, 3);
    v_descuento := 0;
    v_total := v_verificada;
    v_peso_bandeja := round((v_verificada / v_bandejas)::numeric, 3);
  ELSE
    v_verificada := round(COALESCE(p_cantidad_verificada_lb,0)::numeric,3);
    v_bandejas := COALESCE(p_cantidad_bandejas,0);
    IF v_verificada <= 0 THEN RAISE EXCEPTION 'La cantidad verificada debe ser mayor a 0'; END IF;
    IF v_bandejas < 0 THEN RAISE EXCEPTION 'La cantidad de bandejas no puede ser negativa'; END IF;
    v_descuento := round((v_bandejas * v_peso_bandeja)::numeric,3);
    v_total := round((v_verificada - v_descuento)::numeric,3);
    IF v_total <= 0 THEN
      RAISE EXCEPTION 'La cantidad total debe ser mayor a 0 (verificada % lb - bandejas % lb)',
        trim(to_char(v_verificada,'FM999999990.999')), trim(to_char(v_descuento,'FM999999990.999'));
    END IF;
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

  INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
  VALUES (v_prod_bonito, 0)
  ON CONFLICT (producto_id) DO NOTHING;
  INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
  VALUES (v_prod_albacora, 0)
  ON CONFLICT (producto_id) DO NOTHING;

  -- Devolver stock fresco previo de esta preparación.
  IF v_old_bonito > 0 THEN
    SELECT cantidad_lb INTO v_ant_fresco
    FROM public.pescado_fresco_stock
    WHERE producto_id = v_prod_bonito
    FOR UPDATE;
    v_ant_fresco := COALESCE(v_ant_fresco, 0);
    v_nueva_fresco := v_ant_fresco + v_old_bonito;
    UPDATE public.pescado_fresco_stock
    SET cantidad_lb = v_nueva_fresco, actualizado_en = now()
    WHERE producto_id = v_prod_bonito;

    INSERT INTO public.pescado_fresco_movimientos (
      producto_id, tipo_movimiento, cantidad_lb, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, registrado_por_nombre
    )
    VALUES (
      v_prod_bonito, 'INGRESO', v_old_bonito, v_ant_fresco, v_nueva_fresco,
      format('Reverso preparación (ingreso %s)', p_ingreso_id::text),
      v_actor, v_nombre
    );
  END IF;

  IF v_old_albacora > 0 THEN
    SELECT cantidad_lb INTO v_ant_fresco
    FROM public.pescado_fresco_stock
    WHERE producto_id = v_prod_albacora
    FOR UPDATE;
    v_ant_fresco := COALESCE(v_ant_fresco, 0);
    v_nueva_fresco := v_ant_fresco + v_old_albacora;
    UPDATE public.pescado_fresco_stock
    SET cantidad_lb = v_nueva_fresco, actualizado_en = now()
    WHERE producto_id = v_prod_albacora;

    INSERT INTO public.pescado_fresco_movimientos (
      producto_id, tipo_movimiento, cantidad_lb, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, registrado_por_nombre
    )
    VALUES (
      v_prod_albacora, 'INGRESO', v_old_albacora, v_ant_fresco, v_nueva_fresco,
      format('Reverso preparación (ingreso %s)', p_ingreso_id::text),
      v_actor, v_nombre
    );
  END IF;

  -- Quitar del stock central el total previo.
  v_stock := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id = v_stock FOR UPDATE;
  v_anterior := COALESCE(v_anterior, 0);
  IF v_old_total > v_anterior THEN
    RAISE EXCEPTION 'No se puede revertir la preparación: stock central insuficiente';
  END IF;
  v_nueva := v_anterior - v_old_total;
  UPDATE public.pescado_stock_central SET cantidad_libras = v_nueva, updated_at = now() WHERE id = v_stock;

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  )
  VALUES (
    'SALIDA', 'CENTRAL', v_old_total, v_anterior, v_nueva, 'ingreso', p_ingreso_id, v_actor, v_nombre,
    format('Reverso preparación para actualización (%s lb)', trim(to_char(v_old_total,'FM999999990.999')))
  );

  -- Validar y aplicar nuevo crudo.
  IF v_requiere_crudo THEN
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

    IF v_bonito > 0 THEN
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
        format('Actualización preparación pescado cocido (ingreso %s)', p_ingreso_id::text),
        v_actor, v_nombre
      );
    END IF;

    IF v_albacora > 0 THEN
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
        format('Actualización preparación pescado cocido (ingreso %s)', p_ingreso_id::text),
        v_actor, v_nombre
      );
    END IF;
  END IF;

  -- Aplicar nuevo total cocinado a central.
  SELECT cantidad_libras INTO v_anterior FROM public.pescado_stock_central WHERE id = v_stock FOR UPDATE;
  v_anterior := COALESCE(v_anterior, 0);
  v_nueva := v_anterior + v_total;
  UPDATE public.pescado_stock_central SET cantidad_libras = v_nueva, updated_at = now() WHERE id = v_stock;

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  )
  VALUES (
    'INGRESO', 'CENTRAL', v_total, v_anterior, v_nueva, 'ingreso', p_ingreso_id, v_actor, v_nombre,
    format('Actualización preparación: %s bandejas, total %s lb',
      v_bandejas, trim(to_char(v_total,'FM999999990.999')))
  );

  UPDATE public.pescado_ingresos
  SET
    origen = p_origen,
    cantidad_entregada_lb = v_entregada,
    cantidad_verificada_lb = v_verificada,
    merma_lb = v_merma,
    cantidad_bandejas = v_bandejas,
    peso_bandeja_lb = v_peso_bandeja,
    descuento_bandejas_lb = v_descuento,
    cantidad_total_lb = v_total,
    bonito_lb = CASE WHEN v_requiere_crudo THEN v_bonito ELSE NULL END,
    albacora_lb = CASE WHEN v_requiere_crudo THEN v_albacora ELSE NULL END,
    observacion = NULLIF(btrim(p_observacion), '')
  WHERE id = p_ingreso_id;

  RETURN p_ingreso_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_ingreso_pescado(uuid, text, numeric, numeric, text, integer, numeric, numeric, numeric[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_ingreso_pescado(uuid, text, numeric, numeric, text, integer, numeric, numeric, numeric[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
