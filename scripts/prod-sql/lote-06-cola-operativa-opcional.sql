-- lote-06-cola-operativa-opcional
-- Ejecutar en Supabase SQL Editor (produccion)
-- Fecha: 2026-08-30

-- ===== 20260829210000_get_operational_queue_rpc.sql =====
-- Cola operativa unificada: quantity_dispatchable calculado en servidor.
-- Aditiva: no modifica get_dispatch_servir_queue_bundle ni sync de pagos.
-- p_run_repair: solo true cuando el cliente detecta cola vacÃ­a (no en cada poll).

CREATE OR REPLACE FUNCTION public.order_treat_as_fully_paid_for_queue(
  p_status text,
  p_paid_at timestamptz,
  p_order_type text,
  p_is_tray_order boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_paid_at IS NOT NULL
    AND (
      upper(COALESCE(p_status, '')) = 'PAID'
      OR (
        upper(COALESCE(p_status, '')) = 'READY'
        AND (
          upper(COALESCE(p_order_type, '')) IN ('TAKEOUT', 'EXPRESS')
          OR COALESCE(p_is_tray_order, false)
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.compute_queue_item_dispatchable(
  p_quantity_ordered integer,
  p_quantity_pending_prepare integer,
  p_quantity_ready_available integer,
  p_quantity_paid integer,
  p_quantity_dispatched_total integer,
  p_quantity_cancelled_dispatched integer,
  p_quantity_cancelled_total integer,
  p_is_dispatch_first boolean,
  p_order_fully_paid boolean
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  WITH work AS (
    SELECT GREATEST(0, COALESCE(p_quantity_pending_prepare, 0) + COALESCE(p_quantity_ready_available, 0)) AS avail
  ),
  paid AS (
    SELECT
      GREATEST(0, COALESCE(p_quantity_ordered, 0) - COALESCE(p_quantity_cancelled_total, 0)) AS active_ordered,
      GREATEST(
        0,
        COALESCE(p_quantity_dispatched_total, 0) - COALESCE(p_quantity_cancelled_dispatched, 0)
      ) AS already_dispatched,
      COALESCE(p_quantity_paid, 0) AS snapshot_paid
  )
  SELECT CASE
    WHEN (SELECT avail FROM work) <= 0 THEN 0
    WHEN COALESCE(p_is_dispatch_first, false) THEN (SELECT avail FROM work)
    ELSE (
      WITH eff AS (
        SELECT
          CASE
            WHEN (SELECT snapshot_paid FROM paid) > 0 THEN
              LEAST((SELECT active_ordered FROM paid), (SELECT snapshot_paid FROM paid))
            WHEN COALESCE(p_order_fully_paid, false) THEN (SELECT active_ordered FROM paid)
            ELSE 0
          END AS paid_effective,
          (SELECT already_dispatched FROM paid) AS already_dispatched,
          (SELECT avail FROM work) AS avail
      )
      SELECT GREATEST(
        0,
        LEAST(
          (SELECT avail FROM eff),
          GREATEST(0, (SELECT paid_effective FROM eff) - (SELECT already_dispatched FROM eff))
        )
      )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_operational_queue(
  p_branch_id uuid,
  p_shift_id uuid,
  p_module text DEFAULT 'dispatch',
  p_run_repair boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_opened_at timestamptz;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_has_enabled_packer boolean := false;
  v_result jsonb;
BEGIN
  IF p_branch_id IS NULL OR p_shift_id IS NULL THEN
    RETURN jsonb_build_object(
      'orders', '[]'::jsonb,
      'items', '[]'::jsonb,
      'modifiers', '[]'::jsonb,
      'order_payment_flags', '[]'::jsonb,
      'tables', '[]'::jsonb,
      'splits', '[]'::jsonb,
      'profiles', '[]'::jsonb,
      'packer_user_ids', '[]'::jsonb,
      'has_plate_servers', false
    );
  END IF;

  IF p_module NOT IN ('dispatch', 'servir', 'packing') THEN
    RAISE EXCEPTION 'Modulo de cola invalido: %', p_module;
  END IF;

  SELECT
    cs.status = 'OPEN',
    cs.opened_at
  INTO v_ok, v_opened_at
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id;

  IF NOT COALESCE(v_ok, false) THEN
    RETURN jsonb_build_object(
      'orders', '[]'::jsonb,
      'items', '[]'::jsonb,
      'modifiers', '[]'::jsonb,
      'order_payment_flags', '[]'::jsonb,
      'tables', '[]'::jsonb,
      'splits', '[]'::jsonb,
      'profiles', '[]'::jsonb,
      'packer_user_ids', '[]'::jsonb,
      'has_plate_servers', false
    );
  END IF;

  SELECT COALESCE(b.workflow_mode, 'CASH_THEN_DISPATCH')
  INTO v_workflow_mode
  FROM public.branches b
  WHERE b.id = p_branch_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.is_enabled IS TRUE
      AND csu.can_pack_orders IS TRUE
  )
  INTO v_has_enabled_packer;

  IF COALESCE(p_run_repair, false) THEN
    PERFORM public.repair_open_shift_order_cash_shift_ids(p_branch_id);
  END IF;

  WITH orders_base AS (
    SELECT
      o.id,
      o.order_number,
      o.order_code,
      o.order_type,
      o.is_special,
      o.is_tray_order,
      o.special_total_manual,
      o.special_group_total,
      o.created_by,
      o.table_id,
      o.split_id,
      o.status,
      o.created_at,
      o.updated_at,
      o.sent_to_kitchen_at,
      o.ready_at,
      o.dispatched_at,
      o.paid_at,
      o.cancelled_at,
      o.locked_for_editing,
      o.notes,
      o.cash_shift_id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.status IN ('PAID', 'READY', 'SENT_TO_KITCHEN')
      AND (
        o.cash_shift_id = p_shift_id
        OR (
          COALESCE(o.sent_to_kitchen_at, o.created_at) >= v_opened_at
          AND (
            o.cash_shift_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.cash_shifts old
              WHERE old.id = o.cash_shift_id
                AND old.status = 'CLOSED'
            )
          )
        )
      )
  ),
  pay_flags AS (
    SELECT
      ob.id AS order_id,
      EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = ob.id) AS has_any_payment,
      EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.order_id = ob.id
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
          AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
      ) AS has_active_payment,
      EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = ob.id
          AND oi.paid_at IS NOT NULL
      ) AS has_paid_line
    FROM orders_base ob
  ),
  active_orders AS (
    SELECT ob.*
    FROM orders_base ob
    JOIN pay_flags pf ON pf.order_id = ob.id
    WHERE COALESCE(ob.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
      AND (
        (
          (
            ob.order_type = 'EXPRESS'
            OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND ob.order_type <> 'TAKEOUT')
          )
          AND ob.status::text IN ('SENT_TO_KITCHEN', 'READY', 'PAID')
        )
        OR (
          NOT (
            ob.order_type = 'EXPRESS'
            OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND ob.order_type <> 'TAKEOUT')
          )
          AND (
            (
              ob.status::text = 'PAID'
              AND (ob.paid_at IS NOT NULL OR NOT pf.has_any_payment OR pf.has_active_payment)
            )
            OR (
              ob.status::text IN ('READY', 'SENT_TO_KITCHEN')
              AND (pf.has_active_payment OR ob.paid_at IS NOT NULL OR pf.has_paid_line)
            )
          )
        )
      )
      AND CASE p_module
        WHEN 'packing' THEN
          ob.order_type IN ('TAKEOUT', 'EXPRESS')
          AND NOT COALESCE(ob.is_special, false)
        WHEN 'dispatch' THEN
          NOT (
            v_has_enabled_packer
            AND ob.order_type IN ('TAKEOUT', 'EXPRESS')
            AND NOT COALESCE(ob.is_special, false)
          )
        ELSE true
      END
  ),
  target_items AS (
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id IN (SELECT id FROM active_orders)
  ),
  paid AS (
    SELECT
      pi.order_item_id,
      COALESCE(SUM(pi.quantity_paid), 0)::int AS quantity_paid
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.order_item_id IN (SELECT id FROM target_items)
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
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
    WHERE oire.order_item_id IN (SELECT id FROM target_items)
      AND ore.status = 'APPLIED'
    GROUP BY oire.order_item_id
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode ON ode.id = oide.order_dispatch_event_id
    WHERE oide.order_item_id IN (SELECT id FROM target_items)
      AND ode.status = 'APPLIED'
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
    WHERE oic.order_item_id IN (SELECT id FROM target_items)
      AND oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  items_enriched AS (
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.description_snapshot,
      oi.quantity,
      oi.unit_price,
      oi.total,
      oi.status,
      oi.tray_item_type,
      oi.tray_container_cost,
      oi.item_note,
      oi.sent_to_kitchen_at,
      oi.paid_at,
      oi.created_at,
      oi.cantidad_especial,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
      COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
      COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
      COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
      COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total,
      GREATEST(
        0,
        COALESCE(oi.quantity, 0)::int
        - GREATEST(COALESCE(r.quantity_ready_total, 0), COALESCE(d.quantity_dispatched_total, 0))
        - COALESCE(c.quantity_cancelled_pending, 0)
      )::int AS quantity_pending_prepare,
      GREATEST(
        0,
        GREATEST(COALESCE(r.quantity_ready_total, 0), COALESCE(d.quantity_dispatched_total, 0))
        - COALESCE(d.quantity_dispatched_total, 0)
        - COALESCE(c.quantity_cancelled_ready, 0)
      )::int AS quantity_ready_available,
      ob.order_type,
      ob.is_tray_order,
      ob.paid_at AS order_paid_at,
      ob.status AS order_status,
      (
        ob.order_type = 'EXPRESS'
        OR (v_workflow_mode = 'DISPATCH_THEN_CASH' AND ob.order_type <> 'TAKEOUT')
      ) AS is_dispatch_first,
      public.order_treat_as_fully_paid_for_queue(
        ob.status::text,
        ob.paid_at,
        ob.order_type,
        ob.is_tray_order
      ) AS order_fully_paid
    FROM target_items oi
    JOIN active_orders ob ON ob.id = oi.order_id
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
    WHERE upper(COALESCE(oi.status::text, '')) NOT IN ('DRAFT', 'CANCELLED')
      AND (
        ob.order_type = 'EXTRA'
        OR oi.sent_to_kitchen_at IS NOT NULL
        OR ob.sent_to_kitchen_at IS NOT NULL
      )
  ),
  items_with_dispatchable AS (
    SELECT
      ie.*,
      public.compute_queue_item_dispatchable(
        COALESCE(ie.quantity, 0)::int,
        ie.quantity_pending_prepare,
        ie.quantity_ready_available,
        ie.quantity_paid,
        ie.quantity_dispatched_total,
        ie.quantity_cancelled_dispatched,
        ie.quantity_cancelled_total,
        ie.is_dispatch_first,
        ie.order_fully_paid
      )::int AS quantity_dispatchable
    FROM items_enriched ie
  ),
  visible_items AS (
    SELECT *
    FROM items_with_dispatchable
    WHERE quantity_dispatchable > 0
  ),
  visible_orders AS (
    SELECT ao.*
    FROM active_orders ao
    WHERE EXISTS (SELECT 1 FROM visible_items vi WHERE vi.order_id = ao.id)
  ),
  mods AS (
    SELECT
      oim.order_item_id,
      COALESCE(m.description, '') AS description
    FROM public.order_item_modifiers oim
    LEFT JOIN public.modifiers m ON m.id = oim.modifier_id
    WHERE oim.order_item_id IN (SELECT id FROM visible_items)
      AND COALESCE(m.description, '') <> ''
  ),
  creator_ids AS (
    SELECT DISTINCT created_by AS user_id
    FROM visible_orders
    WHERE created_by IS NOT NULL
  ),
  packers AS (
    SELECT csu.user_id
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.can_pack_orders IS TRUE
      AND csu.user_id IN (SELECT user_id FROM creator_ids)
  ),
  plate_servers AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.is_enabled IS TRUE
        AND csu.can_serve_plates IS TRUE
    ) AS has_plate_servers
  )
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(vo) ORDER BY vo.updated_at ASC)
      FROM visible_orders vo
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', vi.id,
          'order_id', vi.order_id,
          'product_id', vi.product_id,
          'description_snapshot', vi.description_snapshot,
          'quantity', vi.quantity,
          'unit_price', vi.unit_price,
          'total', vi.total,
          'status', vi.status,
          'tray_item_type', vi.tray_item_type,
          'tray_container_cost', vi.tray_container_cost,
          'item_note', vi.item_note,
          'sent_to_kitchen_at', vi.sent_to_kitchen_at,
          'paid_at', vi.paid_at,
          'created_at', vi.created_at,
          'cantidad_especial', vi.cantidad_especial,
          'quantity_paid', vi.quantity_paid,
          'quantity_ready_total', vi.quantity_ready_total,
          'quantity_dispatched_total', vi.quantity_dispatched_total,
          'quantity_cancelled_pending', vi.quantity_cancelled_pending,
          'quantity_cancelled_ready', vi.quantity_cancelled_ready,
          'quantity_cancelled_dispatched', vi.quantity_cancelled_dispatched,
          'quantity_cancelled_total', vi.quantity_cancelled_total,
          'quantity_pending_prepare', vi.quantity_pending_prepare,
          'quantity_ready_available', vi.quantity_ready_available,
          'quantity_dispatchable', vi.quantity_dispatchable
        )
        ORDER BY vi.created_at ASC NULLS LAST
      )
      FROM visible_items vi
    ), '[]'::jsonb),
    'modifiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_item_id', mods.order_item_id,
        'description', mods.description
      ))
      FROM mods
    ), '[]'::jsonb),
    'order_payment_flags', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', pf.order_id,
        'has_any_payment', pf.has_any_payment,
        'has_active_payment', pf.has_active_payment,
        'has_paid_line', pf.has_paid_line
      ))
      FROM pay_flags pf
      WHERE pf.order_id IN (SELECT id FROM visible_orders)
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
      FROM public.restaurant_tables t
      WHERE t.id IN (SELECT table_id FROM visible_orders WHERE table_id IS NOT NULL)
    ), '[]'::jsonb),
    'splits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'split_code', s.split_code))
      FROM public.table_splits s
      WHERE s.id IN (SELECT split_id FROM visible_orders WHERE split_id IS NOT NULL)
    ), '[]'::jsonb),
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'first_name', p.first_name,
        'full_name', p.full_name,
        'username', p.username,
        'alias', p.alias,
        'email', p.email
      ))
      FROM public.profiles p
      WHERE p.id IN (SELECT user_id FROM creator_ids)
    ), '[]'::jsonb),
    'packer_user_ids', COALESCE((
      SELECT jsonb_agg(packers.user_id)
      FROM packers
    ), '[]'::jsonb),
    'has_plate_servers', (SELECT has_plate_servers FROM plate_servers)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_queue(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, uuid, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';




