-- =============================================================================
-- Migración: Fix orden total desincronizado y estado PAID para TAKEOUT/EXPRESS
-- =============================================================================
-- Problema 1: orders.total no se actualiza al pagar — solo al cancelar items.
--   Solución: sync_order_payment_state_internal ahora recalcula y persiste total
--             desde los order_items activos antes de evaluar si está pagado.
--
-- Problema 2: Para TAKEOUT/EXPRESS ya en KITCHEN_DISPATCHED, aunque v_all_fully_paid
--   sea true, el status quedaba en KITCHEN_DISPATCHED y nunca en PAID.
--   Esto impedía que orden_promocion_token_trigger generase el token de promoción.
--   Solución: Para TAKEOUT/EXPRESS pagados en modo DISPATCH_THEN_CASH, si ya están
--   despachados (KITCHEN_DISPATCHED), el estado final pasa a PAID correctamente.
-- =============================================================================

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
  v_order           public.orders%ROWTYPE;
  v_branch          record;
  v_now             timestamptz := now();
  v_pending_prepare integer     := 0;
  v_ready_available integer     := 0;
  v_dispatched_available integer := 0;
  v_cancelled_total integer     := 0;
  v_active_not_cancelled integer := 0;
  v_item_count      integer     := 0;
  v_all_fully_paid  boolean     := false;
  v_operational_status public.order_status;
  v_final_status    public.order_status;
  v_final_paid_at   timestamptz;
  v_last_ready_at   timestamptz;
  v_last_dispatched_at timestamptz;
  v_active_payments_total numeric := 0;
  v_special_total   numeric     := 0;
  -- FIX: variable para el total real calculado desde items activos
  v_computed_total  numeric     := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- FIX 1: Recalcular total desde order_items activos (no cancelados)
  -- Esto garantiza que orders.total esté siempre sincronizado, independientemente
  -- de si hubo o no cancelaciones de items.
  SELECT COALESCE(SUM(
    GREATEST(0, oi.quantity - COALESCE(snapshot.quantity_cancelled_total, 0)) * oi.unit_price
  ), 0)
  INTO v_computed_total
  FROM public.order_items oi
  LEFT JOIN public.get_order_operational_snapshot(p_order_id) snapshot
    ON snapshot.order_item_id = oi.id
  WHERE oi.order_id = p_order_id;

  -- Persistir total calculado si difiere (evitar write innecesario)
  IF v_computed_total IS DISTINCT FROM v_order.total THEN
    UPDATE public.orders
    SET total = v_computed_total, updated_at = v_now
    WHERE id = p_order_id;
    v_order.total := v_computed_total;
  END IF;

  SELECT MAX(ore.created_at) INTO v_last_ready_at
  FROM public.order_ready_events ore
  WHERE ore.order_id = p_order_id AND ore.status = 'APPLIED';

  SELECT MAX(ode.created_at) INTO v_last_dispatched_at
  FROM public.order_dispatch_events ode
  WHERE ode.order_id = p_order_id AND ode.status = 'APPLIED';

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
        WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
          GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
        ELSE
          GREATEST(
            0,
            COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
          )
      END::int AS payable_qty,
      LEAST(
        CASE
          WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
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

  -- Lógica especial para órdenes especiales (special_total_manual)
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

  -- Determinar estado operacional
  IF v_order.status <> 'DRAFT' AND v_active_not_cancelled <= 0 THEN
    v_operational_status := 'CANCELLED';
  ELSIF v_active_not_cancelled <= 0 AND v_cancelled_total > 0 THEN
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

  -- Actualizar paid_at de items
  IF COALESCE(v_order.is_special, false) IS NOT TRUE THEN
    WITH item_state AS (
      SELECT
        oi.id AS order_item_id,
        CASE
          WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
            GREATEST(0, COALESCE(oi.quantity, 0)::int - COALESCE(snapshot.quantity_cancelled_total, 0))
          ELSE
            GREATEST(
              0,
              COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
            )
        END::int AS payable_qty,
        LEAST(
          CASE
            WHEN v_order.order_type IN ('TAKEOUT', 'EXPRESS') OR COALESCE(v_order.is_special, false) THEN
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

  -- FIX 2: Determinar estado final
  -- Para TAKEOUT/EXPRESS pagados: siempre marcar como PAID cuando v_all_fully_paid
  -- independientemente del estado operacional (KITCHEN_DISPATCHED o READY).
  -- Antes solo KITCHEN_DISPATCHED bloqueaba el avance a PAID.
  IF v_all_fully_paid THEN
    -- Para tray_order, despacho primero siempre
    IF COALESCE(v_order.is_tray_order, false) AND v_operational_status <> 'KITCHEN_DISPATCHED' THEN
      v_final_status := 'READY';
    ELSE
      -- TAKEOUT, EXPRESS, DINE_IN, EXTRA: si está pagado → PAID
      v_final_status := 'PAID';
    END IF;
    v_final_paid_at := COALESCE(v_order.paid_at, v_now);
  ELSE
    v_final_status := v_operational_status;
    v_final_paid_at := NULL;
  END IF;

  UPDATE public.orders o
  SET
    status      = v_final_status,
    paid_at     = v_final_paid_at,
    ready_at    = CASE
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
    updated_at  = v_now
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT p_order_id, v_final_status::text, v_final_paid_at;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_state_internal(uuid) TO authenticated;

-- =============================================================================
-- FIX 3: Agregar trigger en order_items para mantener orders.total sincronizado
-- en tiempo real cuando se insertan, actualizan o eliminan items.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_sync_order_total_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  -- Determinar el order_id afectado
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recalcular total: suma de (quantity * unit_price) de items no cancelados
  UPDATE public.orders
  SET
    total = COALESCE((
      SELECT SUM(GREATEST(0, oi.quantity) * oi.unit_price)
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
        AND (oi.status IS NULL OR oi.status <> 'CANCELLED')
    ), 0),
    updated_at = now()
  WHERE id = v_order_id
    AND status NOT IN ('PAID', 'CANCELLED');

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Instalar trigger en order_items
DROP TRIGGER IF EXISTS trg_sync_order_total ON public.order_items;
CREATE TRIGGER trg_sync_order_total
  AFTER INSERT OR UPDATE OF quantity, unit_price, status OR DELETE
  ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_order_total_from_items();

-- =============================================================================
-- FIX 4: Reparar órdenes existentes con total desincronizado
-- Actualiza orders.total para todas las órdenes no pagadas ni canceladas
-- cuyo total no coincida con la suma real de sus items.
-- =============================================================================

DO $$
DECLARE
  v_fixed integer := 0;
BEGIN
  WITH recalc AS (
    SELECT
      o.id,
      COALESCE(SUM(
        CASE WHEN oi.status IS DISTINCT FROM 'CANCELLED'
          THEN GREATEST(0, oi.quantity) * oi.unit_price
          ELSE 0
        END
      ), 0) AS real_total
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status NOT IN ('PAID', 'CANCELLED')
    GROUP BY o.id
  )
  UPDATE public.orders o
  SET total = recalc.real_total, updated_at = now()
  FROM recalc
  WHERE recalc.id = o.id
    AND recalc.real_total IS DISTINCT FROM o.total;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'Órdenes con total corregido: %', v_fixed;
END;
$$;

NOTIFY pgrst, 'reload schema';
