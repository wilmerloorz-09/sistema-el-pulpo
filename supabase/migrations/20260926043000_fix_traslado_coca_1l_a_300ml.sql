-- Corrige traslado erróneo: 1 ud de Coca Cola 1 Litro → Coca Cola 300 ml
-- en El Pulpo 4 (Prueba), y ajusta stocks de bodega general / sucursal.

DO $$
DECLARE
  v_sucursal_id uuid := 'd6074413-8632-4984-9b16-2aa872629307'; -- El Pulpo 4 (Prueba)
  v_traslado_id uuid := '375eba3a-47f8-4c09-ae57-6afab4e3c1b6'; -- primer envío (1 ud)
  v_producto_1l uuid := '4447882f-8b6f-4ac9-8a9d-5735bf4cb96a'; -- Coca Cola 1 Litro
  v_producto_300 uuid := 'dc7b3f57-b21d-4040-97e1-ff34c3ecdc0d'; -- Coca Cola 300 ml
  v_cantidad numeric := 1;
  v_inv_general_1l uuid;
  v_inv_general_300 uuid;
  v_inv_suc_1l uuid;
  v_inv_suc_300 uuid;
  v_ant_general_1l numeric;
  v_ant_general_300 numeric;
  v_ant_suc_1l numeric;
  v_ant_suc_300 numeric;
BEGIN
  -- Verificar que el traslado erróneo existe y apunta a 1 Litro.
  IF NOT EXISTS (
    SELECT 1
    FROM public.traslados_bodega_general_detalle d
    WHERE d.traslado_id = v_traslado_id
      AND d.producto_global_id = v_producto_1l
      AND d.cantidad = v_cantidad
  ) THEN
    RAISE NOTICE 'No se encontró el detalle a corregir; se omite ajuste de datos.';
    RETURN;
  END IF;

  -- 1) Detalle del traslado: cambiar producto a 300 ml
  UPDATE public.traslados_bodega_general_detalle
  SET producto_global_id = v_producto_300
  WHERE traslado_id = v_traslado_id
    AND producto_global_id = v_producto_1l;

  -- 2) Movimientos de bodega general ligados al traslado
  UPDATE public.movimientos_bodega_general
  SET producto_global_id = v_producto_300,
      motivo = 'Envío a sucursal El Pulpo 4 (Prueba)'
  WHERE traslado_id = v_traslado_id
    AND producto_global_id = v_producto_1l;

  -- 3) Revertir salida en bodega general de 1 Litro (+1)
  SELECT id, cantidad_disponible
  INTO v_inv_general_1l, v_ant_general_1l
  FROM public.inventario_bodega_general
  WHERE producto_global_id = v_producto_1l
  FOR UPDATE;

  IF v_inv_general_1l IS NOT NULL THEN
    UPDATE public.inventario_bodega_general
    SET cantidad_disponible = COALESCE(v_ant_general_1l, 0) + v_cantidad,
        actualizado_en = now()
    WHERE id = v_inv_general_1l;
  END IF;

  -- 4) Aplicar salida en bodega general de 300 ml (-1)
  SELECT id, cantidad_disponible
  INTO v_inv_general_300, v_ant_general_300
  FROM public.inventario_bodega_general
  WHERE producto_global_id = v_producto_300
  FOR UPDATE;

  IF v_inv_general_300 IS NULL THEN
    INSERT INTO public.inventario_bodega_general (producto_global_id, cantidad_disponible, activo)
    VALUES (v_producto_300, 0, true)
    RETURNING id, cantidad_disponible INTO v_inv_general_300, v_ant_general_300;
  END IF;

  IF COALESCE(v_ant_general_300, 0) < v_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en bodega general para Coca Cola 300 ml al corregir';
  END IF;

  UPDATE public.inventario_bodega_general
  SET cantidad_disponible = COALESCE(v_ant_general_300, 0) - v_cantidad,
      actualizado_en = now()
  WHERE id = v_inv_general_300;

  -- 5) Bodega sucursal: bajar 1 Litro (-1) y subir 300 ml (+1)
  SELECT id, cantidad_disponible
  INTO v_inv_suc_1l, v_ant_suc_1l
  FROM public.inventario_bodega_sucursal
  WHERE producto_global_id = v_producto_1l
    AND sucursal_id = v_sucursal_id
  FOR UPDATE;

  IF v_inv_suc_1l IS NOT NULL THEN
    UPDATE public.inventario_bodega_sucursal
    SET cantidad_disponible = GREATEST(0, COALESCE(v_ant_suc_1l, 0) - v_cantidad),
        actualizado_en = now()
    WHERE id = v_inv_suc_1l;
  END IF;

  SELECT id, cantidad_disponible
  INTO v_inv_suc_300, v_ant_suc_300
  FROM public.inventario_bodega_sucursal
  WHERE producto_global_id = v_producto_300
    AND sucursal_id = v_sucursal_id
  FOR UPDATE;

  IF v_inv_suc_300 IS NULL THEN
    INSERT INTO public.inventario_bodega_sucursal (
      producto_global_id, sucursal_id, cantidad_disponible, activo
    )
    VALUES (v_producto_300, v_sucursal_id, v_cantidad, true);
  ELSE
    UPDATE public.inventario_bodega_sucursal
    SET cantidad_disponible = COALESCE(v_ant_suc_300, 0) + v_cantidad,
        activo = true,
        actualizado_en = now()
    WHERE id = v_inv_suc_300;
  END IF;

  -- 6) Ajustar cantidades_anterior/nueva del movimiento corregido (aprox. coherente)
  UPDATE public.movimientos_bodega_general m
  SET cantidad_anterior = COALESCE(v_ant_general_300, 0),
      cantidad_nueva = COALESCE(v_ant_general_300, 0) - v_cantidad,
      cantidad_movimiento = v_cantidad
  WHERE m.traslado_id = v_traslado_id
    AND m.producto_global_id = v_producto_300;
END $$;

NOTIFY pgrst, 'reload schema';
