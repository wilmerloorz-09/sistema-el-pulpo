-- ==============================================================================
-- Migración: Monedero Promocional (Créditos independientes con caducidad - FIFO)
-- ==============================================================================

-- 1. Tabla de Créditos ("Bolsillos" independientes)
CREATE TABLE IF NOT EXISTS public.creditos_promocionales_clientes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    monto_inicial numeric(10, 2) NOT NULL,
    monto_disponible numeric(10, 2) NOT NULL,
    fecha_caducidad timestamptz NOT NULL,
    estado varchar(20) NOT NULL DEFAULT 'ACTIVO',
    orden_origen_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    campana_origen_id uuid REFERENCES public.campanas_promocionales(id) ON DELETE SET NULL,
    creado_el timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT creditos_promocionales_estado_chk CHECK (estado IN ('ACTIVO', 'AGOTADO', 'CADUCADO')),
    CONSTRAINT creditos_montos_chk CHECK (monto_disponible >= 0 AND monto_disponible <= monto_inicial)
);

COMMENT ON TABLE public.creditos_promocionales_clientes IS 'Premios ganados de forma individual (bolsillos de crédito) con fechas de caducidad independientes.';
CREATE INDEX idx_creditos_cliente_id ON public.creditos_promocionales_clientes(cliente_id);
CREATE INDEX idx_creditos_caducidad ON public.creditos_promocionales_clientes(fecha_caducidad);

-- 2. Tabla de Movimientos del Kardex
CREATE TABLE IF NOT EXISTS public.movimientos_creditos_clientes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credito_id uuid NOT NULL REFERENCES public.creditos_promocionales_clientes(id) ON DELETE CASCADE,
    monto_usado numeric(10, 2) NOT NULL,
    orden_pago_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    tipo_movimiento varchar(30) NOT NULL,
    creado_el timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movimientos_creditos_tipo_chk CHECK (tipo_movimiento IN ('CONSUMO', 'DEVOLUCION'))
);

COMMENT ON TABLE public.movimientos_creditos_clientes IS 'Historial detallado de cuánto se consumió/devolvió de cada bolsillo de crédito en particular.';
CREATE INDEX idx_movimientos_credito_id ON public.movimientos_creditos_clientes(credito_id);
CREATE INDEX idx_movimientos_orden_pago_id ON public.movimientos_creditos_clientes(orden_pago_id);

-- RLS
ALTER TABLE public.creditos_promocionales_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_creditos_clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creditos_select ON public.creditos_promocionales_clientes;
CREATE POLICY creditos_select
    ON public.creditos_promocionales_clientes FOR SELECT TO authenticated
    USING (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS movimientos_creditos_select ON public.movimientos_creditos_clientes;
CREATE POLICY movimientos_creditos_select
    ON public.movimientos_creditos_clientes FOR SELECT TO authenticated
    USING (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()));


-- 3. Función Calculada (Computed Column) para leer el saldo total activo fácilmente
CREATE OR REPLACE FUNCTION public.saldo_promocional(c public.clientes)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  -- Suma los montos disponibles de los créditos ACTIVOS que no han caducado
  SELECT COALESCE(SUM(monto_disponible), 0.00)
  FROM public.creditos_promocionales_clientes
  WHERE cliente_id = c.id
    AND estado = 'ACTIVO'
    AND monto_disponible > 0
    AND fecha_caducidad >= now();
$$;


-- 4. Método de Pago "Saldo Promocional"
DO $$
DECLARE
    v_branch_id uuid;
BEGIN
    FOR v_branch_id IN SELECT id FROM public.branches LOOP
        IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE branch_id = v_branch_id AND name = 'Saldo Promocional') THEN
            INSERT INTO public.payment_methods (branch_id, name, is_active)
            VALUES (v_branch_id, 'Saldo Promocional', true);
        END IF;
    END LOOP;
END;
$$;


