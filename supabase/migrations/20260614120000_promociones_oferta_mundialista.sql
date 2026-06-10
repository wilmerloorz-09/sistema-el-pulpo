-- Migración: Módulo de Promociones Oferta Mundialista

-- 1. Agregar columna token_promocion a la tabla orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS token_promocion text UNIQUE DEFAULT NULL;

COMMENT ON COLUMN public.orders.token_promocion IS 'Token alfanumérico único de 8 caracteres para que el comensal registre su predicción.';

-- 2. Función para generar un token de promoción único de 8 caracteres en mayúsculas
CREATE OR REPLACE FUNCTION public.generar_token_promocion_unico()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_token text;
  v_intentos integer := 0;
BEGIN
  LOOP
    v_intentos := v_intentos + 1;
    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders WHERE token_promocion = v_token
    );
    
    IF v_intentos > 100 THEN
      RAISE EXCEPTION 'No se pudo generar un token de promoción único tras 100 intentos.';
    END IF;
  END LOOP;
  RETURN v_token;
END;
$$;

-- 3. Trigger trigger y función para gestionar el token en las órdenes
CREATE OR REPLACE FUNCTION public.orden_promocion_token_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si pasa a estar pagado (PAID con paid_at asignado)
  IF NEW.status = 'PAID' AND NEW.paid_at IS NOT NULL THEN
    IF NEW.token_promocion IS NULL THEN
      NEW.token_promocion := public.generar_token_promocion_unico();
    END IF;
  -- Si deja de estar pagado (anulación o reversión de pago)
  ELSIF NEW.status <> 'PAID' OR NEW.paid_at IS NULL THEN
    NEW.token_promocion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_promocion_token_seguro ON public.orders;
CREATE TRIGGER trg_orden_promocion_token_seguro
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orden_promocion_token_trigger();

