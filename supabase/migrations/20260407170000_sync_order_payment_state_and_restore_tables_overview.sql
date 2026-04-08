CREATE OR REPLACE FUNCTION public.get_order_operational_snapshot(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_item_id uuid,
  description_snapshot text,
  item_status text,
  unit_price numeric,
  quantity_ordered integer,
  quantity_paid integer,
  quantity_ready_total integer,
  quantity_ready_available integer,
  quantity_dispatched_total integer,
  quantity_dispatched_available integer,
  quantity_cancelled_pending integer,
  quantity_cancelled_ready integer,
  quantity_cancelled_dispatched integer,
  quantity_cancelled_total integer,
  quantity_pending_prepare integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH paid AS (
    SELECT
      pi.order_item_id,
      COALESCE(SUM(pi.quantity_paid), 0)::int AS quantity_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
    GROUP BY pi.order_item_id
  ),
  ready AS (
    SELECT
      oire.order_item_id,
      COALESCE(SUM(oire.quantity_ready), 0)::int AS quantity_ready_total
    FROM public.order_item_ready_events oire
    JOIN public.order_ready_events ore ON ore.id = oire.order_ready_event_id
    WHERE ore.status = 'APPLIED'
    GROUP BY oire.order_item_id
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'PENDING'), 0)::int AS quantity_dispatched_from_pending,
      COALESCE(SUM(oide.quantity_dispatched) FILTER (WHERE oide.source_stage = 'READY'), 0)::int AS quantity_dispatched_from_ready
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode ON ode.id = oide.order_dispatch_event_id
    WHERE ode.status = 'APPLIED'
    GROUP BY oide.order_item_id
  ),
  cancelled AS (
    SELECT
      oic.order_item_id,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'PENDING'), 0)::int AS quantity_cancelled_pending,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'READY'), 0)::int AS quantity_cancelled_ready,
      COALESCE(SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'DISPATCHED'), 0)::int AS quantity_cancelled_dispatched,
      COALESCE(SUM(oic.quantity_cancelled), 0)::int AS quantity_cancelled_total
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  base AS (
    SELECT
      oi.order_id,
      oi.id AS order_item_id,
      oi.description_snapshot,
      COALESCE(oi.status, 'SENT') AS item_status,
      oi.unit_price,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
      COALESCE(d.quantity_dispatched_from_pending, 0)::int AS quantity_dispatched_from_pending,
      COALESCE(d.quantity_dispatched_from_ready, 0)::int AS quantity_dispatched_from_ready,
      COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
      COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
      COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
      COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    FROM public.order_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
  ),
  computed AS (
    SELECT
      base.*,
      GREATEST(
        0,
        base.quantity_ordered
        - base.quantity_ready_total
        - base.quantity_cancelled_pending
        - base.quantity_dispatched_from_pending
      )::int AS quantity_pending_prepare,
      GREATEST(
        0,
        base.quantity_ready_total
        - base.quantity_dispatched_from_ready
        - base.quantity_cancelled_ready
      )::int AS quantity_ready_available
    FROM base
  )
  SELECT
    computed.order_id,
    computed.order_item_id,
    computed.description_snapshot,
    computed.item_status,
    computed.unit_price,
    computed.quantity_ordered,
    computed.quantity_paid,
    computed.quantity_ready_total,
    computed.quantity_ready_available,
    computed.quantity_dispatched_total,
    GREATEST(0, computed.quantity_pending_prepare + computed.quantity_ready_available)::int AS quantity_dispatched_available,
    computed.quantity_cancelled_pending,
    computed.quantity_cancelled_ready,
    computed.quantity_cancelled_dispatched,
    computed.quantity_cancelled_total,
    computed.quantity_pending_prepare
  FROM computed;
$$;

