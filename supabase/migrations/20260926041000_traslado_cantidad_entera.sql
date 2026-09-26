-- Cantidad de traslados a sucursal: solo enteros.

CREATE OR REPLACE FUNCTION public.registrar_traslado_bodega_general(
  p_sucursal_destino_id uuid,
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
  v_inventario_id uuid;
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_sucursal_inv_id uuid;
  v_sucursal_anterior numeric(14, 3);
  v_motivo text;
  v_items int := 0;
  v_sucursal_nombre text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_bodega_general(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos a sucursal';
  END IF;

  IF p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar la sucursal destino';
  END IF;

  SELECT b.name INTO v_sucursal_nombre
  FROM public.branches b
  WHERE b.id = p_sucursal_destino_id AND b.is_active = true;

  IF v_sucursal_nombre IS NULL THEN
    RAISE EXCEPTION 'Sucursal destino no encontrada o inactiva';
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

  INSERT INTO public.traslados_bodega_general (
    sucursal_destino_id,
    fecha_traslado,
    observaciones,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_sucursal_destino_id,
    p_fecha_traslado,
    v_observaciones,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_traslado_id;

  v_motivo := 'Envío a sucursal ' || v_sucursal_nombre;

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

    v_items := v_items + 1;

    INSERT INTO public.traslados_bodega_general_detalle (
      traslado_id,
      producto_global_id,
      cantidad
    )
    VALUES (v_traslado_id, v_producto_id, v_cantidad);

    SELECT ibg.id, ibg.cantidad_disponible
    INTO v_inventario_id, v_anterior
    FROM public.inventario_bodega_general ibg
    WHERE ibg.producto_global_id = v_producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay stock en bodega general para uno de los productos';
    END IF;

    v_anterior := COALESCE(v_anterior, 0);
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en bodega general. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;

    v_nueva := v_anterior - v_cantidad;

    UPDATE public.inventario_bodega_general
    SET cantidad_disponible = v_nueva,
        actualizado_en = now()
    WHERE id = v_inventario_id;

    INSERT INTO public.movimientos_bodega_general (
      producto_global_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      sucursal_destino_id,
      registrado_por,
      registrado_por_nombre,
      traslado_id
    )
    VALUES (
      v_producto_id,
      'SALIDA',
      v_cantidad,
      v_anterior,
      v_nueva,
      v_motivo,
      p_sucursal_destino_id,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario'),
      v_traslado_id
    );

    SELECT ibs.id, ibs.cantidad_disponible
    INTO v_sucursal_inv_id, v_sucursal_anterior
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.producto_global_id = v_producto_id
      AND ibs.sucursal_id = p_sucursal_destino_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventario_bodega_sucursal (
        producto_global_id,
        sucursal_id,
        cantidad_disponible,
        activo
      )
      VALUES (v_producto_id, p_sucursal_destino_id, v_cantidad, true)
      RETURNING id INTO v_sucursal_inv_id;
    ELSE
      UPDATE public.inventario_bodega_sucursal
      SET cantidad_disponible = COALESCE(v_sucursal_anterior, 0) + v_cantidad,
          activo = true,
          actualizado_en = now()
      WHERE id = v_sucursal_inv_id;
    END IF;
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  RETURN v_traslado_id;
END;
$$;

ALTER TABLE public.traslados_bodega_general_detalle
  DROP CONSTRAINT IF EXISTS traslados_bodega_general_detalle_cantidad_chk;

ALTER TABLE public.traslados_bodega_general_detalle
  ADD CONSTRAINT traslados_bodega_general_detalle_cantidad_chk
  CHECK (cantidad > 0 AND cantidad = trunc(cantidad));

NOTIFY pgrst, 'reload schema';
