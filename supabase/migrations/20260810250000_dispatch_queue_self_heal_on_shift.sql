-- =============================================================================
-- Cola Despacho/Servir: autorreparar tags + incluir huérfanas del turno OPEN
-- =============================================================================
-- Tras cerrar/abrir turno, órdenes enviadas pueden quedar con cash_shift_id del
-- turno CLOSED (o NULL). La RPC filtraba solo por = p_shift_id → cola vacía
-- aunque la orden existiera y se viera en captura.
--
-- Esta versión:
-- 1) Reaplica tags al turno OPEN al inicio de cada lectura de cola.
-- 2) Incluye órdenes del turno OPEN aunque el tag aún esté mal (NULL / CLOSED).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assign_open_cash_shift_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_tagged_status text;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status::text, 'DRAFT') NOT IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID') THEN
    RETURN NEW;
  END IF;

  IF NEW.cash_shift_id IS NOT NULL THEN
    SELECT cs.status::text
    INTO v_tagged_status
    FROM public.cash_shifts cs
    WHERE cs.id = NEW.cash_shift_id;

    IF v_tagged_status IS NULL OR v_tagged_status = 'OPEN' THEN
      RETURN NEW;
    END IF;
    NEW.cash_shift_id := NULL;
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = NEW.branch_id
    AND cs.status = 'OPEN'
    AND COALESCE(NEW.sent_to_kitchen_at, NEW.created_at, now()) >= cs.opened_at
  ORDER BY cs.opened_at DESC, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    NEW.cash_shift_id := v_shift_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_open_shift_order_cash_shift_ids(p_branch_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH repaired AS (
    UPDATE public.orders o
    SET
      cash_shift_id = cs.id,
      updated_at = now()
    FROM public.cash_shifts cs
    WHERE cs.branch_id = o.branch_id
      AND cs.status = 'OPEN'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID')
      AND COALESCE(o.sent_to_kitchen_at, o.created_at) >= cs.opened_at
      AND (
        o.cash_shift_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.cash_shifts old
          WHERE old.id = o.cash_shift_id
            AND old.status = 'CLOSED'
        )
      )
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_count FROM repaired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_dispatch_servir_queue_bundle(
  p_branch_id uuid,
  p_shift_id uuid
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

  -- Autorreparar antes de listar (órdenes con tag del turno cerrado / NULL).
  PERFORM public.repair_open_shift_order_cash_shift_ids(p_branch_id);

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
      EXISTS (
        SELECT 1 FROM public.payments p WHERE p.order_id = ob.id
      ) AS has_any_payment,
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
  target_items AS (
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id IN (SELECT id FROM orders_base)
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
      )::int AS quantity_ready_available
    FROM target_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
  ),
  mods AS (
    SELECT
      oim.order_item_id,
      COALESCE(m.description, '') AS description
    FROM public.order_item_modifiers oim
    LEFT JOIN public.modifiers m ON m.id = oim.modifier_id
    WHERE oim.order_item_id IN (SELECT id FROM target_items)
      AND COALESCE(m.description, '') <> ''
  ),
  creator_ids AS (
    SELECT DISTINCT created_by AS user_id
    FROM orders_base
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
      SELECT jsonb_agg(to_jsonb(ob) ORDER BY ob.updated_at ASC)
      FROM orders_base ob
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(ie) ORDER BY ie.created_at ASC NULLS LAST)
      FROM items_enriched ie
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
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
      FROM public.restaurant_tables t
      WHERE t.id IN (SELECT table_id FROM orders_base WHERE table_id IS NOT NULL)
    ), '[]'::jsonb),
    'splits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'split_code', s.split_code))
      FROM public.table_splits s
      WHERE s.id IN (SELECT split_id FROM orders_base WHERE split_id IS NOT NULL)
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

REVOKE ALL ON FUNCTION public.get_dispatch_servir_queue_bundle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dispatch_servir_queue_bundle(uuid, uuid) TO authenticated;

SELECT public.repair_open_shift_order_cash_shift_ids(NULL);

NOTIFY pgrst, 'reload schema';
