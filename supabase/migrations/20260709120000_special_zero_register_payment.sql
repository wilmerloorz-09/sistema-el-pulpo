-- Registra pago $0 en payments para órdenes especiales autopagadas (reportes de turno y generales).

CREATE OR REPLACE FUNCTION public.autopagar_orden_especial_cero_interna(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := COALESCE(p_actor_id, auth.uid());
  v_now timestamptz := COALESCE(p_recorded_at, now());
  v_payment_id uuid;
  v_payment_method_id uuid;
  v_group_id text;
  v_existing_payment_id uuid;
  v_shift_id uuid;
  v_item record;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE
     OR v_order.special_total_manual IS NULL
     OR v_order.special_total_manual <> 0 THEN
    RETURN NULL;
  END IF;

  v_actor_id := COALESCE(v_actor_id, v_order.created_by);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el usuario del autopago';
  END IF;

  SELECT p.id
  INTO v_existing_payment_id
  FROM public.payments p
  WHERE p.order_id = p_order_id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1;

  IF v_existing_payment_id IS NULL THEN
    SELECT pm.id
    INTO v_payment_method_id
    FROM public.payment_methods pm
    WHERE pm.branch_id = v_order.branch_id
      AND pm.is_active IS TRUE
      AND lower(trim(pm.name)) IN ('efectivo', 'cash')
    ORDER BY pm.name
    LIMIT 1;

    IF v_payment_method_id IS NULL THEN
      SELECT pm.id
      INTO v_payment_method_id
      FROM public.payment_methods pm
      WHERE pm.branch_id = v_order.branch_id
        AND pm.is_active IS TRUE
      ORDER BY pm.name
      LIMIT 1;
    END IF;

    IF v_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'No hay metodo de pago activo en la sucursal';
    END IF;

    v_payment_id := gen_random_uuid();
    v_group_id := replace(v_payment_id::text, '-', '');
    v_shift_id := COALESCE(
      v_order.cash_shift_id,
      public.infer_payment_shift_id(p_order_id, v_now, false)
    );

    INSERT INTO public.payments (
      id,
      order_id,
      payment_method_id,
      amount,
      change_amount,
      notes,
      created_by,
      created_at,
      status,
      shift_id
    ) VALUES (
      v_payment_id,
      p_order_id,
      v_payment_method_id,
      0,
      0,
      format(
        'GROUP:%s|ITEMS_ANCHOR:1|TENDERED:0.00|APPLIED:0.00|SPECIAL_ORDER:1|AUTOPAY_SPECIAL_ZERO:1',
        v_group_id
      ),
      v_actor_id,
      v_now,
      'active',
      v_shift_id
    );

    FOR v_item IN
      SELECT oi.id, oi.quantity, oi.unit_price
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.status NOT IN ('DRAFT', 'CANCELLED')
        AND COALESCE(oi.quantity, 0) > 0
    LOOP
      INSERT INTO public.payment_items (
        id,
        payment_id,
        order_item_id,
        quantity_paid,
        unit_price,
        total_amount
      ) VALUES (
        gen_random_uuid(),
        v_payment_id,
        v_item.id,
        GREATEST(0, COALESCE(v_item.quantity, 0)),
        COALESCE(v_item.unit_price, 0),
        0
      );
    END LOOP;
  ELSE
    v_payment_id := v_existing_payment_id;
  END IF;

  UPDATE public.orders o
  SET
    status = 'PAID'::public.order_status,
    paid_at = COALESCE(o.paid_at, v_now),
    updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.sync_order_payment_state_internal(p_order_id);

  RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_order_draft_items(
  p_order_id uuid
)
RETURNS TABLE (
  order_id uuid,
  order_status public.order_status,
  submitted_item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_branch_token text;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_especial_cero boolean := false;
  v_autopagar_al_enviar boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'KITCHEN_DISPATCHED', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  SELECT COALESCE(b.workflow_mode, 'CASH_THEN_DISPATCH')
  INTO v_workflow_mode
  FROM public.branches b
  WHERE b.id = v_order.branch_id;

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
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_especial_cero := COALESCE(v_order.is_special, false)
    AND v_order.special_total_manual IS NOT NULL
    AND v_order.special_total_manual = 0;

  v_autopagar_al_enviar := v_especial_cero
    AND v_workflow_mode = 'CASH_THEN_DISPATCH';

  v_next_status := 'SENT_TO_KITCHEN'::public.order_status;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_number IS NULL THEN
    v_new_order_number := nextval('orders_order_number_seq');
  END IF;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
      INTO v_branch_token
    FROM public.branches
    WHERE id = v_order.branch_id;

    v_date_part := to_char(COALESCE(v_order.created_at, v_now) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

    LOOP
      v_try := v_try + 1;
      v_seq := public.next_human_sequence('orders_daily', v_order.branch_id, v_date_part);
      v_new_order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.order_code = v_new_order_code
      );

      IF v_try >= 50 THEN
        RAISE EXCEPTION 'No se pudo generar order_code unico';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = NULL,
    dispatched_at = NULL,
    updated_at = v_now
  WHERE o.id = p_order_id;

  IF v_autopagar_al_enviar THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, v_actor_id);
    SELECT o.status INTO v_next_status FROM public.orders o WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_order_quantities(
  p_order_id uuid,
  p_dispatched_by uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_operation_type text DEFAULT 'partial',
  p_source_module text DEFAULT 'dispatch',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_target_order_item_id uuid;
  v_target_qty integer;
  v_pending_prepare integer;
  v_ready_available integer;
  v_paid_qty_effective integer;
  v_already_dispatched integer;
  v_max_dispatchable integer;
  v_dispatch_from_ready integer;
  v_dispatch_from_pending integer;
  v_active_qty integer;
  v_is_express boolean := false;
  v_order_fully_paid boolean := false;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_dispatch_before_payment boolean := false;
  v_especial_cero boolean := false;
BEGIN
  IF p_operation_type NOT IN ('partial', 'total') THEN
    RAISE EXCEPTION 'Tipo de operacion invalido';
  END IF;

  IF p_source_module NOT IN ('kitchen', 'dispatch', 'orders', 'admin') THEN
    RAISE EXCEPTION 'Modulo origen invalido';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  SELECT COALESCE(workflow_mode, 'CASH_THEN_DISPATCH') INTO v_workflow_mode
  FROM public.branches
  WHERE id = v_order.branch_id;

  v_is_express := v_order.order_type = 'EXPRESS';
  v_order_fully_paid := v_order.status = 'PAID' AND v_order.paid_at IS NOT NULL;
  v_dispatch_before_payment := v_is_express OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND v_order.order_type <> 'TAKEOUT');
  v_especial_cero := COALESCE(v_order.is_special, false)
    AND v_order.special_total_manual IS NOT NULL
    AND v_order.special_total_manual = 0;

  IF v_order.status = 'CANCELLED'
    OR COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades';
  END IF;

  IF v_is_express THEN
    IF v_order.status NOT IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID') THEN
      RAISE EXCEPTION 'La orden Express no permite despachar en su estado actual';
    END IF;
  ELSIF v_order.status NOT IN ('SENT_TO_KITCHEN', 'READY', 'PAID', 'KITCHEN_DISPATCHED') THEN
    RAISE EXCEPTION 'La orden no permite despachar cantidades en su estado actual';
  END IF;

  CREATE TEMP TABLE tmp_dispatch_targets (
    order_item_id uuid PRIMARY KEY,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_dispatch_stages (
    order_item_id uuid NOT NULL,
    source_stage text NOT NULL,
    quantity_dispatched integer NOT NULL
  ) ON COMMIT DROP;

  IF p_operation_type = 'total' THEN
    INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
    SELECT
      snapshot.order_item_id,
      CASE
        WHEN v_dispatch_before_payment THEN snapshot.quantity_dispatched_available
        ELSE LEAST(
          snapshot.quantity_dispatched_available,
          GREATEST(
            0,
            LEAST(
              GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
              CASE
                WHEN v_order_fully_paid THEN
                  GREATEST(
                    COALESCE(snapshot.quantity_paid, 0),
                    GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
                  )
                ELSE COALESCE(snapshot.quantity_paid, 0)
              END
            )
            - GREATEST(
                0,
                COALESCE(snapshot.quantity_dispatched_total, 0)
                - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
              )
          )
        )::int
      END
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    JOIN public.order_items oi ON oi.id = snapshot.order_item_id
    WHERE snapshot.quantity_dispatched_available > 0
      AND oi.status <> 'DRAFT'
      AND (
        v_dispatch_before_payment
        OR COALESCE(snapshot.quantity_paid, 0) > 0
        OR v_order_fully_paid
      );
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Debes enviar al menos un item para despacho parcial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_target_order_item_id := (v_item ->> 'order_item_id')::uuid;
      v_target_qty := (v_item ->> 'quantity_dispatched')::integer;

      IF v_target_order_item_id IS NULL THEN
        RAISE EXCEPTION 'order_item_id invalido en despacho';
      END IF;

      IF v_target_qty IS NULL OR v_target_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad invalida para despacho en item %', v_target_order_item_id;
      END IF;

      INSERT INTO tmp_dispatch_targets (order_item_id, quantity_dispatched)
      VALUES (v_target_order_item_id, v_target_qty)
      ON CONFLICT (order_item_id)
      DO UPDATE SET quantity_dispatched = tmp_dispatch_targets.quantity_dispatched + EXCLUDED.quantity_dispatched;
    END LOOP;
  END IF;

  IF (SELECT COUNT(*) FROM tmp_dispatch_targets) = 0 THEN
    RAISE EXCEPTION 'No hay cantidades pendientes para despachar';
  END IF;

  FOR v_target_order_item_id, v_target_qty IN
    SELECT order_item_id, quantity_dispatched FROM tmp_dispatch_targets
  LOOP
    SELECT
      snapshot.quantity_pending_prepare,
      snapshot.quantity_ready_available,
      GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))::int,
      LEAST(
        GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0)),
        CASE
          WHEN v_order_fully_paid THEN
            GREATEST(
              COALESCE(snapshot.quantity_paid, 0),
              GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
            )
          ELSE COALESCE(snapshot.quantity_paid, 0)
        END
      )::int,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0)
        - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int
    INTO v_pending_prepare, v_ready_available, v_active_qty, v_paid_qty_effective, v_already_dispatched
    FROM public.get_order_operational_snapshot(p_order_id) snapshot
    JOIN public.order_items oi ON oi.id = snapshot.order_item_id
    WHERE snapshot.order_item_id = v_target_order_item_id;

    IF v_pending_prepare IS NULL THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden', v_target_order_item_id;
    END IF;

    IF v_dispatch_before_payment THEN
      v_max_dispatchable := v_pending_prepare + v_ready_available;
    ELSE
      IF v_paid_qty_effective <= 0 THEN
        RAISE EXCEPTION 'El item % no tiene cantidad pagada para despachar', v_target_order_item_id;
      END IF;

      v_max_dispatchable := LEAST(
        v_pending_prepare + v_ready_available,
        GREATEST(0, v_paid_qty_effective - v_already_dispatched)
      );
    END IF;

    IF v_target_qty > v_max_dispatchable THEN
      RAISE EXCEPTION 'No puedes despachar mas cantidad de la disponible para item %', v_target_order_item_id;
    END IF;

    v_dispatch_from_ready := LEAST(v_target_qty, v_ready_available);
    v_dispatch_from_pending := GREATEST(0, v_target_qty - v_dispatch_from_ready);

    IF v_dispatch_from_ready > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'READY', v_dispatch_from_ready);
    END IF;

    IF v_dispatch_from_pending > 0 THEN
      INSERT INTO tmp_dispatch_stages (order_item_id, source_stage, quantity_dispatched)
      VALUES (v_target_order_item_id, 'PENDING', v_dispatch_from_pending);
    END IF;
  END LOOP;

  INSERT INTO public.order_dispatch_events (
    order_id,
    event_type,
    created_by,
    source_module,
    notes,
    created_at
  ) VALUES (
    p_order_id,
    p_operation_type,
    p_dispatched_by,
    p_source_module,
    p_notes,
    v_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.order_item_dispatch_events (
    order_dispatch_event_id,
    order_id,
    order_item_id,
    quantity_dispatched,
    source_stage,
    created_at
  )
  SELECT v_event_id, p_order_id, order_item_id, quantity_dispatched, source_stage, v_now
  FROM tmp_dispatch_stages;

  UPDATE public.order_items oi
  SET dispatched_at = v_now
  WHERE oi.id IN (SELECT DISTINCT order_item_id FROM tmp_dispatch_stages);

  PERFORM public.recompute_order_operational_state(p_order_id);
  PERFORM public.sync_order_payment_state_internal(p_order_id);

  IF v_especial_cero
     AND v_dispatch_before_payment
     AND public.order_is_fully_dispatched(p_order_id)
  THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, p_dispatched_by);
  END IF;

  RETURN v_event_id;
END;
$$;

-- Backfill: órdenes especiales $0 ya marcadas PAID sin fila en payments.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, o.created_by, o.paid_at
    FROM public.orders o
    WHERE COALESCE(o.is_special, false)
      AND o.special_total_manual IS NOT NULL
      AND o.special_total_manual = 0
      AND o.paid_at IS NOT NULL
      AND o.status IN ('PAID', 'KITCHEN_DISPATCHED')
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.order_id = o.id
          AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
      )
  LOOP
    PERFORM public.autopagar_orden_especial_cero_interna(r.id, r.created_by, r.paid_at);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.autopagar_orden_especial_cero_interna(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autopagar_orden_especial_cero_interna(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_draft_items(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order_quantities(uuid, uuid, jsonb, text, text, text) TO authenticated;
