-- Estación de bebidas: mapeo de códigos de barras + operaciones idempotentes.
-- Aditivo y compatible con el POS (no renombra tablas existentes).

CREATE TABLE IF NOT EXISTS public.codigos_barras_bebidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_barras text NOT NULL,
  id_producto uuid NOT NULL REFERENCES public.products(id),
  id_nodo_menu uuid NULL REFERENCES public.menu_nodes(id),
  activo boolean NOT NULL DEFAULT true,
  fecha_registro timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT codigos_barras_bebidas_codigo_unique UNIQUE (codigo_barras)
);

CREATE INDEX IF NOT EXISTS idx_codigos_barras_bebidas_producto
  ON public.codigos_barras_bebidas (id_producto)
  WHERE activo;

CREATE TABLE IF NOT EXISTS public.operaciones_estacion_bebidas (
  id uuid PRIMARY KEY,
  id_sucursal uuid NOT NULL REFERENCES public.branches(id),
  id_orden uuid NOT NULL REFERENCES public.orders(id),
  id_producto uuid NOT NULL REFERENCES public.products(id),
  id_usuario uuid NOT NULL,
  cantidad integer NOT NULL CHECK (cantidad > 0 AND cantidad <= 99),
  tipo text NOT NULL CHECK (tipo IN ('agregar', 'deshacer')),
  id_operacion_origen uuid NULL REFERENCES public.operaciones_estacion_bebidas(id),
  id_order_item uuid NULL,
  codigo_barras text,
  monto numeric(12, 2),
  estado text NOT NULL DEFAULT 'confirmada',
  fecha_registro timestamptz NOT NULL DEFAULT now(),
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_operaciones_estacion_bebidas_orden_fecha
  ON public.operaciones_estacion_bebidas (id_orden, fecha_registro DESC);

CREATE INDEX IF NOT EXISTS idx_operaciones_estacion_bebidas_sucursal_fecha
  ON public.operaciones_estacion_bebidas (id_sucursal, fecha_registro DESC);

ALTER TABLE public.codigos_barras_bebidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operaciones_estacion_bebidas ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.codigos_barras_bebidas TO authenticated;
GRANT SELECT ON TABLE public.operaciones_estacion_bebidas TO authenticated;

GRANT SELECT ON public.codigos_barras_bebidas TO authenticated;
GRANT SELECT ON public.operaciones_estacion_bebidas TO authenticated;

DROP POLICY IF EXISTS codigos_barras_bebidas_select_auth ON public.codigos_barras_bebidas;
CREATE POLICY codigos_barras_bebidas_select_auth
  ON public.codigos_barras_bebidas
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS operaciones_estacion_bebidas_select_auth ON public.operaciones_estacion_bebidas;
CREATE POLICY operaciones_estacion_bebidas_select_auth
  ON public.operaciones_estacion_bebidas
  FOR SELECT TO authenticated
  USING (
    public.can_manage_branch_admin(auth.uid(), id_sucursal)
    OR public.has_branch_permission(auth.uid(), id_sucursal, 'orders', 'OPERATE')
    OR public.has_branch_permission(auth.uid(), id_sucursal, 'orders', 'VIEW')
  );

CREATE OR REPLACE FUNCTION public.estacion_bebidas_agregar_por_codigo(
  p_id_operacion uuid,
  p_id_orden uuid,
  p_codigo_barras text,
  p_cantidad integer DEFAULT 1,
  p_fuente text DEFAULT 'lector'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $epulpo$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_map public.codigos_barras_bebidas%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_menu public.menu_nodes%ROWTYPE;
  v_qty integer := GREATEST(1, LEAST(99, COALESCE(p_cantidad, 1)));
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_item_id uuid;
  v_precio numeric(12, 2);
  v_desc text;
  v_paid numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_was_paid boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;
  IF p_id_operacion IS NULL OR p_id_orden IS NULL THEN
    RAISE EXCEPTION 'Operación y orden son obligatorias';
  END IF;

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id_operacion', v_existing.id,
      'duplicada', true,
      'id_orden', v_existing.id_orden,
      'id_producto', v_existing.id_producto,
      'cantidad', v_existing.cantidad,
      'monto', v_existing.monto,
      'id_order_item', v_existing.id_order_item
    );
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id_orden FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.cancelled_at IS NOT NULL OR v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Esta orden está cerrada. Selecciona una orden abierta.';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor, v_order.branch_id)
    OR public.has_branch_permission(v_actor, v_order.branch_id, 'orders', 'OPERATE')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para modificar órdenes en esta sucursal';
  END IF;

  SELECT * INTO v_map
  FROM public.codigos_barras_bebidas
  WHERE codigo_barras = trim(COALESCE(p_codigo_barras, ''))
    AND activo IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código no encontrado o producto no habilitado para bebidas.';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_map.id_producto;
  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Producto no disponible.';
  END IF;

  IF v_map.id_nodo_menu IS NOT NULL THEN
    SELECT * INTO v_menu FROM public.menu_nodes WHERE id = v_map.id_nodo_menu;
    IF FOUND AND v_menu.branch_id IS DISTINCT FROM v_order.branch_id THEN
      RAISE EXCEPTION 'El producto no pertenece a la sucursal de la orden.';
    END IF;
  ELSE
    -- Preferir nodo activo de la sucursal para el producto legacy.
    SELECT * INTO v_menu
    FROM public.menu_nodes mn
    WHERE mn.branch_id = v_order.branch_id
      AND mn.is_active IS TRUE
      AND (mn.legacy_product_id = v_product.id OR mn.id = v_product.id)
    ORDER BY mn.display_order NULLS LAST, mn.created_at
    LIMIT 1;
  END IF;

  v_precio := COALESCE(v_menu.price, v_product.unit_price, 0);
  v_desc := COALESCE(NULLIF(trim(v_menu.name), ''), NULLIF(trim(v_product.description), ''), 'Bebida');

  v_was_paid := (v_order.status = 'PAID');
  IF v_was_paid THEN
    -- Reabrir operativamente para permitir saldo nuevo (p. ej. para llevar pagada).
    UPDATE public.orders
    SET status = 'SENT_TO_KITCHEN',
        updated_at = now()
    WHERE id = v_order.id;
  END IF;

  IF COALESCE(v_order.is_tray_order, false) THEN
    SELECT public.add_tray_order_item(
      v_order.id,
      v_product.id,
      v_qty,
      v_precio,
      'B',
      0,
      NULL,
      NULL
    ) INTO v_item_id;
  ELSE
    SELECT public.add_dine_in_order_item(
      v_order.id,
      v_product.id,
      v_menu.id,
      v_qty,
      v_precio,
      v_desc,
      NULL,
      NULL,
      NULL,
      0
    ) INTO v_item_id;
  END IF;

  -- Enviar borradores para que aparezcan de inmediato en el POS.
  PERFORM 1 FROM public.submit_order_draft_items(v_order.id);
  PERFORM 1 FROM public.sync_order_payment_state_internal(v_order.id);

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion,
    v_order.branch_id,
    v_order.id,
    v_product.id,
    v_actor,
    v_qty,
    'agregar',
    v_item_id,
    trim(p_codigo_barras),
    round(v_precio * v_qty, 2),
    'confirmada',
    jsonb_build_object(
      'fuente', COALESCE(p_fuente, 'lector'),
      'descripcion', v_desc,
      'precio_unitario', v_precio,
      'reabierta_desde_pagada', v_was_paid
    )
  );

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed');

  SELECT COALESCE(SUM(oi.total), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.status NOT IN ('DRAFT', 'CANCELLED');

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion,
    'duplicada', false,
    'id_orden', v_order.id,
    'id_producto', v_product.id,
    'descripcion', v_desc,
    'cantidad', v_qty,
    'monto', round(v_precio * v_qty, 2),
    'id_order_item', v_item_id,
    'total_orden', v_total,
    'pagado', v_paid,
    'saldo', GREATEST(0, v_total - v_paid)
  );
