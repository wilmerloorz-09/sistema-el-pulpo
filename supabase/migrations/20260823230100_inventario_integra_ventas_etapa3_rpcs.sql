-- Etapa 3 (continuación): parches RPC cancelación / cantidad / remove

CREATE OR REPLACE FUNCTION public.set_draft_order_item_quantity(
  p_item_id uuid,
  p_quantity integer,
  p_unit_price numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_effective_unit_price numeric;
  v_paid_qty integer := 0;
  v_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_dispatch_first boolean := false;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
  v_qty_to_cancel integer := 0;
  v_cancellation_id uuid;
  v_cancel_pending integer := 0;
  v_cancel_ready integer := 0;
  v_cancel_dispatched integer := 0;
  v_remaining integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
  END IF;

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_paid_qty := COALESCE(v_paid_qty, 0);

  IF v_item.status <> 'DRAFT' AND v_paid_qty > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
  END IF;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  IF v_item.status <> 'DRAFT' AND (p_quantity = 0 OR p_quantity < COALESCE(v_item.quantity, 0)) THEN
    SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
    INTO v_workflow_mode
    FROM public.branches b
    WHERE b.id = v_order.branch_id;

    v_dispatch_first :=
      v_order.order_type = 'EXPRESS'
      OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND COALESCE(v_order.order_type::text, '') <> 'TAKEOUT');

    IF v_dispatch_first THEN
      SELECT
        COALESCE(snapshot.quantity_pending_prepare, 0),
        COALESCE(snapshot.quantity_ready_available, 0),
        GREATEST(
          0,
          COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
        )
      INTO v_pending_prepare, v_ready_available, v_dispatched_net
      FROM public.get_order_operational_snapshot(v_order.id) snapshot
      WHERE snapshot.order_item_id = p_item_id;

      v_operational_active := v_pending_prepare + v_ready_available + v_dispatched_net;

      IF v_dispatched_net = 0 AND v_operational_active > 0 THEN
        IF p_quantity = 0 THEN
          v_qty_to_cancel := v_operational_active;
        ELSE
          v_qty_to_cancel := GREATEST(0, v_operational_active - p_quantity);
        END IF;

        IF v_qty_to_cancel <= 0 THEN
          RETURN;
        END IF;

        IF v_qty_to_cancel > v_operational_active THEN
          RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para este item.';
        END IF;

        INSERT INTO public.order_cancellations (
          order_id,
          cancellation_type,
          reason,
          notes,
          created_by,
          status,
          created_at
        ) VALUES (
          v_order.id,
          'partial',
          'Eliminado desde orden',
          NULL,
          v_actor_id,
          'APPLIED',
          v_now
        )
        RETURNING id INTO v_cancellation_id;

        v_cancel_pending := LEAST(v_qty_to_cancel, v_pending_prepare);
        v_remaining := GREATEST(0, v_qty_to_cancel - v_cancel_pending);
        v_cancel_ready := LEAST(v_remaining, v_ready_available);
        v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
        v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

        IF v_cancel_pending > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_pending,
            v_item.unit_price,
            ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
            'PENDING',
            v_now
          );
        END IF;

        IF v_cancel_ready > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_ready,
            v_item.unit_price,
            ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
            'READY',
            v_now
          );
        END IF;

        IF v_cancel_dispatched > 0 THEN
          INSERT INTO public.order_item_cancellations (
            order_cancellation_id,
            order_id,
            order_item_id,
            quantity_cancelled,
            unit_price,
            total_amount,
            source_stage,
            created_at
          ) VALUES (
            v_cancellation_id,
            v_order.id,
            p_item_id,
            v_cancel_dispatched,
            v_item.unit_price,
            ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
            'DISPATCHED',
            v_now
          );
        END IF;

        UPDATE public.orders
        SET cancel_requested_at = NULL,
            cancel_requested_by = NULL
        WHERE id = v_order.id;

        PERFORM public.inventario_restaurar_por_order_item(
          v_order.branch_id,
          p_item_id,
          v_qty_to_cancel,
          v_order.id,
          v_actor_id,
          'DIRECT_CANCEL'
        );

        PERFORM public.recompute_order_operational_state(v_order.id);
        PERFORM public.sync_order_payment_state_internal(v_order.id);
        RETURN;
      END IF;
    END IF;

    IF p_quantity = 0 THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    IF p_quantity < COALESCE(v_item.quantity, 0) THEN
      RAISE EXCEPTION 'Para reducir un item ya enviado usa el flujo de anulacion.';
    END IF;
  END IF;

  IF p_quantity = 0 THEN
    IF v_item.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Para eliminar un item ya enviado usa el flujo de anulacion.';
    END IF;

    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = p_item_id;

    DELETE FROM public.order_items
    WHERE id = p_item_id;

    PERFORM public.recompute_order_operational_state(v_order.id);
    RETURN;
  END IF;

  v_effective_unit_price := COALESCE(p_unit_price, v_item.unit_price);

  IF v_effective_unit_price IS NULL OR v_effective_unit_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor a 0.';
  END IF;

  IF v_item.status <> 'DRAFT' THEN
    SELECT
      COALESCE(snapshot.quantity_pending_prepare, 0)
      + COALESCE(snapshot.quantity_ready_available, 0)
      + GREATEST(
          0,
          COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
        )
    INTO v_operational_active
    FROM public.get_order_operational_snapshot(v_order.id) snapshot
    WHERE snapshot.order_item_id = p_item_id;

    v_operational_active := COALESCE(v_operational_active, 0);

    IF p_quantity > v_operational_active AND v_item.product_id IS NOT NULL THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_item.product_id,
        p_quantity - v_operational_active,
        'SALIDA'::public.tipo_movimiento_inventario,
        v_order.id,
        p_item_id,
        'AJUSTE_QTY',
        v_actor_id,
        v_item.description_snapshot
      );
    END IF;
  END IF;

  UPDATE public.order_items
  SET quantity = p_quantity,
      unit_price = v_effective_unit_price,
      total = ((p_quantity * v_effective_unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
  WHERE id = p_item_id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order_quantities(
  p_order_id uuid,
  p_cancelled_by uuid,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_cancellation_type text DEFAULT 'partial'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_cancellation_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_target_order_item_id uuid;
  v_target_qty integer;
  v_paid_qty integer;
  v_pending_prepare integer;
  v_ready_available integer;
  v_dispatched_net integer;
  v_unit_price numeric;
  v_current_item_status text;
  v_cancel_pending integer;
  v_cancel_ready integer;
  v_cancel_dispatched integer;
  v_remaining integer;
  v_actor_id uuid := auth.uid();
  v_gate record;
  v_has_direct_authority boolean := false;
  v_requires_authorization boolean := false;
  v_has_dispatched_targets boolean := false;
  v_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_dispatch_first boolean := false;
  v_skip_cancel_auth boolean := false;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de cancelacion';
  END IF;

  IF p_cancellation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de cancelacion invalido';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar al usuario autenticado';
  END IF;

  IF p_cancelled_by IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'El usuario autenticado no coincide con el usuario que intenta cancelar';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.status = 'PAID' THEN
    RAISE EXCEPTION 'No se puede cancelar una orden pagada';
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden ya esta cancelada';
  END IF;

  CREATE TEMP TABLE tmp_cancel_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_cancelled integer NOT NULL
  ) ON COMMIT DROP;

  IF p_cancellation_type = 'total' THEN
    INSERT INTO tmp_cancel_targets (order_item_id, quantity_cancelled)
    SELECT
      snapshot.order_item_id,
      snapshot.quantity_pending_prepare
      + snapshot.quantity_ready_available
      + GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched)
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.quantity_pending_prepare
      + snapshot.quantity_ready_available
      + GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched) > 0;
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para cancelacion parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_cancelled')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en cancelacion';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad de cancelacion invalida para item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_cancel_targets (order_item_id, quantity_cancelled)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_cancelled = tmp_cancel_targets.quantity_cancelled + EXCLUDED.quantity_cancelled;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_cancel_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para cancelar';
  END IF;

  SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
  INTO v_workflow_mode
  FROM public.branches b
  WHERE b.id = v_order.branch_id;

  v_dispatch_first :=
    v_order.order_type = 'EXPRESS'
    OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND COALESCE(v_order.order_type::text, '') <> 'TAKEOUT');

  SELECT EXISTS (
    SELECT 1
    FROM tmp_cancel_targets target
    JOIN public.get_order_operational_snapshot(p_order_id) snapshot
      ON snapshot.order_item_id = target.order_item_id
    WHERE GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched) > 0
  )
  INTO v_has_dispatched_targets;

  v_skip_cancel_auth :=
    v_order.status IN ('SENT_TO_KITCHEN', 'DRAFT')
    OR (v_dispatch_first AND NOT COALESCE(v_has_dispatched_targets, false));

  IF NOT v_skip_cancel_auth AND NOT public.can_manage_branch_admin(v_actor_id, v_order.branch_id) THEN
    SELECT *
    INTO v_gate
    FROM public.get_my_branch_shift_gate(v_order.branch_id)
    LIMIT 1;

    v_has_direct_authority :=
      COALESCE(v_gate.can_authorize_order_cancel, false)
      OR COALESCE(v_gate.is_supervisor, false);

    IF v_has_dispatched_targets THEN
      IF NOT v_has_direct_authority THEN
        RAISE EXCEPTION 'Esta anulacion requiere autorizacion';
      END IF;
    ELSIF NOT v_has_direct_authority THEN
      SELECT EXISTS (
        SELECT 1
        FROM tmp_cancel_targets target
        JOIN public.order_items oi
          ON oi.id = target.order_item_id
        LEFT JOIN LATERAL public.get_branch_cancel_policy_for_product(v_order.branch_id, oi.product_id) policy
          ON true
        WHERE oi.order_id = p_order_id
          AND NOT COALESCE(policy.allow_direct_cancel, false)
      )
      INTO v_requires_authorization;

      IF v_requires_authorization THEN
        RAISE EXCEPTION 'Esta anulacion requiere autorizacion';
      END IF;
    END IF;
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    SELECT
      snapshot.quantity_paid,
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched),
      snapshot.unit_price,
      snapshot.item_status
    INTO v_paid_qty, v_pending_prepare, v_ready_available, v_dispatched_net, v_unit_price, v_current_item_status
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_current_item_status IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_target_qty > (v_pending_prepare + v_ready_available + v_dispatched_net) THEN
      RAISE EXCEPTION 'No puedes cancelar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    IF v_current_item_status = 'PAID' OR v_paid_qty > 0 AND (v_pending_prepare + v_ready_available + v_dispatched_net) <= 0 THEN
      RAISE EXCEPTION 'No puedes cancelar un item ya pagado';
    END IF;
  END LOOP;

  INSERT INTO public.order_cancellations (
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    p_order_id,
    p_cancellation_type,
    btrim(p_reason),
    p_notes,
    p_cancelled_by,
    'APPLIED',
    v_now
  )
  RETURNING id INTO v_cancellation_id;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    SELECT
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      GREATEST(0, snapshot.quantity_dispatched_total - snapshot.quantity_cancelled_dispatched),
      snapshot.unit_price
    INTO v_pending_prepare, v_ready_available, v_dispatched_net, v_unit_price
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    WHERE snapshot.order_item_id = v_target_order_item_id;

    v_cancel_pending := LEAST(v_target_qty, v_pending_prepare);
    v_remaining := GREATEST(0, v_target_qty - v_cancel_pending);
    v_cancel_ready := LEAST(v_remaining, v_ready_available);
    v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
    v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

    IF v_cancel_pending > 0 THEN
      INSERT INTO public.order_item_cancellations (
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        v_cancellation_id,
        p_order_id,
        v_target_order_item_id,
        v_cancel_pending,
        v_unit_price,
        ROUND((v_cancel_pending * v_unit_price)::numeric, 2),
        'PENDING',
        v_now
      );
    END IF;

    IF v_cancel_ready > 0 THEN
      INSERT INTO public.order_item_cancellations (
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        v_cancellation_id,
        p_order_id,
        v_target_order_item_id,
        v_cancel_ready,
        v_unit_price,
        ROUND((v_cancel_ready * v_unit_price)::numeric, 2),
        'READY',
        v_now
      );
    END IF;

    IF v_cancel_dispatched > 0 THEN
      INSERT INTO public.order_item_cancellations (
        order_cancellation_id,
        order_id,
        order_item_id,
        quantity_cancelled,
        unit_price,
        total_amount,
        source_stage,
        created_at
      ) VALUES (
        v_cancellation_id,
        p_order_id,
        v_target_order_item_id,
        v_cancel_dispatched,
        v_unit_price,
        ROUND((v_cancel_dispatched * v_unit_price)::numeric, 2),
        'DISPATCHED',
        v_now
      );
    END IF;
  END LOOP;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_cancelled FROM tmp_cancel_targets
  LOOP
    PERFORM public.inventario_restaurar_por_order_item(
      v_order.branch_id,
      v_target_order_item_id,
      v_target_qty,
      p_order_id,
      v_actor_id,
      'CANCEL'
    );
  END LOOP;

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);

  RETURN v_cancellation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_order_item_line(
  p_item_id uuid,
  p_target_quantity integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_item public.order_items%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_paid_qty integer := 0;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_operational_active integer := 0;
  v_visible_qty integer := 0;
  v_qty_to_cancel integer := 0;
  v_cancellation_id uuid;
  v_cancel_pending integer := 0;
  v_cancel_ready integer := 0;
  v_cancel_dispatched integer := 0;
  v_remaining integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'El item es obligatorio.';
  END IF;

  IF p_target_quantity IS NULL OR p_target_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa.';
  END IF;

  SELECT *
  INTO v_item
  FROM public.order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_item.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se pueden modificar items de una orden cerrada.';
  END IF;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para modificar esta orden.';
  END IF;

  IF v_item.status = 'DRAFT' THEN
    IF p_target_quantity = 0 OR p_target_quantity < COALESCE(v_item.quantity, 0) THEN
      IF p_target_quantity = 0 THEN
        DELETE FROM public.order_item_modifiers WHERE order_item_id = p_item_id;
        DELETE FROM public.order_items WHERE id = p_item_id;
        PERFORM public.recompute_order_operational_state(v_order.id);
        RETURN;
      END IF;

      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;

      PERFORM public.recompute_order_operational_state(v_order.id);
      RETURN;
    END IF;

    IF p_target_quantity > COALESCE(v_item.quantity, 0) THEN
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;

    RETURN;
  END IF;

  SELECT COALESCE(snapshot.quantity_paid, 0)::int
  INTO v_paid_qty
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  IF COALESCE(v_paid_qty, 0) > 0 THEN
    RAISE EXCEPTION 'No se puede modificar un item que ya tiene pagos registrados.';
  END IF;

  SELECT
    COALESCE(snapshot.quantity_pending_prepare, 0),
    COALESCE(snapshot.quantity_ready_available, 0),
    GREATEST(
      0,
      COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
    )
  INTO v_pending_prepare, v_ready_available, v_dispatched_net
  FROM public.get_order_operational_snapshot(v_order.id) snapshot
  WHERE snapshot.order_item_id = p_item_id;

  v_operational_active := v_pending_prepare + v_ready_available + v_dispatched_net;
  v_visible_qty := v_operational_active;

  IF v_visible_qty <= 0 AND p_target_quantity <= 0 THEN
    RETURN;
  END IF;

  IF v_dispatched_net > 0 AND p_target_quantity < v_visible_qty THEN
    RAISE EXCEPTION 'No se puede eliminar un item ya despachado desde aqui.';
  END IF;

  IF p_target_quantity = 0 THEN
    v_qty_to_cancel := v_operational_active;
  ELSE
    v_qty_to_cancel := GREATEST(0, v_visible_qty - p_target_quantity);
  END IF;

  IF v_qty_to_cancel <= 0 THEN
    IF p_target_quantity > v_visible_qty AND v_item.product_id IS NOT NULL THEN
      PERFORM public.inventario_movimiento_venta_internal(
        v_order.branch_id,
        v_item.product_id,
        p_target_quantity - v_visible_qty,
        'SALIDA'::public.tipo_movimiento_inventario,
        v_order.id,
        p_item_id,
        'AJUSTE_QTY',
        v_actor_id,
        v_item.description_snapshot
      );
      UPDATE public.order_items
      SET quantity = p_target_quantity,
          total = ((p_target_quantity * v_item.unit_price) + COALESCE(v_item.tray_container_cost, 0))::numeric(10,2)
      WHERE id = p_item_id;
      PERFORM public.recompute_order_operational_state(v_order.id);
      PERFORM public.sync_order_payment_state_internal(v_order.id);
    END IF;
    RETURN;
  END IF;

  IF v_qty_to_cancel > v_operational_active THEN
    RAISE EXCEPTION 'No puedes eliminar mas cantidad de la disponible.';
  END IF;

  INSERT INTO public.order_cancellations (
    order_id,
    cancellation_type,
    reason,
    notes,
    created_by,
    status,
    created_at
  ) VALUES (
    v_order.id,
    'partial',
    'Eliminado desde orden',
    NULL,
    v_actor_id,
    'APPLIED',
    v_now
  )
  RETURNING id INTO v_cancellation_id;

  v_cancel_pending := LEAST(v_qty_to_cancel, v_pending_prepare);
  v_remaining := GREATEST(0, v_qty_to_cancel - v_cancel_pending);
  v_cancel_ready := LEAST(v_remaining, v_ready_available);
  v_remaining := GREATEST(0, v_remaining - v_cancel_ready);
  v_cancel_dispatched := LEAST(v_remaining, v_dispatched_net);

  IF v_cancel_pending > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_pending, v_item.unit_price,
      ROUND((v_cancel_pending * v_item.unit_price)::numeric, 2),
      'PENDING', v_now
    );
  END IF;

  IF v_cancel_ready > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_ready, v_item.unit_price,
      ROUND((v_cancel_ready * v_item.unit_price)::numeric, 2),
      'READY', v_now
    );
  END IF;

  IF v_cancel_dispatched > 0 THEN
    INSERT INTO public.order_item_cancellations (
      order_cancellation_id, order_id, order_item_id,
      quantity_cancelled, unit_price, total_amount, source_stage, created_at
    ) VALUES (
      v_cancellation_id, v_order.id, p_item_id,
      v_cancel_dispatched, v_item.unit_price,
      ROUND((v_cancel_dispatched * v_item.unit_price)::numeric, 2),
      'DISPATCHED', v_now
    );
  END IF;

  PERFORM public.inventario_restaurar_por_order_item(
    v_order.branch_id,
    p_item_id,
    v_qty_to_cancel,
    v_order.id,
    v_actor_id,
    'REMOVE_LINE'
  );

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = v_order.id;

  PERFORM public.recompute_order_operational_state(v_order.id);
  PERFORM public.sync_order_payment_state_internal(v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_draft_order_item_quantity(uuid, integer, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_quantities(uuid, uuid, text, text, jsonb, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.remove_order_item_line(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