-- 5. Modificar funciones de cierre de campaña
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
  v_pred record;
  v_monto_base numeric;
  v_monto_premio numeric;
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
    FOR v_pred IN (
        SELECT pc.id, pc.orden_id, pc.cliente_id
        FROM public.predicciones_clientes pc
        WHERE pc.campana_id = p_campana_id
          AND pc.estado_prediccion = 'PENDIENTE'
          AND pc.oferta_seleccionada_id = trim(p_oferta_id)
    ) LOOP
        -- Excluir Saldo Promocional de la base para el premio
        SELECT COALESCE(SUM(p.amount), 0) INTO v_monto_base
        FROM public.payments p
        JOIN public.payment_methods pm ON p.payment_method_id = pm.id
        WHERE p.order_id = v_pred.orden_id
          AND pm.name != 'Saldo Promocional';
        
        v_monto_premio := v_monto_base * (v_campana.porcentaje_descuento / 100.0);
        IF v_campana.descuento_maximo > 0 THEN
            v_monto_premio := LEAST(v_monto_premio, v_campana.descuento_maximo);
        END IF;

        UPDATE public.predicciones_clientes
        SET
          estado_prediccion = 'GANADA',
          codigo_cupon = public.generar_codigo_cupon_promocion(),
          fecha_caducidad_cupon = now() + make_interval(days => v_dias),
          monto_descuento_ganado = v_monto_premio
        WHERE id = v_pred.id;

        -- Crear el crédito si hay premio
        IF v_monto_premio > 0 THEN
            INSERT INTO public.creditos_promocionales_clientes 
                (cliente_id, monto_inicial, monto_disponible, fecha_caducidad, orden_origen_id, campana_origen_id)
            VALUES 
                (v_pred.cliente_id, v_monto_premio, v_monto_premio, now() + make_interval(days => v_dias), v_pred.orden_id, p_campana_id);
        END IF;

        v_actualizadas := v_actualizadas + 1;
    END LOOP;
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
  v_pred record;
  v_monto_base numeric;
  v_monto_premio numeric;
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

  -- Procesar ganadas
  FOR v_pred IN (
      SELECT pc.id, pc.orden_id, pc.cliente_id
      FROM public.predicciones_clientes pc
      WHERE pc.campana_id = p_campana_id
        AND pc.estado_prediccion = 'PENDIENTE'
        AND pc.oferta_seleccionada_id = ANY (v_ganadoras)
  ) LOOP
      SELECT COALESCE(SUM(p.amount), 0) INTO v_monto_base
      FROM public.payments p
      JOIN public.payment_methods pm ON p.payment_method_id = pm.id
      WHERE p.order_id = v_pred.orden_id
        AND pm.name != 'Saldo Promocional';
      
      v_monto_premio := v_monto_base * (v_campana.porcentaje_descuento / 100.0);
      IF v_campana.descuento_maximo > 0 THEN
          v_monto_premio := LEAST(v_monto_premio, v_campana.descuento_maximo);
      END IF;

      UPDATE public.predicciones_clientes
      SET
        estado_prediccion = 'GANADA',
        codigo_cupon = public.generar_codigo_cupon_promocion(),
        fecha_caducidad_cupon = now() + make_interval(days => v_dias),
        monto_descuento_ganado = v_monto_premio
      WHERE id = v_pred.id;

      -- Crear el crédito
      IF v_monto_premio > 0 THEN
          INSERT INTO public.creditos_promocionales_clientes 
              (cliente_id, monto_inicial, monto_disponible, fecha_caducidad, orden_origen_id, campana_origen_id)
          VALUES 
              (v_pred.cliente_id, v_monto_premio, v_monto_premio, now() + make_interval(days => v_dias), v_pred.orden_id, p_campana_id);
      END IF;

      v_actualizadas_ganadas := v_actualizadas_ganadas + 1;
  END LOOP;

  -- Procesar perdidas
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