END;
$epulpo$;

CREATE OR REPLACE FUNCTION public.estacion_bebidas_deshacer(
  p_id_operacion uuid,
  p_id_orden uuid,
  p_id_operacion_nueva uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $epulpo$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_orig public.operaciones_estacion_bebidas%ROWTYPE;
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_target_qty integer;
  v_paid numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion_nueva;
  IF FOUND THEN
    RETURN jsonb_build_object('id_operacion', v_existing.id, 'duplicada', true);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id_orden FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.status = 'CANCELLED' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La orden está cerrada y no admite cambios.';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor, v_order.branch_id)
    OR public.has_branch_permission(v_actor, v_order.branch_id, 'orders', 'OPERATE')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para deshacer en esta sucursal';
  END IF;

  SELECT * INTO v_orig
  FROM public.operaciones_estacion_bebidas
  WHERE id_orden = p_id_orden
    AND tipo = 'agregar'
    AND estado = 'confirmada'
    AND NOT EXISTS (
      SELECT 1 FROM public.operaciones_estacion_bebidas u
      WHERE u.id_operacion_origen = operaciones_estacion_bebidas.id
        AND u.tipo = 'deshacer'
        AND u.estado = 'confirmada'
    )
  ORDER BY fecha_registro DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta orden no tiene lecturas para deshacer.';
  END IF;

  IF p_id_operacion IS NOT NULL AND v_orig.id IS DISTINCT FROM p_id_operacion THEN
    RAISE EXCEPTION 'La última lectura ya no coincide. Actualiza e intenta de nuevo.';
  END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = v_orig.id_order_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden cambió. No se puede deshacer esta lectura.';
  END IF;

  IF COALESCE(v_item.quantity, 0) < v_orig.cantidad THEN
    RAISE EXCEPTION 'La orden cambió. No se puede deshacer esta lectura.';
  END IF;

  v_target_qty := GREATEST(0, COALESCE(v_item.quantity, 0) - v_orig.cantidad);
  PERFORM public.remove_order_item_line(v_item.id, v_target_qty);
  PERFORM 1 FROM public.sync_order_payment_state_internal(v_order.id);

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_operacion_origen, id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion_nueva,
    v_order.branch_id,
    v_order.id,
    v_orig.id_producto,
    v_actor,
    v_orig.cantidad,
    'deshacer',
    v_orig.id,
    v_orig.id_order_item,
    v_orig.codigo_barras,
    -ABS(COALESCE(v_orig.monto, 0)),
    'confirmada',
    jsonb_build_object('deshace', v_orig.id)
  );

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed');

  SELECT COALESCE(SUM(oi.total), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.status NOT IN ('DRAFT', 'CANCELLED');

  IF v_total < v_paid THEN
    RAISE EXCEPTION 'No se puede deshacer: el pago supera el total resultante.';
  END IF;

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion_nueva,
    'duplicada', false,
    'id_orden', v_order.id,
    'cantidad', v_orig.cantidad,
    'monto', -ABS(COALESCE(v_orig.monto, 0)),
    'total_orden', v_total,
    'pagado', v_paid,
    'saldo', GREATEST(0, v_total - v_paid)
  );
