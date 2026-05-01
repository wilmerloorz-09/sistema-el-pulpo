CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_branch uuid;
  v_branches jsonb := '[]'::jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_shift_permissions jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT active_branch_id INTO v_active_branch
  FROM public.profiles
  WHERE id = v_user_id;

  WITH accessible_branch_ids AS (
    SELECT ub.branch_id, 0 AS priority
    FROM public.v_user_accessible_branches ub
    WHERE ub.user_id = v_user_id

    UNION

    SELECT cs.branch_id, 1 AS priority
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    WHERE cs.status = 'OPEN'
      AND csu.user_id = v_user_id
      AND csu.is_enabled = true
  ),
  candidate_branch_ids AS (
    SELECT branch_id, MIN(priority) AS priority
    FROM accessible_branch_ids
    GROUP BY branch_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'address', b.address,
    'is_active', b.is_active,
    'workflow_mode', COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
  ) ORDER BY cbi.priority, b.name), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  JOIN candidate_branch_ids cbi ON cbi.branch_id = b.id
  WHERE b.is_active = true;

  IF v_active_branch IS NULL OR NOT EXISTS (
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    )
    SELECT 1
    FROM accessible_branch_ids abi
    JOIN public.branches b ON b.id = abi.branch_id
    WHERE abi.branch_id = v_active_branch
      AND b.is_active = true
  ) THEN
    WITH accessible_branch_ids AS (
      SELECT ub.branch_id, 0 AS priority
      FROM public.v_user_accessible_branches ub
      WHERE ub.user_id = v_user_id

      UNION

      SELECT cs.branch_id, 1 AS priority
      FROM public.cash_shifts cs
      JOIN public.cash_shift_users csu
        ON csu.shift_id = cs.id
      WHERE cs.status = 'OPEN'
        AND csu.user_id = v_user_id
        AND csu.is_enabled = true
    )
    SELECT b.id INTO v_active_branch
    FROM public.branches b
    JOIN accessible_branch_ids abi ON abi.branch_id = b.id
    WHERE b.is_active = true
    GROUP BY b.id, b.name
    ORDER BY MIN(abi.priority), b.name
    LIMIT 1;

    UPDATE public.profiles
    SET active_branch_id = v_active_branch,
        updated_at = now()
    WHERE id = v_user_id
      AND v_active_branch IS NOT NULL;
  END IF;

  IF v_active_branch IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(module_code, access_level::text), '{}'::jsonb)
    INTO v_permissions
    FROM public.v_user_effective_permissions
    WHERE user_id = v_user_id
      AND branch_id = v_active_branch;

    SELECT COALESCE(jsonb_strip_nulls(jsonb_build_object(
      'mesas', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
      'ordenes', CASE WHEN bool_or(COALESCE(csu.can_serve_tables, false) OR COALESCE(csu.can_access_orders, false) OR COALESCE(csu.can_edit_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
      'despacho_total', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
      'despacho_mesa', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
      'despacho_para_llevar', CASE WHEN bool_or(COALESCE(csu.can_dispatch_orders, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END,
      'caja', CASE WHEN bool_or(COALESCE(csu.can_use_caja, false) OR COALESCE(csu.is_supervisor, false)) THEN 'OPERATE' END
    )), '{}'::jsonb)
    INTO v_shift_permissions
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    WHERE cs.branch_id = v_active_branch
      AND cs.status = 'OPEN'
      AND csu.user_id = v_user_id
      AND csu.is_enabled = true;

    v_permissions := COALESCE(v_shift_permissions, '{}'::jsonb) || COALESCE(v_permissions, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'active_branch_id', v_active_branch,
    'branches', v_branches,
    'permissions', v_permissions,
    'is_global_admin', public.is_global_admin(v_user_id)
  );
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
  v_branch_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
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

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
  INTO v_branch_workflow_mode
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

  v_next_status := CASE
    WHEN v_order.order_type = 'TAKEOUT'
      OR v_branch_workflow_mode = 'CASH_THEN_DISPATCH'
      THEN 'KITCHEN_DISPATCHED'::public.order_status
    ELSE 'SENT_TO_KITCHEN'::public.order_status
  END;

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
    sent_to_kitchen_at = CASE
      WHEN v_next_status = 'SENT_TO_KITCHEN' THEN COALESCE(o.sent_to_kitchen_at, v_now)
      ELSE o.sent_to_kitchen_at
    END,
    dispatched_at = CASE
      WHEN v_next_status = 'KITCHEN_DISPATCHED' THEN COALESCE(o.dispatched_at, v_now)
      ELSE o.dispatched_at
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_internal(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_available integer := 0;
  v_cancelled_total integer := 0;
  v_active_not_cancelled integer := 0;
  v_item_count integer := 0;
  v_all_fully_paid boolean := false;
  v_operational_status public.order_status;
  v_final_status public.order_status;
  v_final_paid_at timestamptz;
  v_last_ready_at timestamptz;
  v_last_dispatched_at timestamptz;
  v_active_payments_total numeric := 0;
  v_special_total numeric := 0;
  v_branch_workflow_mode text := 'DISPATCH_THEN_CASH';
  v_cash_then_dispatch boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  SELECT COALESCE(b.workflow_mode, 'DISPATCH_THEN_CASH')
  INTO v_branch_workflow_mode
  FROM public.branches b
  WHERE b.id = v_order.branch_id;

  v_cash_then_dispatch := v_branch_workflow_mode = 'CASH_THEN_DISPATCH';

  SELECT MAX(ore.created_at)
  INTO v_last_ready_at
  FROM public.order_ready_events ore
  WHERE ore.order_id = p_order_id
    AND ore.status = 'APPLIED';

  SELECT MAX(ode.created_at)
  INTO v_last_dispatched_at
  FROM public.order_dispatch_events ode
  WHERE ode.order_id = p_order_id
    AND ode.status = 'APPLIED';

  WITH item_state AS (
    SELECT
      oi.id AS order_item_id,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
      CASE
        WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) OR v_cash_then_dispatch THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) OR v_cash_then_dispatch THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END,
        COALESCE(snapshot.quantity_paid, 0)::int
      )::int AS paid_qty_effective
    FROM public.order_items oi
    LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
      ON snapshot.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(item_state.quantity_pending_prepare), 0)::int,
    COALESCE(SUM(item_state.quantity_ready_available), 0)::int,
    COALESCE(SUM(item_state.quantity_dispatched_available), 0)::int,
    COALESCE(SUM(item_state.quantity_cancelled_total), 0)::int,
    COALESCE(SUM(GREATEST(0, item_state.quantity_ordered - item_state.quantity_cancelled_total)), 0)::int,
    COALESCE(
      BOOL_AND(item_state.payable_qty <= 0 OR item_state.paid_qty_effective >= item_state.payable_qty),
      false
    )
  INTO
    v_item_count,
    v_pending_prepare,
    v_ready_available,
    v_dispatched_available,
    v_cancelled_total,
    v_active_not_cancelled,
    v_all_fully_paid
  FROM item_state;

  IF v_item_count = 0 THEN
    v_all_fully_paid := false;
  END IF;

  IF COALESCE(v_order.is_special, false) THEN
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_active_payments_total
    FROM public.payments p
    WHERE p.order_id = p_order_id
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%';

    v_special_total := COALESCE(v_order.special_total_manual, 0);
    v_all_fully_paid := v_special_total > 0
      AND ROUND(COALESCE(v_active_payments_total, 0), 2) >= ROUND(v_special_total, 2);
  END IF;

  IF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched_available > 0 THEN
    v_operational_status := 'KITCHEN_DISPATCHED';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_operational_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_operational_status := 'SENT_TO_KITCHEN';
  ELSE
    v_operational_status := v_order.status;
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE THEN
    WITH item_state AS (
      SELECT
        oi.id AS order_item_id,
        CASE
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) OR v_cash_then_dispatch THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) OR v_cash_then_dispatch THEN
              GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
            ELSE
              GREATEST(
                0,
                COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
              )
          END,
          COALESCE(snapshot.quantity_paid, 0)::int
        )::int AS paid_qty_effective
      FROM public.order_items oi
      LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
        ON snapshot.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
    )
    UPDATE public.order_items oi
    SET paid_at = CASE
      WHEN item_state.payable_qty > 0 AND item_state.paid_qty_effective >= item_state.payable_qty
        THEN COALESCE(oi.paid_at, v_now)
      ELSE NULL
    END
    FROM item_state
    WHERE item_state.order_item_id = oi.id;
  END IF;

  IF v_all_fully_paid THEN
    IF v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_tray_order, false) OR v_cash_then_dispatch THEN
      v_final_status := CASE
        WHEN v_operational_status <> 'KITCHEN_DISPATCHED' THEN 'READY'
        ELSE 'KITCHEN_DISPATCHED'
      END;
      v_final_paid_at := COALESCE(v_order.paid_at, v_now);
    ELSIF v_pending_prepare > 0 OR v_ready_available > 0 THEN
      v_final_status := v_operational_status;
      v_final_paid_at := NULL;
    ELSE
      v_final_status := 'PAID';
      v_final_paid_at := COALESCE(v_order.paid_at, v_now);
    END IF;
  ELSE
    v_final_status := v_operational_status;
    v_final_paid_at := NULL;
  END IF;

  UPDATE public.orders o
  SET
    status = v_final_status,
    paid_at = v_final_paid_at,
    ready_at = CASE
      WHEN v_final_status IN ('READY', 'KITCHEN_DISPATCHED', 'PAID')
        THEN COALESCE(o.ready_at, v_last_ready_at, v_now)
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_final_status IN ('KITCHEN_DISPATCHED', 'PAID')
        THEN COALESCE(o.dispatched_at, v_last_dispatched_at, v_now)
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN v_final_status = 'CANCELLED' THEN COALESCE(o.cancelled_at, v_now)
      ELSE o.cancelled_at
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_draft_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