-- 6. Lógica de Consumo FIFO (Trigger en payments)
CREATE OR REPLACE FUNCTION public.procesar_pago_saldo_fifo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pm_name text;
    v_cliente_id uuid;
    v_monto_restante numeric(10,2);
    v_credito record;
    v_monto_a_consumir numeric(10,2);
    v_mov record;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT name INTO v_pm_name FROM public.payment_methods WHERE id = NEW.payment_method_id;
        IF v_pm_name = 'Saldo Promocional' THEN
            SELECT cliente_id INTO v_cliente_id FROM public.orders WHERE id = NEW.order_id;
            
            IF v_cliente_id IS NULL THEN
                SELECT cliente_id INTO v_cliente_id FROM public.predicciones_clientes WHERE orden_id = NEW.order_id LIMIT 1;
            END IF;

            IF v_cliente_id IS NOT NULL THEN
                v_monto_restante := NEW.amount;
                
                -- Obtener los créditos activos que no han caducado, ordenados por fecha de caducidad (FIFO)
                FOR v_credito IN (
                    SELECT id, monto_disponible 
                    FROM public.creditos_promocionales_clientes
                    WHERE cliente_id = v_cliente_id 
                      AND estado = 'ACTIVO' 
                      AND monto_disponible > 0
                      AND fecha_caducidad >= now()
                    ORDER BY fecha_caducidad ASC, creado_el ASC
                    FOR UPDATE
                ) LOOP
                    IF v_monto_restante <= 0 THEN
                        EXIT; -- Ya terminamos de cobrar
                    END IF;

                    v_monto_a_consumir := LEAST(v_monto_restante, v_credito.monto_disponible);
                    
                    -- Descontar del crédito
                    UPDATE public.creditos_promocionales_clientes
                    SET monto_disponible = monto_disponible - v_monto_a_consumir,
                        estado = CASE WHEN monto_disponible - v_monto_a_consumir <= 0 THEN 'AGOTADO' ELSE 'ACTIVO' END
                    WHERE id = v_credito.id;

                    -- Registrar movimiento
                    INSERT INTO public.movimientos_creditos_clientes 
                        (credito_id, monto_usado, orden_pago_id, tipo_movimiento)
                    VALUES 
                        (v_credito.id, v_monto_a_consumir, NEW.order_id, 'CONSUMO');

                    v_monto_restante := v_monto_restante - v_monto_a_consumir;
                END LOOP;

                -- Si v_monto_restante > 0 después del loop, significa que se cobró más de lo que había disponible.
                -- Por lógica de caja esto no debería pasar si la UI restringe el monto, pero si pasa, 
                -- se permite (el pago se registra), pero no hay más créditos que descontar.
            END IF;
        END IF;
        RETURN NEW;
    
    ELSIF TG_OP = 'DELETE' THEN
        SELECT name INTO v_pm_name FROM public.payment_methods WHERE id = OLD.payment_method_id;
        IF v_pm_name = 'Saldo Promocional' THEN
            -- Cuando se anula el pago, buscamos los movimientos de consumo que se generaron para esta orden
            -- y devolvemos el dinero a los créditos originales.
            FOR v_mov IN (
                SELECT id, credito_id, monto_usado 
                FROM public.movimientos_creditos_clientes
                WHERE orden_pago_id = OLD.order_id AND tipo_movimiento = 'CONSUMO'
            ) LOOP
                -- Restauramos el saldo al crédito
                UPDATE public.creditos_promocionales_clientes
                SET monto_disponible = monto_disponible + v_mov.monto_usado,
                    estado = CASE WHEN fecha_caducidad < now() THEN 'CADUCADO' ELSE 'ACTIVO' END
                WHERE id = v_mov.credito_id;

                -- Registramos la devolución
                INSERT INTO public.movimientos_creditos_clientes 
                    (credito_id, monto_usado, orden_pago_id, tipo_movimiento)
                VALUES 
                    (v_mov.credito_id, v_mov.monto_usado, OLD.order_id, 'DEVOLUCION');
            END LOOP;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_procesar_pago_saldo_fifo ON public.payments;
CREATE TRIGGER trg_procesar_pago_saldo_fifo
  AFTER INSERT OR DELETE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.procesar_pago_saldo_fifo();

-- Opcional: Proceso automático para marcar créditos como CADUCADOS si la fecha pasó y siguen como ACTIVO.
-- Como no hay CRON en Supabase base sin pg_cron, se asume que la vista/cálculo ya filtra los >= now().
-- No obstante, si se necesita, se puede ejecutar mediante un script externo periódicamente.

NOTIFY pgrst, 'reload schema';
