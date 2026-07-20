-- =============================================================================
-- Fix: timeout al cerrar turno en sucursales con mucho volumen (p. ej. Local Principal)
-- =============================================================================
-- Causa: close_cash_shift_with_tables llamaba list_branch_closure_blocking_orders
-- dos veces, y esa función invocaba order_is_fully_dispatched →
-- get_order_operational_snapshot por cada orden PAID del turno (N+1 pesado).
-- Además cancel_empty_draft_orders_for_branch escaneaba borradores de toda la
-- sucursal (historial), no solo del turno abierto.
--
-- Solución:
--   1) list_branch_closure_blocking_orders: chequeo set-based de despacho pendiente
--   2) cancel_empty_draft_orders_for_branch: acotado al turno OPEN
--   3) close_cash_shift_with_tables: una sola pasada + statement_timeout local

-- ─── 1. Cancelar borradores vacíos solo del turno abierto ─────────────────────

CREATE OR REPLACE FUNCTION public.cancel_empty_draft_orders_for_branch(
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_updated integer := 0;
  v_open_shift_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  SELECT cs.id
  INTO v_open_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_open_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.shift_close_cancelable_orders (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.shift_close_cancelable_orders;

  INSERT INTO pg_temp.shift_close_cancelable_orders (id)
  SELECT o.id
  FROM public.orders o
  WHERE o.branch_id = p_branch_id
    AND o.cash_shift_id IS NOT DISTINCT FROM v_open_shift_id
    AND o.status = 'DRAFT'
    AND NOT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.status <> 'DRAFT'
    )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.orders o
  SET status = 'CANCELLED',
      cancelled_at = COALESCE(o.cancelled_at, v_now),
      updated_at = v_now
  WHERE o.id IN (
    SELECT id
    FROM pg_temp.shift_close_cancelable_orders
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.order_items oi
  SET status = 'CANCELLED',
      cancelled_at = COALESCE(oi.cancelled_at, v_now),
      cancelled_from_status = COALESCE(oi.cancelled_from_status, oi.status)
  WHERE oi.order_id IN (
    SELECT id
    FROM pg_temp.shift_close_cancelable_orders
  )
    AND oi.status = 'DRAFT';

  RETURN v_updated;
END;
$$;

-- ─── 2. Bloqueantes de cierre sin snapshot por fila ───────────────────────────

CREATE OR REPLACE FUNCTION public.list_branch_closure_blocking_orders(
  p_branch_id uuid
)
RETURNS TABLE (
  order_id uuid,
  reference_label text,
  order_status public.order_status,
  paid_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_shift AS (
    SELECT cs.id AS shift_id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  shift_orders AS (
    SELECT o.*
    FROM public.orders o
    CROSS JOIN open_shift os
    WHERE o.branch_id = p_branch_id
      AND o.cash_shift_id IS NOT DISTINCT FROM os.shift_id
      AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
  ),
  paid_candidates AS (
    SELECT so.id
    FROM shift_orders so
    WHERE so.status = 'PAID'
      AND NOT COALESCE(so.is_special, false)
  ),
  item_ops AS (
    SELECT
      oi.order_id,
      oi.id AS order_item_id,
      COALESCE(oi.quantity, 0)::int AS quantity_ordered
    FROM public.order_items oi
    JOIN paid_candidates pc ON pc.id = oi.order_id
    WHERE oi.status <> 'DRAFT'
      AND COALESCE(oi.quantity, 0) > 0
  ),
  dispatched AS (
    SELECT
      oide.order_item_id,
      COALESCE(SUM(oide.quantity_dispatched), 0)::int AS quantity_dispatched_total
    FROM public.order_item_dispatch_events oide
    JOIN public.order_dispatch_events ode
      ON ode.id = oide.order_dispatch_event_id
    JOIN item_ops io
      ON io.order_item_id = oide.order_item_id
    WHERE ode.status = 'APPLIED'
    GROUP BY oide.order_item_id
  ),
  cancelled AS (
    SELECT
      oic.order_item_id,
      COALESCE(SUM(oic.quantity_cancelled), 0)::int AS quantity_cancelled_total,
      COALESCE(
        SUM(oic.quantity_cancelled) FILTER (WHERE oic.source_stage = 'DISPATCHED'),
        0
      )::int AS quantity_cancelled_dispatched
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc
      ON oc.id = oic.order_cancellation_id
    JOIN item_ops io
      ON io.order_item_id = oic.order_item_id
    WHERE oc.status = 'APPLIED'
    GROUP BY oic.order_item_id
  ),
  -- PAID con unidades activas sin despachar (equivalente a NOT order_is_fully_dispatched)
  paid_with_pending_dispatch AS (
    SELECT DISTINCT io.order_id
    FROM item_ops io
    LEFT JOIN dispatched d ON d.order_item_id = io.order_item_id
    LEFT JOIN cancelled c ON c.order_item_id = io.order_item_id
    WHERE GREATEST(0, io.quantity_ordered - COALESCE(c.quantity_cancelled_total, 0))
        > GREATEST(
            0,
            COALESCE(d.quantity_dispatched_total, 0)
              - COALESCE(c.quantity_cancelled_dispatched, 0)
          )
    UNION
    -- PAID sin ítems operativos: order_is_fully_dispatched = false → bloquea
    SELECT pc.id
    FROM paid_candidates pc
    WHERE NOT EXISTS (
      SELECT 1
      FROM item_ops io
      WHERE io.order_id = pc.id
    )
  )
  SELECT
    o.id AS order_id,
    CASE
      WHEN COALESCE(o.is_special, false) THEN
        'Orden especial'
      WHEN COALESCE(o.is_tray_order, false) THEN
        'Bandeja'
      WHEN o.order_type = 'TAKEOUT' THEN
        'Para llevar'
      WHEN o.order_type = 'EXPRESS' THEN
        'Express'
      WHEN o.order_type = 'EXTRA' THEN
        'Extra'
      WHEN o.order_type = 'DINE_IN' AND ts.split_code IS NOT NULL THEN
        COALESCE(rt.name, 'Mesa') || ' ' || ts.split_code
      WHEN o.order_type = 'DINE_IN' THEN
        COALESCE(rt.name, o.table_name_snapshot, 'Mesa')
      ELSE
        'Orden'
    END AS reference_label,
    o.status AS order_status,
    o.paid_at,
    o.created_at,
    o.updated_at
  FROM shift_orders o
  LEFT JOIN public.restaurant_tables rt
    ON rt.id = o.table_id
  LEFT JOIN public.table_splits ts
    ON ts.id = o.split_id
  WHERE
    (
      o.status = 'DRAFT'
      AND (
        EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.order_id = o.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id = o.id
            AND oi.status <> 'DRAFT'
        )
      )
    )
    OR o.status IN ('SENT_TO_KITCHEN', 'READY')
    OR (o.status = 'KITCHEN_DISPATCHED' AND o.paid_at IS NULL)
    OR (
      o.status = 'PAID'
      AND (
        COALESCE(o.is_special, false)
        OR o.id IN (SELECT order_id FROM paid_with_pending_dispatch)
      )
    )
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST;
$$;

-- ─── 3. Cierre de turno: una sola evaluación + timeout local ──────────────────

CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL,
  p_closed_from_device text DEFAULT NULL,
  p_closed_from_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_pending_orders_count integer := 0;
  v_pending_orders_preview text := '';
  v_actor_id uuid := auth.uid();
BEGIN
  -- Sucursales con alto volumen (Local Principal) pueden superar el timeout default.
  SET LOCAL statement_timeout = '120s';

  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'No puedes cerrar el turno porque la caja esta abierta. Cierra la caja en el modulo Caja y vuelve a intentarlo.';
  END IF;

  PERFORM public.cancel_empty_draft_orders_for_branch(p_branch_id);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.shift_close_blockers (
    order_id uuid PRIMARY KEY,
    reference_label text
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.shift_close_blockers;

  INSERT INTO pg_temp.shift_close_blockers (order_id, reference_label)
  SELECT b.order_id, b.reference_label
  FROM public.list_branch_closure_blocking_orders(p_branch_id) b
  ON CONFLICT (order_id) DO NOTHING;

  SELECT COUNT(*)::int
  INTO v_pending_orders_count
  FROM pg_temp.shift_close_blockers;

  IF v_pending_orders_count > 0 THEN
    SELECT COALESCE(string_agg(reference_label, ', '), '')
    INTO v_pending_orders_preview
    FROM (
      SELECT reference_label
      FROM pg_temp.shift_close_blockers
      LIMIT 5
    ) AS pending_refs;

    RAISE EXCEPTION
      'No puedes cerrar el turno porque aun existen ordenes o cobros pendientes. Finaliza o cobra esas ordenes primero.%s',
      CASE
        WHEN v_pending_orders_preview <> '' THEN ' Referencias: ' || v_pending_orders_preview
        ELSE ''
      END;
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes,
      closed_by = v_actor_id,
      closed_from_device = NULLIF(btrim(COALESCE(p_closed_from_device, '')), ''),
      closed_from_user_agent = NULLIF(btrim(COALESCE(p_closed_from_user_agent, '')), '')
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_empty_draft_orders_for_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_branch_closure_blocking_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
