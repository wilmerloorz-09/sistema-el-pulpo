CREATE INDEX IF NOT EXISTS idx_orders_branch_table_status_updated
ON public.orders(branch_id, table_id, status, updated_at DESC)
WHERE table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
ON public.order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_order_item_id
ON public.order_item_modifiers(order_item_id);

CREATE INDEX IF NOT EXISTS idx_table_splits_table_id
ON public.table_splits(table_id);

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
