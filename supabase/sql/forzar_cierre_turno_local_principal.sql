-- =============================================================================
-- Forzar cierre de turno (misma lógica que turno expirado / día a día)
-- =============================================================================
-- Uso: pegar en Supabase → SQL Editor → Run
-- Equivale a cleanup_and_close_stale_shift (Admin > Turno cuando is_stale).
--
-- Qué hace:
--   1. Borra órdenes DRAFT (y sus items/pagos) de la sucursal
--   2. Marca PAID sin despachar como despachadas/cerradas
--   3. Cierra SENT_TO_KITCHEN / READY / KITCHEN_DISPATCHED como PAID
--   4. Cierra cajas abiertas del turno + el turno
--   5. Desactiva mesas
--
-- Ajusta el nombre de sucursal abajo si hace falta.

SET statement_timeout = '180s';

DO $$
DECLARE
  v_branch_id uuid;
  v_branch_name text;
  v_shift_id uuid;
  v_shift_opened_at timestamptz;
  v_now timestamptz := now();
  v_notes text := 'Cierre forzado manual (misma lógica que turno expirado)';
  v_drafts_deleted integer := 0;
  v_paid_closed integer := 0;
  v_ops_closed integer := 0;
  v_openings_closed integer := 0;
BEGIN
  -- ── Sucursal ──────────────────────────────────────────────────────────────
  SELECT b.id, b.name
  INTO v_branch_id, v_branch_name
  FROM public.branches b
  WHERE b.name ILIKE '%Local Principal%'
  ORDER BY b.name
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la sucursal "Local Principal". Revisa el nombre en public.branches.';
  END IF;

  -- ── Turno OPEN ────────────────────────────────────────────────────────────
  SELECT cs.id, cs.opened_at
  INTO v_shift_id, v_shift_opened_at
  FROM public.cash_shifts cs
  WHERE cs.branch_id = v_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno OPEN en "%". Nada que cerrar.', v_branch_name;
  END IF;

  RAISE NOTICE 'Cerrando turno % de "%" (abierto %).', v_shift_id, v_branch_name, v_shift_opened_at;

  -- ── 1 y 2. Borradores: eliminar items → pagos → órdenes ───────────────────
  DELETE FROM public.order_items
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = v_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.payment_items
  WHERE payment_id IN (
    SELECT p.id
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE o.branch_id = v_branch_id
      AND o.status = 'DRAFT'
  );

  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = v_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders
  WHERE branch_id = v_branch_id
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_drafts_deleted = ROW_COUNT;

  -- ── 3. PAID sin despachar: despachar y cerrar ─────────────────────────────
  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = v_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  GET DIAGNOSTICS v_paid_closed = ROW_COUNT;

  -- ── 4. En caja / despachadas pendientes: marcar PAID y cerrar ─────────────
  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = v_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  GET DIAGNOSTICS v_ops_closed = ROW_COUNT;

  -- ── 5. Cerrar aperturas de caja del turno (multi-cajero) ───────────────────
  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = COALESCE(closed_at, v_now)
  WHERE shift_id = v_shift_id
    AND status = 'abierta';

  GET DIAGNOSTICS v_openings_closed = ROW_COUNT;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = v_shift_id
    AND branch_id = v_branch_id
    AND caja_status = 'OPEN';

  -- ── 6. Cerrar el turno ────────────────────────────────────────────────────
  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = v_notes,
      closed_by = auth.uid()
  WHERE id = v_shift_id
    AND branch_id = v_branch_id
    AND status = 'OPEN';

  -- ── 7. Desactivar mesas ───────────────────────────────────────────────────
  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = v_branch_id;

  RAISE NOTICE
    'Listo. Sucursal="%". Turno=%. Borradores eliminados=%. PAID cerradas=%. Operativas→PAID=%. Aperturas caja cerradas=%.',
    v_branch_name,
    v_shift_id,
    v_drafts_deleted,
    v_paid_closed,
    v_ops_closed,
    v_openings_closed;
END;
$$;
