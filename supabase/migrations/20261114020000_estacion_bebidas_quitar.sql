-- Quitar unidades agregadas por el lector, usando cantidad operativa (snapshot),
-- no order_items.quantity cruda (las anulaciones no siempre bajan ese campo).

CREATE OR REPLACE FUNCTION public.estacion_bebidas_quitar(
  p_id_orden uuid,
  p_id_producto uuid,
  p_cantidad integer,
  p_id_operacion uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $epulpo$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.operaciones_estacion_bebidas%ROWTYPE;
  v_need integer := GREATEST(1, LEAST(99, COALESCE(p_cantidad, 1)));
  v_left integer;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_take integer;
  v_available integer;
  v_desc text;
  v_unit numeric(12, 2) := 0;
  v_cancelled integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;
  IF p_id_orden IS NULL OR p_id_producto IS NULL THEN
    RAISE EXCEPTION 'Orden y producto son obligatorios';
  END IF;

  SELECT * INTO v_existing
  FROM public.operaciones_estacion_bebidas
  WHERE id = p_id_operacion;
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
    RAISE EXCEPTION 'Sin permiso para ajustar productos en esta sucursal';
  END IF;

  v_left := v_need;

  FOR v_row IN
    SELECT
      oi.id AS order_item_id,
      oi.description_snapshot,
      oi.unit_price,
      snap.quantity_pending_prepare,
      snap.quantity_ready_available,
      GREATEST(0, COALESCE(snap.quantity_dispatched_total, 0) - COALESCE(snap.quantity_cancelled_dispatched, 0)) AS dispatched_net
    FROM public.order_items oi
    JOIN public.operaciones_estacion_bebidas op
      ON op.id_order_item = oi.id
     AND op.id_orden = p_id_orden
     AND op.id_producto = p_id_producto
     AND op.tipo = 'agregar'
     AND op.estado = 'confirmada'
     AND NOT EXISTS (
       SELECT 1
       FROM public.operaciones_estacion_bebidas u
       WHERE u.id_operacion_origen = op.id
         AND u.tipo = 'deshacer'
         AND u.estado = 'confirmada'
     )
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.get_order_operational_snapshot(p_id_orden) s
      WHERE s.order_item_id = oi.id
      LIMIT 1
    ) snap ON true
    WHERE oi.order_id = p_id_orden
      AND oi.product_id = p_id_producto
      AND oi.status IS DISTINCT FROM 'DRAFT'
      AND oi.status IS DISTINCT FROM 'CANCELLED'
    ORDER BY oi.created_at DESC NULLS LAST, oi.id DESC
  LOOP
    EXIT WHEN v_left <= 0;

    v_available := GREATEST(
      0,
      COALESCE(v_row.quantity_pending_prepare, 0)
      + COALESCE(v_row.quantity_ready_available, 0)
      + COALESCE(v_row.dispatched_net, 0)
    );
    IF v_available <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_left, v_available);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_item_id', v_row.order_item_id,
      'quantity_cancelled', v_take
    ));
    v_desc := COALESCE(v_desc, v_row.description_snapshot);
    v_unit := COALESCE(v_row.unit_price, v_unit);
    v_left := v_left - v_take;
    v_cancelled := v_cancelled + v_take;
  END LOOP;

  IF v_cancelled <= 0 THEN
    RAISE EXCEPTION 'No hay unidades disponibles para quitar de este producto.';
  END IF;

  PERFORM public.cancel_order_quantities(
    p_id_orden,
    v_actor,
    'otro',
    format('Ajuste desde lector: quitar %s × %s', v_cancelled, COALESCE(v_desc, 'producto')),
    v_items,
    'partial',
    true
  );

  INSERT INTO public.operaciones_estacion_bebidas (
    id, id_sucursal, id_orden, id_producto, id_usuario, cantidad, tipo,
    id_order_item, codigo_barras, monto, estado, detalle
  ) VALUES (
    p_id_operacion,
    v_order.branch_id,
    v_order.id,
    p_id_producto,
    v_actor,
    v_cancelled,
    'deshacer',
    NULL,
    NULL,
    -ABS(round(COALESCE(v_unit, 0) * v_cancelled, 2)),
    'confirmada',
    jsonb_build_object(
      'fuente', 'lector-ajuste',
      'descripcion', v_desc,
      'items', v_items,
      'solicitado', v_need
    )
  );

  RETURN jsonb_build_object(
    'id_operacion', p_id_operacion,
    'duplicada', false,
    'id_orden', v_order.id,
    'id_producto', p_id_producto,
    'cantidad', v_cancelled,
    'descripcion', v_desc,
    'monto', -ABS(round(COALESCE(v_unit, 0) * v_cancelled, 2))
  );
END;
$epulpo$;

REVOKE ALL ON FUNCTION public.estacion_bebidas_quitar(uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estacion_bebidas_quitar(uuid, uuid, integer, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
