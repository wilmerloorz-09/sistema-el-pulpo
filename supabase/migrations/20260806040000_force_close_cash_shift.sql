-- =============================================================================
-- Forzar cierre de turno desde Administracion (UI)
-- =============================================================================
-- Misma logica operativa que forzar_cierre_turno_local_principal.sql /
-- cleanup_and_close_stale_shift, con permiso can_manage_shift_admin.
-- Cierra aunque haya caja abierta u ordenes pendientes (a diferencia del
-- cierre normal close_cash_shift_with_tables).

CREATE OR REPLACE FUNCTION public.force_close_cash_shift(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT 'Cierre forzado desde Administracion'
)
RETURNS TABLE (
  drafts_deleted integer,
  paid_closed integer,
  ops_closed integer,
  openings_closed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
  v_drafts_deleted integer := 0;
  v_paid_closed integer := 0;
  v_ops_closed integer := 0;
  v_openings_closed integer := 0;
  v_notes text := COALESCE(NULLIF(trim(p_notes), ''), 'Cierre forzado desde Administracion');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permiso para forzar el cierre de turno.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts
    WHERE id = p_shift_id
      AND branch_id = p_branch_id
      AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido para cerrar';
  END IF;

  -- 1. Borradores: items → payment_items → payments → orders
  DELETE FROM public.order_items
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.payment_items
  WHERE payment_id IN (
    SELECT p.id
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE o.branch_id = p_branch_id
      AND o.status = 'DRAFT'
  );

  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders
  WHERE branch_id = p_branch_id
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_drafts_deleted = ROW_COUNT;

  -- 2. PAID sin despachar: despachar y cerrar
  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  GET DIAGNOSTICS v_paid_closed = ROW_COUNT;

  -- 3. Operativas pendientes → PAID
  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  GET DIAGNOSTICS v_ops_closed = ROW_COUNT;

  -- 4. Aperturas de caja del turno
  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = COALESCE(closed_at, v_now)
  WHERE shift_id = p_shift_id
    AND status = 'abierta';

  GET DIAGNOSTICS v_openings_closed = ROW_COUNT;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  -- 5. Cerrar turno
  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = v_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  -- 6. Desactivar mesas
  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;

  drafts_deleted := v_drafts_deleted;
  paid_closed := v_paid_closed;
  ops_closed := v_ops_closed;
  openings_closed := v_openings_closed;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.force_close_cash_shift(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_close_cash_shift(uuid, uuid, text) TO authenticated;
