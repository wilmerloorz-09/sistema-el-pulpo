-- =============================================================================
-- Anulacion de pago: la orden queda ANULADA (CANCELLED) y sale de Recaudar.
-- =============================================================================
-- Antes: al anular el ultimo pago activo, la orden se reabria (SENT_TO_KITCHEN)
-- y volvia a aparecer en Recaudar como pendiente de cobro.
-- Ahora: si no quedan pagos activos, la orden queda CANCELLED (sale de Recaudar,
-- de Ordenes y libera la mesa). Puede re-cobrarse bajo demanda con el boton
-- "Cobrar orden" de Pagos realizados (preparar_orden_para_recobro la reabre).
-- Si quedan pagos activos (anulacion parcial con pago de reemplazo) se mantiene
-- el comportamiento anterior: reabrir y dejar que sync recalcule (queda PAID).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_successor_order_after_payment_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_has_active_payments boolean := false;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(lower(NEW.status), '') <> 'voided'
    OR COALESCE(lower(OLD.status), '') = 'voided'
    OR NEW.voided_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Historicas de anulacion previa (flujo con sucesora): no modificar.
  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RETURN NEW;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.order_id = v_order.id
      AND p.id <> NEW.id
      AND COALESCE(lower(p.status), '') <> 'voided'
  )
  INTO v_has_active_payments;

  IF v_has_active_payments THEN
    -- Anulacion parcial (queda pago de reemplazo u otros pagos activos):
    -- reabrir la orden para que sync recalcule su estado real.
    UPDATE public.orders
    SET
      status = 'SENT_TO_KITCHEN'::public.order_status,
      paid_at = NULL,
      token_promocion = NULL,
      cancelled_at = NULL,
      cancelled_by = NULL,
      cancellation_reason = NULL,
      cancelled_from_status = NULL,
      notes = public.append_payment_note_marker(
        public.append_payment_note_marker(
          v_order.notes,
          'VOIDED_PAYMENT:' || NEW.id::text
        ),
        'VOIDED_PAYMENT_REOPEN:' || NEW.id::text
      ),
      updated_at = now()
    WHERE id = v_order.id;

    UPDATE public.order_items
    SET paid_at = NULL
    WHERE order_id = v_order.id
      AND paid_at IS NOT NULL;

    PERFORM public.sync_order_payment_state_internal(v_order.id);
    PERFORM public.restore_voided_dine_in_order_to_table(v_order.id);

    RETURN NEW;
  END IF;

  -- Sin pagos activos: la orden queda anulada. No vuelve a Recaudar; se puede
  -- re-cobrar bajo demanda desde Pagos realizados (preparar_orden_para_recobro).
  UPDATE public.orders
  SET
    status = 'CANCELLED'::public.order_status,
    paid_at = NULL,
    token_promocion = NULL,
    cancelled_at = now(),
    cancelled_by = COALESCE(NEW.voided_by, cancelled_by),
    cancellation_reason = COALESCE(
      'Pago anulado: ' || NULLIF(btrim(COALESCE(NEW.void_reason, '')), ''),
      'Pago anulado'
    ),
    cancelled_from_status = COALESCE(v_order.cancelled_from_status, v_order.status::text),
    table_order_position = NULL,
    notes = public.append_payment_note_marker(
      public.append_payment_note_marker(
        v_order.notes,
        'VOIDED_PAYMENT:' || NEW.id::text
      ),
      'VOIDED_PAYMENT_CLOSED:' || NEW.id::text
    ),
    updated_at = now()
  WHERE id = v_order.id;

  UPDATE public.order_items
  SET paid_at = NULL
  WHERE order_id = v_order.id
    AND paid_at IS NOT NULL;

  IF v_order.table_id IS NOT NULL THEN
    PERFORM public.compact_table_order_positions(v_order.table_id);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_successor_order_after_payment_void() IS
  'Tras anular un pago: si no quedan pagos activos la orden queda CANCELLED (sale de Recaudar); si quedan pagos activos se reabre para re-sincronizar. Re-cobro bajo demanda via preparar_orden_para_recobro.';