-- 4. Función de validación de token y registro de predicción / cliente de forma atómica
CREATE OR REPLACE FUNCTION public.validar_token_promocion_cliente(
  p_token_promocion text,
  p_campana_id uuid DEFAULT NULL,
  p_cliente_cedula varchar DEFAULT NULL,
  p_cliente_sexo char DEFAULT NULL,
  p_cliente_nombres varchar DEFAULT NULL,
  p_cliente_apellidos varchar DEFAULT NULL,
  p_cliente_celular varchar DEFAULT NULL,
  p_cliente_correo varchar DEFAULT NULL,
  p_cliente_direccion text DEFAULT NULL,
  p_oferta_seleccionada_id varchar DEFAULT NULL,
  p_registrar_prediccion boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orden record;
  v_campana record;
  v_total_monto numeric(10,2);
  v_cliente_id uuid;
  v_prediccion_id uuid;
BEGIN
  -- Normalizar parámetros de cliente si se suministraron
  p_cliente_cedula := NULLIF(trim(p_cliente_cedula), '');
  p_cliente_nombres := NULLIF(upper(trim(p_cliente_nombres)), '');
  p_cliente_apellidos := NULLIF(upper(trim(p_cliente_apellidos)), '');
  p_cliente_celular := NULLIF(trim(p_cliente_celular), '');
  p_cliente_correo := NULLIF(lower(trim(p_cliente_correo)), '');
  p_cliente_direccion := NULLIF(trim(p_cliente_direccion), '');
  p_oferta_seleccionada_id := NULLIF(trim(p_oferta_seleccionada_id), '');

  -- 1. Buscar orden por token
  SELECT id, status, paid_at, created_at, cliente_id INTO v_orden
  FROM public.orders
  WHERE token_promocion = p_token_promocion;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'El token de promoción no es válido o no existe.');
  END IF;

  -- 2. Validar fecha límite de 24 horas
  IF v_orden.created_at < (now() - INTERVAL '24 hours') THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'El token de promoción ha expirado (validez de 24 horas).');
  END IF;

  -- 3. Validar estado de pago de la orden
  IF v_orden.status IS DISTINCT FROM 'PAID' OR v_orden.paid_at IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'La orden asociada a este token aún no ha sido totalmente pagada.');
  END IF;

  -- 4. Validar monto superior a $0.00
  SELECT COALESCE(SUM(amount), 0) INTO v_total_monto
  FROM public.payments
  WHERE order_id = v_orden.id;

  IF v_total_monto <= 0.00 THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'La orden asociada no registra pagos mayores a $0.00.');
  END IF;

  -- 5. Validar que no haya sido usado ya en predicciones
  IF EXISTS (
    SELECT 1 FROM public.predicciones_clientes WHERE orden_id = v_orden.id
  ) THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'Esta promoción ya ha sido registrada previamente para esta orden.');
  END IF;

  -- Buscar si el cliente ya está vinculado por cédula o por la propia orden
  IF v_orden.cliente_id IS NOT NULL THEN
    v_cliente_id := v_orden.cliente_id;
  ELSIF p_cliente_cedula IS NOT NULL THEN
    SELECT id INTO v_cliente_id
    FROM public.clientes
    WHERE cedula = p_cliente_cedula;
  END IF;

  -- Si solo se desea validar el token, retornar estado de éxito
  IF NOT p_registrar_prediccion THEN
    RETURN jsonb_build_object(
      'valido', true,
      'mensaje', 'Token válido y disponible.',
      'orden_id', v_orden.id,
      'orden_total', v_total_monto,
      'cliente_existente', v_cliente_id IS NOT NULL,
      'cliente_id', v_cliente_id,
      'cliente_datos', CASE WHEN v_cliente_id IS NOT NULL THEN (
         SELECT jsonb_build_object(
           'cedula', c.cedula,
           'sexo', c.sexo,
           'nombres', c.nombres,
           'apellidos', c.apellidos,
           'celular', c.celular,
           'correo', c.correo,
           'direccion', c.direccion
         ) FROM public.clientes c WHERE c.id = v_cliente_id
      ) ELSE NULL END
    );
  END IF;

  -- VALIDACIONES PARA EL REGISTRO DE LA PREDICCIÓN
  IF p_campana_id IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'Debe seleccionar una campaña para registrar la predicción.');
  END IF;

  IF p_oferta_seleccionada_id IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'Debe seleccionar una oferta de la cartelera.');
  END IF;

  -- Validar campaña activa
  SELECT * INTO v_campana
  FROM public.campanas_promocionales
  WHERE id = p_campana_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'La campaña promocional seleccionada no existe.');
  END IF;

  IF NOT v_campana.activa THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'La campaña promocional seleccionada ya no se encuentra activa.');
  END IF;

  -- Validar que la oferta exista en la cartelera de la campaña
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_campana.cartelera_ofertas) AS elem
    WHERE elem->>'id_oferta' = p_oferta_seleccionada_id
  ) THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'La oferta seleccionada no forma parte de la cartelera de esta campaña.');
  END IF;

  -- Registrar o validar cliente
  IF v_cliente_id IS NULL THEN
    -- Validaciones estrictas de cliente nuevo
    IF p_cliente_cedula IS NULL OR NOT (p_cliente_cedula ~ '^[0-9]{10}$') THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'La cédula debe contener exactamente 10 dígitos numéricos.');
    END IF;
    IF p_cliente_celular IS NULL OR NOT (p_cliente_celular ~ '^[0-9]{10}$') THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'El celular debe contener exactamente 10 dígitos numéricos.');
    END IF;
    IF p_cliente_sexo IS NULL OR NOT (p_cliente_sexo IN ('M', 'F')) THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'El sexo del comensal debe ser M (Masculino) o F (Femenino).');
    END IF;
    IF p_cliente_nombres IS NULL OR NOT (p_cliente_nombres ~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$') THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'Los nombres solo deben contener letras.');
    END IF;
    IF p_cliente_apellidos IS NULL OR NOT (p_cliente_apellidos ~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$') THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'Los apellidos solo deben contener letras.');
    END IF;
    IF p_cliente_correo IS NOT NULL AND NOT (p_cliente_correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RETURN jsonb_build_object('valido', false, 'mensaje', 'El formato del correo electrónico es inválido.');
    END IF;

    -- Registrar cliente nuevo
    INSERT INTO public.clientes (
      cedula, sexo, nombres, apellidos, celular, correo, direccion, creado_el
    ) VALUES (
      p_cliente_cedula, p_cliente_sexo, p_cliente_nombres, p_cliente_apellidos, p_cliente_celular, p_cliente_correo, p_cliente_direccion, now()
    )
    RETURNING id INTO v_cliente_id;
  END IF;

  -- Registrar predicción
  INSERT INTO public.predicciones_clientes (
    id, campana_id, orden_id, cliente_id, oferta_seleccionada_id, estado_prediccion, creado_el
  ) VALUES (
    gen_random_uuid(), p_campana_id, v_orden.id, v_cliente_id, p_oferta_seleccionada_id, 'PENDIENTE', now()
  )
  RETURNING id INTO v_prediccion_id;

  -- Vincular cliente a la orden si no lo estaba
  IF v_orden.cliente_id IS NULL THEN
    UPDATE public.orders
    SET cliente_id = v_cliente_id
    WHERE id = v_orden.id;
  END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'mensaje', 'Predicción registrada exitosamente.',
    'orden_id', v_orden.id,
    'cliente_id', v_cliente_id,
    'prediccion_id', v_prediccion_id
  );
END;
$$;

-- 5. Función para listar campañas activas
CREATE OR REPLACE FUNCTION public.listar_campanas_activas()
RETURNS TABLE (
  id uuid,
  titulo varchar,
  consumo_minimo numeric,
  porcentaje_descuento numeric,
  descuento_maximo numeric,
  dias_vigencia_descuento integer,
  cartelera_ofertas jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, titulo, consumo_minimo, porcentaje_descuento, descuento_maximo, dias_vigencia_descuento, cartelera_ofertas
  FROM public.campanas_promocionales
  WHERE activa = true;
$$;

-- 6. Configurar permisos
REVOKE ALL ON FUNCTION public.validar_token_promocion_cliente(text, uuid, varchar, char, varchar, varchar, varchar, varchar, text, varchar, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_token_promocion_cliente(text, uuid, varchar, char, varchar, varchar, varchar, varchar, text, varchar, boolean) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.listar_campanas_activas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_campanas_activas() TO anon, authenticated;
