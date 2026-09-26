-- Traslados bodega sucursal → nevera (una nevera por sucursal; sin selector).
-- Descuenta stock de bodega sucursal e ingresa stock en nevera (inventario_productos).

CREATE TABLE IF NOT EXISTS public.traslados_bodega_sucursal_nevera (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id),
  fecha_traslado date NOT NULL DEFAULT (CURRENT_DATE),
  observaciones text NULL,
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  registrado_por_nombre text NOT NULL DEFAULT 'Usuario',
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.traslados_bodega_sucursal_nevera IS
  'Encabezado de envíos desde bodega de sucursal hacia la nevera de la misma sucursal.';

CREATE TABLE IF NOT EXISTS public.traslados_bodega_sucursal_nevera_detalle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traslado_id uuid NOT NULL REFERENCES public.traslados_bodega_sucursal_nevera(id) ON DELETE CASCADE,
  producto_global_id uuid NOT NULL REFERENCES public.productos_globales(id),
  cantidad numeric(14, 3) NOT NULL
    CONSTRAINT traslados_bodega_sucursal_nevera_detalle_cantidad_chk
      CHECK (cantidad > 0 AND cantidad = trunc(cantidad)),
  CONSTRAINT traslados_bodega_sucursal_nevera_detalle_producto_uniq
    UNIQUE (traslado_id, producto_global_id)
);

COMMENT ON TABLE public.traslados_bodega_sucursal_nevera_detalle IS
  'Líneas de producto de un traslado de bodega sucursal a nevera.';

CREATE INDEX IF NOT EXISTS idx_traslados_bodega_sucursal_nevera_fecha
  ON public.traslados_bodega_sucursal_nevera (fecha_traslado DESC, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_traslados_bodega_sucursal_nevera_sucursal
  ON public.traslados_bodega_sucursal_nevera (sucursal_id);

CREATE INDEX IF NOT EXISTS idx_traslados_bodega_sucursal_nevera_detalle_traslado
  ON public.traslados_bodega_sucursal_nevera_detalle (traslado_id);

ALTER TABLE public.movimientos_bodega_sucursal
  ADD COLUMN IF NOT EXISTS traslado_nevera_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_bodega_sucursal_traslado_nevera_fk'
  ) THEN
    ALTER TABLE public.movimientos_bodega_sucursal
      ADD CONSTRAINT movimientos_bodega_sucursal_traslado_nevera_fk
      FOREIGN KEY (traslado_nevera_id)
      REFERENCES public.traslados_bodega_sucursal_nevera(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_sucursal_traslado_nevera
  ON public.movimientos_bodega_sucursal (traslado_nevera_id)
  WHERE traslado_nevera_id IS NOT NULL;

ALTER TABLE public.traslados_bodega_sucursal_nevera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traslados_bodega_sucursal_nevera_detalle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS traslados_bodega_sucursal_nevera_select ON public.traslados_bodega_sucursal_nevera;
CREATE POLICY traslados_bodega_sucursal_nevera_select
ON public.traslados_bodega_sucursal_nevera
FOR SELECT
TO authenticated
USING (
  public.can_operate_bodega_general(auth.uid())
  OR public.can_operate_bodega_sucursal(auth.uid(), sucursal_id)
);

DROP POLICY IF EXISTS traslados_bodega_sucursal_nevera_detalle_select
  ON public.traslados_bodega_sucursal_nevera_detalle;
CREATE POLICY traslados_bodega_sucursal_nevera_detalle_select
ON public.traslados_bodega_sucursal_nevera_detalle
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.traslados_bodega_sucursal_nevera t
    WHERE t.id = traslado_id
      AND (
        public.can_operate_bodega_general(auth.uid())
        OR public.can_operate_bodega_sucursal(auth.uid(), t.sucursal_id)
      )
  )
);