-- =============================================================================
-- Guard: recompute no debe resucitar ordenes cerradas por anulacion de pago
-- (tienen items activos sin cancelar, por lo que el recompute normal las
-- devolveria a KITCHEN_DISPATCHED).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recompute_order_operational_state(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pending_prepare integer := 0;
  v_ready_available integer := 0;
  v_dispatched_net integer := 0;
  v_cancelled_total integer := 0;
  v_active_not_cancelled integer := 0;
  v_next_status public.order_status;
  v_last_ready_at timestamptz;
  v_last_dispatched_at timestamptz;
  v_release_table_id uuid := NULL;
  v_table_name text := 'Mesa';
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    UPDATE public.orders
    SET status = 'CANCELLED',
        paid_at = NULL,
        table_id = NULL,
        split_id = NULL,
        table_order_position = NULL,
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_at = now()
    WHERE id = p_order_id;
    RETURN;
  END IF;

  -- Orden cerrada por anulacion de pago: conservarla CANCELLED aunque tenga
  -- items activos (el re-cobro la reabre explicitamente).
  IF v_order.status = 'CANCELLED'
     AND COALESCE(v_order.notes, '') ILIKE '%VOIDED_PAYMENT_CLOSED:%' THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(quantity_pending_prepare), 0)::int,
    COALESCE(SUM(quantity_ready_available), 0)::int,
    COALESCE(SUM(quantity_dispatched_total - quantity_cancelled_dispatched), 0)::int,
    COALESCE(SUM(quantity_cancelled_total), 0)::int,
    COALESCE(SUM(quantity_ordered - quantity_cancelled_total), 0)::int
  INTO v_pending_prepare, v_ready_available, v_dispatched_net, v_cancelled_total, v_active_not_cancelled
  FROM public.get_order_operational_snapshot(p_order_id);

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

  IF v_order.status <> 'DRAFT' AND v_active_not_cancelled <= 0 THEN
    v_next_status := 'CANCELLED';
  ELSIF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
    v_next_status := 'CANCELLED';
  ELSIF v_pending_prepare = 0 AND v_ready_available = 0 AND v_dispatched_net > 0 THEN
    v_next_status := 'KITCHEN_DISPATCHED';
  ELSIF v_order.status = 'PAID' OR v_order.paid_at IS NOT NULL THEN
    v_next_status := 'PAID';
  ELSIF v_pending_prepare = 0 AND v_ready_available > 0 THEN
    v_next_status := 'READY';
  ELSIF v_pending_prepare > 0 THEN
    v_next_status := 'SENT_TO_KITCHEN';
  ELSE
    v_next_status := v_order.status;
  END IF;

  IF v_next_status = 'KITCHEN_DISPATCHED'
     AND v_order.order_type = 'DINE_IN'
     AND COALESCE(v_order.is_special, false) IS NOT TRUE
     AND v_order.paid_at IS NOT NULL
     AND v_order.table_id IS NOT NULL THEN
    v_release_table_id := v_order.table_id;
    SELECT rt.name
    INTO v_table_name
    FROM public.restaurant_tables rt
    WHERE rt.id = v_release_table_id;
  END IF;

  UPDATE public.orders
  SET
    status = v_next_status,
    table_name_snapshot = CASE
      WHEN v_release_table_id IS NOT NULL
        THEN COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa')
      ELSE table_name_snapshot
    END,
    table_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_id END,
    table_order_position = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE table_order_position END,
    split_id = CASE WHEN v_release_table_id IS NOT NULL THEN NULL ELSE split_id END,
    ready_at = CASE
      WHEN v_next_status IN ('READY', 'KITCHEN_DISPATCHED') THEN COALESCE(ready_at, v_last_ready_at, now())
      ELSE ready_at
    END,
    dispatched_at = CASE
      WHEN v_next_status = 'KITCHEN_DISPATCHED' THEN COALESCE(dispatched_at, v_last_dispatched_at, now())
      ELSE dispatched_at
    END,
    cancelled_at = CASE
      WHEN v_next_status = 'CANCELLED' THEN COALESCE(cancelled_at, now())
      ELSE cancelled_at
    END,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_release_table_id IS NOT NULL THEN
    PERFORM public.compact_table_order_positions(v_release_table_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_order_operational_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_order_operational_state(uuid) TO authenticated;

-- =============================================================================
-- Backfill: ordenes ya reabiertas por anulacion de pago y sin pagos activos
-- (hoy visibles en Recaudar) pasan a CANCELLED.
-- =============================================================================

DO $$
DECLARE
  r record;
  v_fixed integer := 0;
BEGIN
  FOR r IN
    SELECT o.id, o.table_id, o.status
    FROM public.orders o
    WHERE o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      AND COALESCE(o.notes, '') ILIKE '%VOIDED_PAYMENT_REOPEN:%'
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.order_id = o.id
          AND COALESCE(lower(p.status), '') <> 'voided'
      )
  LOOP
    UPDATE public.orders
    SET
      status = 'CANCELLED',
      paid_at = NULL,
      cancelled_at = COALESCE(cancelled_at, now()),
      cancellation_reason = COALESCE(cancellation_reason, 'Pago anulado'),
      cancelled_from_status = COALESCE(cancelled_from_status, r.status::text),
      table_order_position = NULL,
      notes = public.append_payment_note_marker(notes, 'VOIDED_PAYMENT_CLOSED:BACKFILL'),
      updated_at = now()
    WHERE id = r.id;

    IF r.table_id IS NOT NULL THEN
      PERFORM public.compact_table_order_positions(r.table_id);
    END IF;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Ordenes reabiertas por anulacion cerradas: %', v_fixed;
END;
$$;

NOTIFY pgrst, 'reload schema';
