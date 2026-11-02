-- =============================================================================
-- Una orden especial (table_id NULL, special_origin_table_id = mesa) NO ocupa la
-- mesa: se puede abrir una cuenta normal en la misma mesa.
-- - Overview: occupied/totales solo con órdenes que tienen table_id real.
-- - is_special indica que hay especial vinculada (badge), sin bloquear.
-- - create_additional_dine_in_order: permite hermana desde especial mixta
--   (con table_id); las especiales puras abren vía create_dine_in_order en UI.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_branch_tables_overview(uuid);

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
  elapsed_minutes integer,
  is_special boolean
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
      o.table_id AS bound_table_id,
      COALESCE(o.table_id, o.special_origin_table_id) AS table_id,
      o.table_order_position,
      o.status::text AS status,
      o.created_at,
      o.updated_at,
      COALESCE(o.is_special, false) AS is_special,
      o.special_total_manual,
      COUNT(oi.id)::int AS total_items
    FROM public.orders o
    JOIN visible_tables vt
      ON vt.id = COALESCE(o.table_id, o.special_origin_table_id)
    CROSS JOIN workflow_mode wm
    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id
    WHERE o.branch_id = p_branch_id
      AND o.order_type = 'DINE_IN'
      AND (
        (COALESCE(o.is_special, false) = false AND o.table_id IS NOT NULL)
        OR (COALESCE(o.is_special, false) = true AND o.special_origin_table_id IS NOT NULL)
      )
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
    GROUP BY
      o.id,
      o.table_id,
      COALESCE(o.table_id, o.special_origin_table_id),
      o.table_order_position,
      o.status,
      o.created_at,
      o.updated_at,
      o.is_special,
      o.special_total_manual
  ),
  visible_orders AS (
    SELECT *
    FROM table_orders
    WHERE status <> 'DRAFT'
       OR total_items > 0
       OR is_special
  ),
  -- Solo cuentas reales de mesa ocupan (especiales puras quedan fuera).
  occupying_orders AS (
    SELECT *
    FROM visible_orders
    WHERE bound_table_id IS NOT NULL
  ),
  empty_drafts AS (
    SELECT DISTINCT ON (to1.table_id)
      to1.table_id,
      to1.id AS draft_order_id,
      to1.created_at AS draft_created_at
    FROM table_orders to1
    WHERE to1.status = 'DRAFT'
      AND to1.total_items = 0
      AND COALESCE(to1.is_special, false) = false
      AND to1.bound_table_id IS NOT NULL
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
    FROM occupying_orders vo
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
    FROM occupying_orders vo
    LEFT JOIN order_snapshots os
      ON os.order_id = vo.id
    GROUP BY
      vo.id,
      vo.table_id,
      vo.table_order_position,
      vo.status,
      vo.created_at,
      vo.updated_at,
      vo.total_items
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
        FROM occupying_orders oo
        WHERE oo.table_id = vt.id
      ) THEN 'occupied'
      ELSE 'free'
    END AS status,
    COALESCE(ro.order_id, ed.draft_order_id) AS active_order_id,
    COALESCE(ro.order_status, CASE WHEN ed.draft_order_id IS NOT NULL THEN 'DRAFT' ELSE NULL END) AS active_order_status,
    COALESCE((
      SELECT COUNT(*)
      FROM occupying_orders oo
      WHERE oo.table_id = vt.id
    ), 0)::int AS split_count,
    ROUND(COALESCE((
      SELECT SUM(ot.total_due)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
    ), 0), 2) AS total_due,
    COALESCE(orw.split_totals, '[]'::jsonb) AS split_totals,
    COALESCE((
      SELECT SUM(oo.total_items)
      FROM occupying_orders oo
      WHERE oo.table_id = vt.id
    ), 0)::int AS item_count,
    CASE
      WHEN COALESCE(ro.created_at, ed.draft_created_at) IS NULL THEN 0
      ELSE GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ro.created_at, ed.draft_created_at))) / 60)
      )::int
    END AS elapsed_minutes,
    COALESCE((
      SELECT TRUE
      FROM visible_orders vo
      WHERE vo.table_id = vt.id
        AND COALESCE(vo.is_special, false)
        AND vo.bound_table_id IS NULL
      LIMIT 1
    ), false) AS is_special
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

-- Permite cuenta hermana desde especial mixta (conserva table_id).
-- Cuerpo = producción; solo se quita el rechazo por is_special.
CREATE OR REPLACE FUNCTION public.create_additional_dine_in_order(p_source_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source_order public.orders%ROWTYPE;
  v_new_order_id uuid;
  v_existing_empty_id uuid;
  v_has_permission boolean := false;
  v_next_position integer := 1;
  v_shift_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  r record;
BEGIN
  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden origen es obligatoria';
  END IF;

  SELECT o.*
  INTO v_source_order
  FROM public.orders o
  WHERE o.id = p_source_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden origen';
  END IF;

  IF v_source_order.order_type <> 'DINE_IN'
    OR v_source_order.table_id IS NULL
  THEN
    RAISE EXCEPTION 'Solo puedes crear ordenes adicionales desde una orden de mesa activa';
  END IF;

  IF v_source_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden origen ya no admite nuevas ordenes hermanas';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_shift_id,
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = auth.uid()
  WHERE cs.branch_id = v_source_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_source_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    v_shift_id IS NULL
    OR COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para crear una nueva orden en esta mesa';
  END IF;

  -- Borrador vacio normal del turno abierto: se reutiliza en vez de crear otro.
  SELECT o.id
  INTO v_existing_empty_id
  FROM public.orders o
  WHERE o.table_id = v_source_order.table_id
    AND o.order_type = 'DINE_IN'
    AND o.status = 'DRAFT'
    AND COALESCE(o.is_special, false) = false
    AND COALESCE(o.is_tray_order, false) = false
    AND o.sent_to_kitchen_at IS NULL
    AND (v_shift_id IS NULL OR o.cash_shift_id IS NULL OR o.cash_shift_id = v_shift_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
    )
  ORDER BY o.table_order_position NULLS LAST, o.created_at, o.id
  LIMIT 1;

  IF v_existing_empty_id IS NOT NULL THEN
    RETURN v_existing_empty_id;
  END IF;

  -- Borradores vacios de turnos ya cerrados: nadie los esta usando.
  FOR r IN
    SELECT o.id
    FROM public.orders o
    JOIN public.cash_shifts cs ON cs.id = o.cash_shift_id
    WHERE o.table_id = v_source_order.table_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND cs.status <> 'OPEN'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  LOOP
    PERFORM public.purge_empty_order(r.id);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_source_order.table_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  ) THEN
    RAISE EXCEPTION 'Todas las ordenes activas de la mesa deben tener al menos un item antes de crear otra';
  END IF;

  v_next_position := public.next_table_order_position(v_source_order.table_id);

  INSERT INTO public.orders (
    branch_id,
    table_id,
    table_order_position,
    order_type,
    menu_scope,
    status,
    is_special,
    created_by
  )
  VALUES (
    v_source_order.branch_id,
    v_source_order.table_id,
    v_next_position,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    false,
    auth.uid()
  )
  RETURNING id INTO v_new_order_id;

  RETURN v_new_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_additional_dine_in_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_additional_dine_in_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