REVOKE ALL ON FUNCTION public.get_order_operational_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_operational_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_branch_tables_overview(
  p_branch_id uuid
)
RETURNS TABLE (
  table_id uuid,
  table_name text,
  visual_order integer,
  table_is_active boolean,
  status text,
  active_order_id uuid,
  active_order_status text,
  split_count integer,
  total_due numeric,
  split_totals jsonb,
  item_count integer,
  elapsed_minutes integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_shift AS (
    SELECT GREATEST(COALESCE(cs.active_tables_count, 0), 0)::int AS active_tables_count
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  visible_tables AS (
    SELECT
      rt.id,
      rt.name,
      rt.visual_order,
      rt.is_active
    FROM public.restaurant_tables rt
    WHERE rt.branch_id = p_branch_id
    ORDER BY rt.visual_order ASC, rt.name ASC
    LIMIT GREATEST(0, COALESCE((SELECT active_tables_count FROM open_shift), 0))
  ),
  table_orders AS (
    SELECT
      o.id,
      o.table_id,
      o.split_id,
      o.status::text AS status,
      o.created_at,
      o.updated_at,
      COUNT(oi.id)::int AS total_items
    FROM public.orders o
    JOIN visible_tables vt
      ON vt.id = o.table_id
    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id
    WHERE o.branch_id = p_branch_id
      AND o.table_id IS NOT NULL
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    GROUP BY o.id, o.table_id, o.split_id, o.status, o.created_at, o.updated_at
  ),
  empty_drafts AS (
    SELECT DISTINCT ON (to1.table_id)
      to1.table_id,
      to1.id AS draft_order_id,
      to1.created_at AS draft_created_at
    FROM table_orders to1
    WHERE to1.status = 'DRAFT'
      AND to1.total_items = 0
    ORDER BY to1.table_id, COALESCE(to1.updated_at, to1.created_at) DESC, to1.created_at DESC
  ),
  relevant_orders AS (
    SELECT *
    FROM table_orders
    WHERE NOT (status = 'DRAFT' AND total_items = 0)
  ),
  order_snapshots AS (
    SELECT
      ro.id AS order_id,
      snapshot.order_item_id,
      snapshot.quantity_ordered,
      snapshot.quantity_paid,
      snapshot.quantity_cancelled_total,
      snapshot.unit_price
    FROM relevant_orders ro
    LEFT JOIN LATERAL public.get_order_operational_snapshot(ro.id) snapshot
      ON TRUE
  ),
  order_totals AS (
    SELECT
      ro.id AS order_id,
      ro.table_id,
      ro.split_id,
      ro.status,
      ro.created_at,
      ro.updated_at,
      ro.total_items,
      ROUND(
        COALESCE(
          SUM(
            GREATEST(
              0,
              GREATEST(COALESCE(os.quantity_ordered, 0) - COALESCE(os.quantity_cancelled_total, 0), 0)
              - LEAST(
                  GREATEST(COALESCE(os.quantity_ordered, 0) - COALESCE(os.quantity_cancelled_total, 0), 0),
                  COALESCE(os.quantity_paid, 0)
                )
            )::numeric * COALESCE(os.unit_price, 0)
          ),
          0
        ),
        2
      ) AS total_due
    FROM relevant_orders ro
    LEFT JOIN order_snapshots os
      ON os.order_id = ro.id
    GROUP BY ro.id, ro.table_id, ro.split_id, ro.status, ro.created_at, ro.updated_at, ro.total_items
  ),
  representative_orders AS (
    SELECT DISTINCT ON (ot.table_id)
      ot.table_id,
      ot.order_id,
      ot.status AS order_status,
      ot.created_at
    FROM order_totals ot
    ORDER BY ot.table_id, COALESCE(ot.updated_at, ot.created_at) DESC, ot.created_at DESC, ot.order_id
  ),
  split_rollups AS (
    SELECT
      ot.table_id,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'split_id', ot.split_id,
          'split_code', ts.split_code,
          'total_due', ot.total_due
        )
        ORDER BY ts.split_code
      ) FILTER (WHERE ot.split_id IS NOT NULL AND ot.total_due > 0) AS split_totals
    FROM order_totals ot
    LEFT JOIN public.table_splits ts
      ON ts.id = ot.split_id
    GROUP BY ot.table_id
  )
  SELECT
    vt.id AS table_id,
    vt.name AS table_name,
    vt.visual_order,
    vt.is_active AS table_is_active,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM order_totals ot
        WHERE ot.table_id = vt.id
          AND ot.status = 'KITCHEN_DISPATCHED'
      ) THEN 'to_pay'
      WHEN EXISTS (
        SELECT 1
        FROM order_totals ot
        WHERE ot.table_id = vt.id
      ) THEN 'occupied'
      ELSE 'free'
    END AS status,
    COALESCE(ro.order_id, ed.draft_order_id) AS active_order_id,
    COALESCE(ro.order_status, CASE WHEN ed.draft_order_id IS NOT NULL THEN 'DRAFT' ELSE NULL END) AS active_order_status,
    COALESCE((
      SELECT COUNT(DISTINCT ot.split_id)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
        AND ot.split_id IS NOT NULL
    ), 0)::int AS split_count,
    ROUND(COALESCE((
      SELECT SUM(ot.total_due)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
    ), 0), 2) AS total_due,
    COALESCE(sr.split_totals, '[]'::jsonb) AS split_totals,
    COALESCE((
      SELECT SUM(ot.total_items)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
    ), 0)::int AS item_count,
    CASE
      WHEN COALESCE(ro.created_at, ed.draft_created_at) IS NULL THEN 0
      ELSE GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ro.created_at, ed.draft_created_at))) / 60)
      )::int
    END AS elapsed_minutes
  FROM visible_tables vt
  LEFT JOIN representative_orders ro
    ON ro.table_id = vt.id
  LEFT JOIN empty_drafts ed
    ON ed.table_id = vt.id
  LEFT JOIN split_rollups sr
    ON sr.table_id = vt.id
  ORDER BY vt.visual_order ASC, vt.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_branch_tables_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_tables_overview(uuid) TO authenticated;

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
      oi.paid_at,
      COALESCE(snapshot.quantity_paid, 0)::int AS quantity_paid_from_payments,
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
      CASE
        WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END,
        CASE
          WHEN COALESCE(snapshot.quantity_paid, 0) > 0 THEN COALESCE(snapshot.quantity_paid, 0)::int
          WHEN oi.paid_at IS NOT NULL THEN COALESCE(oi.quantity, 0)::int
          ELSE 0
        END
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
          WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_special, false) THEN
              GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
            ELSE
              GREATEST(
                0,
                COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
              )
          END,
          CASE
            WHEN COALESCE(snapshot.quantity_paid, 0) > 0 THEN COALESCE(snapshot.quantity_paid, 0)::int
            WHEN oi.paid_at IS NOT NULL THEN COALESCE(oi.quantity, 0)::int
            ELSE 0
          END
        )::int AS paid_qty_effective
      FROM public.order_items oi
      LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
        ON snapshot.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
    )
    UPDATE public.order_items oi
    SET paid_at = CASE
      WHEN item_state.payable_qty <= 0 OR item_state.paid_qty_effective >= item_state.payable_qty
        THEN COALESCE(oi.paid_at, v_now)
      ELSE NULL
    END
    FROM item_state
    WHERE item_state.order_item_id = oi.id;
  END IF;

  IF v_all_fully_paid THEN
    IF v_order.order_type = 'TAKEOUT' OR COALESCE(v_order.is_tray_order, false) THEN
      v_final_status := CASE
        WHEN v_operational_status <> 'KITCHEN_DISPATCHED' THEN 'READY'
        ELSE 'KITCHEN_DISPATCHED'
      END;
    ELSE
      v_final_status := 'PAID';
    END IF;
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
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

