-- Formatea cantidades de stock en mensajes de error sin ceros sobrantes (1.000 → 1).

CREATE OR REPLACE FUNCTION public.inventario_movimiento_venta_internal(
  p_sucursal_id uuid,
  p_producto_id uuid,
  p_cantidad numeric,
  p_tipo_movimiento public.tipo_movimiento_inventario,
  p_order_id uuid,
  p_order_item_id uuid,
  p_origen_venta text,
  p_actor_id uuid,
  p_etiqueta_producto text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_motivo text;
  v_label text;
BEGIN
  IF NOT public.inventario_debe_controlar_venta(p_sucursal_id, p_producto_id) THEN
    RETURN;
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);
  IF v_cantidad <= 0 THEN
    RETURN;
  END IF;

  IF p_tipo_movimiento NOT IN ('INGRESO', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo de movimiento de venta no soportado: %', p_tipo_movimiento;
  END IF;

  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta_producto), ''),
    NULLIF(btrim(p.description), ''),
    NULLIF(btrim(oi.description_snapshot), ''),
    'Producto'
  )
  INTO v_label
  FROM public.products p
  LEFT JOIN public.order_items oi ON oi.id = p_order_item_id
  WHERE p.id = p_producto_id;

  v_label := COALESCE(v_label, 'Producto');

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_anterior := 0;
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      integra_con_ventas,
      activo
    )
    VALUES (p_producto_id, p_sucursal_id, 0, true, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_label,
        trim(both from to_char(v_anterior, 'FM999999999990.999')),
        trim(both from to_char(v_cantidad, 'FM999999999990.999'));
    END IF;
    v_nueva := v_anterior - v_cantidad;
    v_motivo := format('Venta (%s)', COALESCE(p_origen_venta, 'SALIDA'));
  ELSE
    v_nueva := v_anterior + v_cantidad;
    v_motivo := format('Devolución venta (%s)', COALESCE(p_origen_venta, 'INGRESO'));
  END IF;

  UPDATE public.inventario_productos
  SET cantidad_disponible = v_nueva
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  v_registrado_nombre := COALESCE(v_registrado_nombre, 'Usuario');

  INSERT INTO public.movimientos_inventario (
    producto_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre,
    order_id,
    order_item_id,
    origen_venta
  )
  VALUES (
    p_producto_id,
    p_sucursal_id,
    p_tipo_movimiento,
    v_cantidad,
    v_anterior,
    v_nueva,
    v_motivo,
    COALESCE(p_actor_id, auth.uid()),
    v_registrado_nombre,
    p_order_id,
    p_order_item_id,
    p_origen_venta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventario_movimiento_venta_internal(uuid, uuid, numeric, public.tipo_movimiento_inventario, uuid, uuid, text, uuid, text) FROM PUBLIC;
