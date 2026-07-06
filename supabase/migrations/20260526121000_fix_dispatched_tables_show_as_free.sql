-- Corrige get_branch_tables_overview para que las mesas con órdenes
-- KITCHEN_DISPATCHED (ya pagadas y despachadas) aparezcan como 'libre', no como 'ocupada'.
--
-- Raíz del bug: la CTE table_orders incluía KITCHEN_DISPATCHED en su filtro de status,
-- lo que hacía que la función devolviera 'occupied' aunque la orden ya estuviera cerrada.
-- Una mesa debe quedar libre en cuanto su única orden activa pase a KITCHEN_DISPATCHED.
--
-- Regla de arquitectura (docs/database_architecture.md):
--   "pagar no libera la mesa" → PAID mantiene la mesa ocupada.
--   "la mesa se libera al despachar" → KITCHEN_DISPATCHED debe liberarla.

CREATE OR REPLACE FUNCTION public.get_branch_tables_overview(p_branch_id uuid)
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
    SELECT
      cs.id AS shift_id,
      cs.opened_at AS shift_opened_at,
      GREATEST(COALESCE(cs.active_tables_count, 0), 0)::int AS active_tables_count
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  workflow_mode AS (
    SELECT COALESCE(workflow_mode, 'CASH_THEN_DISPATCH') AS mode
    FROM public.branches
    WHERE id = p_branch_id
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
      o.table_order_position,
      o.status::text AS status,
      o.created_at,
      o.updated_at,
      COUNT(oi.id)::int AS total_items
    FROM public.orders o
    JOIN visible_tables vt
      ON vt.id = o.table_id
    CROSS JOIN workflow_mode wm
    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id
    WHERE o.branch_id = p_branch_id
      AND o.table_id IS NOT NULL
      AND o.order_type = 'DINE_IN'
      AND (
        (wm.mode = 'CASH_THEN_DISPATCH' AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID'))
        OR
        (wm.mode = 'DISPATCH_THEN_CASH' AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED'))
      )
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
      AND EXISTS (
        SELECT 1
        FROM open_shift os
        WHERE os.shift_id IS NOT NULL
          AND o.cash_shift_id IS NOT DISTINCT FROM os.shift_id
          AND COALESCE(o.sent_to_kitchen_at, o.created_at) >= os.shift_opened_at
      )
    GROUP BY o.id, o.table_id, o.table_order_position, o.status, o.created_at, o.updated_at
  ),
  visible_orders AS (
    SELECT *
    FROM table_orders
    WHERE status <> 'DRAFT' OR total_items > 0
  ),
  empty_drafts AS (
    SELECT DISTINCT ON (to1.table_id)
      to1.table_id,
      to1.id AS draft_order_id,
      to1.created_at AS draft_created_at
    FROM table_orders to1
    WHERE to1.status = 'DRAFT'
      AND to1.total_items = 0
    ORDER BY
      to1.table_id,
      COALESCE(to1.table_order_position, 2147483647),
      COALESCE(to1.updated_at, to1.created_at) DESC,
      to1.created_at DESC
  ),
  order_snapshots AS (
    SELECT
      vo.id AS order_id,
      snapshot.order_item_id,
      snapshot.quantity_ordered,
      snapshot.quantity_paid,
      snapshot.quantity_cancelled_total,
      snapshot.unit_price
    FROM visible_orders vo
    LEFT JOIN LATERAL public.get_order_operational_snapshot(vo.id) snapshot
      ON TRUE
  ),
  order_totals AS (
    SELECT
      vo.id AS order_id,
      vo.table_id,
      vo.table_order_position,
      vo.status,
      vo.created_at,
      vo.updated_at,
      vo.total_items,
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
    FROM visible_orders vo
    LEFT JOIN order_snapshots os
      ON os.order_id = vo.id
    GROUP BY vo.id, vo.table_id, vo.table_order_position, vo.status, vo.created_at, vo.updated_at, vo.total_items
  ),
  representative_orders AS (
    SELECT DISTINCT ON (ot.table_id)
      ot.table_id,
      ot.order_id,
      ot.status AS order_status,
      ot.created_at,
      ot.updated_at
    FROM order_totals ot
    ORDER BY
      ot.table_id,
      CASE ot.status
        WHEN 'PAID'            THEN 0
        WHEN 'SENT_TO_KITCHEN' THEN 1
        WHEN 'READY'           THEN 2
        WHEN 'DRAFT'           THEN 3
        ELSE 4
      END,
      COALESCE(ot.table_order_position, 2147483647),
      COALESCE(ot.updated_at, ot.created_at) DESC,
      ot.created_at DESC,
      ot.order_id
  ),
  order_rollups AS (
    SELECT
      ot.table_id,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'split_id', ot.order_id,
          'split_code', 'Orden ' || COALESCE(ot.table_order_position::text, '?'),
          'total_due', ot.total_due
        )
        ORDER BY COALESCE(ot.table_order_position, 2147483647), ot.created_at, ot.order_id
      ) FILTER (WHERE ot.total_due > 0) AS split_totals
    FROM order_totals ot
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
        FROM visible_orders vo
        WHERE vo.table_id = vt.id
      ) THEN 'occupied'
      ELSE 'free'
    END AS status,
    COALESCE(ro.order_id, ed.draft_order_id) AS active_order_id,
    COALESCE(ro.order_status, CASE WHEN ed.draft_order_id IS NOT NULL THEN 'DRAFT' ELSE NULL END) AS active_order_status,
    COALESCE((
      SELECT COUNT(*)
      FROM visible_orders vo
      WHERE vo.table_id = vt.id
    ), 0)::int AS split_count,
    ROUND(COALESCE((
      SELECT SUM(ot.total_due)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
    ), 0), 2) AS total_due,
    COALESCE(orw.split_totals, '[]'::jsonb) AS split_totals,
    COALESCE((
      SELECT SUM(vo.total_items)
      FROM visible_orders vo
      WHERE vo.table_id = vt.id
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
  LEFT JOIN order_rollups orw
    ON orw.table_id = vt.id
  ORDER BY vt.visual_order ASC, vt.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_branch_tables_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_tables_overview(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