CREATE OR REPLACE FUNCTION public.sync_order_payment_state(p_order_id uuid)
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
  v_actor_id uuid := auth.uid();
  v_branch_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT o.branch_id
  INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF NOT (
    public.can_operate_cash_branch(v_actor_id, v_branch_id)
    OR public.can_manage_branch_admin(v_actor_id, v_branch_id)
    OR public.has_branch_permission(v_actor_id, v_branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_branch_id, 'ordenes', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para sincronizar el estado de pago de esta orden.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.sync_order_payment_state_internal(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_order_payment_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_from_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  ELSIF TG_TABLE_NAME = 'payment_items' THEN
    SELECT p.order_id
    INTO v_order_id
    FROM public.payments p
    WHERE p.id = COALESCE(NEW.payment_id, OLD.payment_id);
  END IF;

  IF v_order_id IS NOT NULL THEN
    PERFORM public.sync_order_payment_state_internal(v_order_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_from_payment_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_from_payment_change() TO authenticated;

DROP TRIGGER IF EXISTS trg_sync_order_payment_state_on_payments ON public.payments;
CREATE TRIGGER trg_sync_order_payment_state_on_payments
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_payment_state_from_payment_change();

DROP TRIGGER IF EXISTS trg_sync_order_payment_state_on_payment_items ON public.payment_items;
CREATE TRIGGER trg_sync_order_payment_state_on_payment_items
AFTER INSERT OR UPDATE OR DELETE ON public.payment_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_payment_state_from_payment_change();

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
