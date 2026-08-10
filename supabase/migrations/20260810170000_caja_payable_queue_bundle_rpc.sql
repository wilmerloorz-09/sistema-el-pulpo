-- =============================================================================
-- Cola Caja (payable-orders) en 1 RTT (bundle JSON)
-- =============================================================================
-- Órdenes cobrables del turno + ítems + cantidades operativas + pagos activos
-- + mesas/splits/perfiles/clientes + nodos de menú para imagen.
-- La elegibilidad orderIsPayableInCaja / workflow sigue en el cliente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_caja_payable_queue_bundle(
  p_branch_id uuid,
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_result jsonb;
BEGIN
  IF p_branch_id IS NULL OR p_shift_id IS NULL THEN
    RETURN jsonb_build_object(
      'orders', '[]'::jsonb,
      'items', '[]'::jsonb,
      'tables', '[]'::jsonb,
      'splits', '[]'::jsonb,
      'profiles', '[]'::jsonb,
      'clientes', '[]'::jsonb,
      'menu_nodes', '[]'::jsonb,
      'payments_total_by_order', '[]'::jsonb
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN jsonb_build_object(
      'orders', '[]'::jsonb,
      'items', '[]'::jsonb,
      'tables', '[]'::jsonb,
      'splits', '[]'::jsonb,
      'profiles', '[]'::jsonb,
      'clientes', '[]'::jsonb,
      'menu_nodes', '[]'::jsonb,
      'payments_total_by_order', '[]'::jsonb
    );
  END IF;

  WITH orders_base AS (
    SELECT
      o.id,
      o.order_number,
      o.order_code,
      o.order_type,
      o.table_id,
      o.split_id,
      o.status,
      o.is_special,
      o.is_tray_order,
      o.created_by,
      o.created_at,
      o.sent_to_kitchen_at,
      o.special_total_manual,
      o.special_group_total,
      o.special_origin_table_id,
      o.table_name_snapshot,
      o.locked_for_editing,
      o.notes,
      o.cliente_id,
      o.cash_shift_id,
      o.updated_at
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.cash_shift_id = p_shift_id
      AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
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
      AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
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
      oi.paid_at,
      oi.tray_item_type,
      oi.tray_container_cost,
      oi.cantidad_especial,
      COALESCE(p.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(r.quantity_ready_total, 0)::int AS quantity_ready_total,
      COALESCE(d.quantity_dispatched_total, 0)::int AS quantity_dispatched_total,
      COALESCE(c.quantity_cancelled_pending, 0)::int AS quantity_cancelled_pending,
      COALESCE(c.quantity_cancelled_ready, 0)::int AS quantity_cancelled_ready,
      COALESCE(c.quantity_cancelled_dispatched, 0)::int AS quantity_cancelled_dispatched,
      COALESCE(c.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    FROM target_items oi
    LEFT JOIN paid p ON p.order_item_id = oi.id
    LEFT JOIN ready r ON r.order_item_id = oi.id
    LEFT JOIN dispatched d ON d.order_item_id = oi.id
    LEFT JOIN cancelled c ON c.order_item_id = oi.id
  ),
  pay_totals AS (
    SELECT
      p.order_id,
      COALESCE(SUM(p.amount), 0)::numeric AS amount
    FROM public.payments p
    WHERE p.order_id IN (SELECT id FROM orders_base)
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
      AND LOWER(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
    GROUP BY p.order_id
  ),
  table_ids AS (
    SELECT table_id AS id FROM orders_base WHERE table_id IS NOT NULL
    UNION
    SELECT special_origin_table_id AS id FROM orders_base WHERE special_origin_table_id IS NOT NULL
  ),
  product_ids AS (
    SELECT DISTINCT product_id
    FROM items_enriched
    WHERE product_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(ob) ORDER BY ob.updated_at DESC)
      FROM orders_base ob
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(ie))
      FROM items_enriched ie
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'visual_order', t.visual_order
      ))
      FROM public.restaurant_tables t
      WHERE t.id IN (SELECT id FROM table_ids)
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
      WHERE p.id IN (SELECT DISTINCT created_by FROM orders_base WHERE created_by IS NOT NULL)
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'cedula', c.cedula,
        'nombres', c.nombres,
        'apellidos', c.apellidos
      ))
      FROM public.clientes c
      WHERE c.id IN (SELECT DISTINCT cliente_id FROM orders_base WHERE cliente_id IS NOT NULL)
    ), '[]'::jsonb),
    'menu_nodes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mn.id,
        'legacy_product_id', mn.legacy_product_id,
        'image_url', mn.image_url,
        'icon', mn.icon
      ))
      FROM public.menu_nodes mn
      WHERE mn.branch_id = p_branch_id
        AND mn.is_active IS TRUE
        AND mn.legacy_product_id IN (SELECT product_id FROM product_ids)
    ), '[]'::jsonb),
    'payments_total_by_order', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', pt.order_id,
        'amount', pt.amount
      ))
      FROM pay_totals pt
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_caja_payable_queue_bundle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_caja_payable_queue_bundle(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