CREATE OR REPLACE FUNCTION public.registrar_traslado_bodega_sucursal_nevera(
  p_sucursal_id uuid,
  p_fecha_traslado date,
  p_detalle jsonb,
  p_observaciones text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_nombre text := 'Usuario';
  v_observaciones text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_traslado_id uuid;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric(14, 3);
  v_bodega_inv_id uuid;
  v_bodega_anterior numeric(14, 3);
  v_bodega_nueva numeric(14, 3);
  v_nevera_inv_id uuid;
  v_nevera_anterior numeric(14, 3);
  v_nevera_nueva numeric(14, 3);
  v_integra boolean := false;
  v_motivo_salida text;
  v_motivo_ingreso text;
  v_items int := 0;
  v_sucursal_nombre text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'sucursal_id es obligatorio';
  END IF;

  IF NOT public.can_operate_bodega_sucursal(v_actor_id, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos a nevera en esta sucursal';
  END IF;

  SELECT b.name INTO v_sucursal_nombre
  FROM public.branches b
  WHERE b.id = p_sucursal_id AND b.is_active = true;

  IF v_sucursal_nombre IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada o inactiva';
  END IF;

  IF p_fecha_traslado IS NULL THEN
    RAISE EXCEPTION 'La fecha del traslado es obligatoria';
  END IF;

  IF p_detalle IS NULL OR jsonb_typeof(p_detalle) <> 'array' OR jsonb_array_length(p_detalle) = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.username), ''), 'Usuario')
  INTO v_actor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_actor_id;

  INSERT INTO public.traslados_bodega_sucursal_nevera (
    sucursal_id,
    fecha_traslado,
    observaciones,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_sucursal_id,
    p_fecha_traslado,
    v_observaciones,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_traslado_id;

  v_motivo_salida := 'Envío a nevera';
  v_motivo_ingreso := 'Abastecimiento desde bodega sucursal';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_detalle)
  LOOP
    v_producto_id := NULLIF(v_item->>'producto_global_id', '')::uuid;
    v_cantidad := trunc(COALESCE((v_item->>'cantidad')::numeric, 0));

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'Producto inválido en el detalle del traslado';
    END IF;

    IF v_cantidad <= 0 OR v_cantidad <> trunc(v_cantidad) THEN
      RAISE EXCEPTION 'La cantidad debe ser un número entero mayor a 0';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.productos_globales pg WHERE pg.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto general no encontrado';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto no disponible en nevera (falta espejo en products)';
    END IF;

    v_items := v_items + 1;

    INSERT INTO public.traslados_bodega_sucursal_nevera_detalle (
      traslado_id,
      producto_global_id,
      cantidad
    )
    VALUES (v_traslado_id, v_producto_id, v_cantidad);

    -- Salida de bodega sucursal
    SELECT ibs.id, ibs.cantidad_disponible, ibs.integra_con_ventas
    INTO v_bodega_inv_id, v_bodega_anterior, v_integra
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.producto_global_id = v_producto_id
      AND ibs.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay stock en bodega sucursal para uno de los productos';
    END IF;

    v_bodega_anterior := COALESCE(v_bodega_anterior, 0);
    IF v_bodega_anterior < v_cantidad THEN
      RAISE EXCEPTION
        'Stock insuficiente en bodega sucursal. Disponible: %, solicitado: %',
        v_bodega_anterior,
        v_cantidad;
    END IF;

    v_bodega_nueva := v_bodega_anterior - v_cantidad;

    UPDATE public.inventario_bodega_sucursal
    SET cantidad_disponible = v_bodega_nueva,
        actualizado_en = now()
    WHERE id = v_bodega_inv_id;

    INSERT INTO public.movimientos_bodega_sucursal (
      producto_global_id,
      sucursal_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      registrado_por,
      registrado_por_nombre,
      traslado_nevera_id
    )
    VALUES (
      v_producto_id,
      p_sucursal_id,
      'SALIDA',
      v_cantidad,
      v_bodega_anterior,
      v_bodega_nueva,
      v_motivo_salida,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario'),
      v_traslado_id
    );

    -- Ingreso a nevera (inventario_productos; producto_id = producto_global_id)
    SELECT ip.id, ip.cantidad_disponible
    INTO v_nevera_inv_id, v_nevera_anterior
    FROM public.inventario_productos ip
    WHERE ip.producto_id = v_producto_id
      AND ip.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventario_productos (
        producto_id,
        sucursal_id,
        cantidad_disponible,
        integra_con_ventas,
        activo
      )
      VALUES (
        v_producto_id,
        p_sucursal_id,
        v_cantidad,
        COALESCE(v_integra, false),
        true
      )
      RETURNING id INTO v_nevera_inv_id;
      v_nevera_anterior := 0;
      v_nevera_nueva := v_cantidad;
    ELSE
      v_nevera_anterior := COALESCE(v_nevera_anterior, 0);
      v_nevera_nueva := v_nevera_anterior + v_cantidad;
      UPDATE public.inventario_productos
      SET cantidad_disponible = v_nevera_nueva,
          activo = true,
          actualizado_en = now()
      WHERE id = v_nevera_inv_id;
    END IF;

    INSERT INTO public.movimientos_inventario (
      producto_id,
      sucursal_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      registrado_por,
      registrado_por_nombre
    )
    VALUES (
      v_producto_id,
      p_sucursal_id,
      'INGRESO',
      v_cantidad,
      v_nevera_anterior,
      v_nevera_nueva,
      v_motivo_ingreso,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario')
    );
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  RETURN v_traslado_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_traslado_bodega_sucursal_nevera(uuid, date, jsonb, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_traslado_bodega_sucursal_nevera(uuid, date, jsonb, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