END;
$epulpo$;

REVOKE ALL ON FUNCTION public.estacion_bebidas_agregar_por_codigo(uuid, uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_agregar_por_codigo(uuid, uuid, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.estacion_bebidas_deshacer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_deshacer(uuid, uuid, uuid) TO authenticated;

-- Semilla de códigos demo del prototipo → primer producto activo que coincida por nombre.
-- No inventa productos; solo mapea si ya existen en el POS.
WITH candidatos AS (
  SELECT * FROM (VALUES
    ('7861000100014', ARRAY['coca','cola']::text[]),
    ('7861000100021', ARRAY['agua']::text[]),
    ('7861000100038', ARRAY['club','verde','jugo']::text[]),
    ('7861000100045', ARRAY['cafe','café','té','te ']::text[]),
    ('7861000100052', ARRAY['7up','seven','sprite']::text[]),
    ('7861000100069', ARRAY['agua','gas']::text[])
  ) AS t(codigo, patrones)
),
elegidos AS (
  SELECT DISTINCT ON (c.codigo)
    c.codigo,
    p.id AS id_producto
  FROM candidatos c
  JOIN public.products p
    ON p.is_active IS TRUE
   AND EXISTS (
     SELECT 1
     FROM unnest(c.patrones) pat
     WHERE lower(COALESCE(p.description, '')) LIKE '%' || lower(pat) || '%'
   )
  ORDER BY c.codigo, p.description
)
INSERT INTO public.codigos_barras_bebidas (codigo_barras, id_producto, activo)
SELECT codigo, id_producto, true
FROM elegidos
ON CONFLICT (codigo_barras) DO UPDATE
SET id_producto = EXCLUDED.id_producto,
    activo = true;
