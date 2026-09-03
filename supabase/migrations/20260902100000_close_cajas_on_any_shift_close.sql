-- =============================================================================
-- Cerrar aperturas de caja en cualquier cierre de turno
-- =============================================================================
-- cleanup_and_close_stale_shift (turno expirado) cerraba cash_shifts.caja_status
-- pero dejaba cash_register_openings en status 'abierta', por lo que no aparecían
-- en Cierres de caja. Este cambio:
--   1) Helper reutilizable close_all_open_shift_cash_register_openings
--   2) Actualiza los RPC de cierre de turno para usarlo
--   3) Trigger BEFORE en cash_shifts como red de seguridad

CREATE OR REPLACE FUNCTION public.close_all_open_shift_cash_register_openings(
  p_shift_id uuid,
  p_auto_note text DEFAULT 'Auto-cierre al cerrar turno'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_note text := COALESCE(NULLIF(btrim(p_auto_note), ''), 'Auto-cierre al cerrar turno');
  v_closed integer := 0;
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.cash_register_openings cro
  SET status = 'cerrada',
      closed_at = COALESCE(cro.closed_at, v_now),
      notes = CASE
        WHEN COALESCE(btrim(cro.notes), '') = '' THEN v_note
        WHEN cro.notes ILIKE ('%' || v_note || '%') THEN cro.notes
        ELSE cro.notes || ' | ' || v_note
      END,
      updated_at = v_now
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta';

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_all_open_shift_cash_register_openings(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_all_open_shift_cash_register_openings(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_close_openings_when_shift_closes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'OPEN'
    AND NEW.status = 'CLOSED'
  THEN
    PERFORM public.close_all_open_shift_cash_register_openings(
      NEW.id,
      'Auto-cierre al cerrar turno'
    );

    IF NEW.caja_status = 'OPEN' THEN
      NEW.caja_status := 'CLOSED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_openings_when_shift_closes ON public.cash_shifts;
CREATE TRIGGER trg_close_openings_when_shift_closes
BEFORE UPDATE OF status ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.trg_close_openings_when_shift_closes();

-- Turno expirado (Admin > Turno cuando is_stale)
CREATE OR REPLACE FUNCTION public.cleanup_and_close_stale_shift(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT 'Cierre automático de turno expirado (Limpieza de sistema)'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cash_shifts
    WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido para cerrar';
  END IF;

  DELETE FROM public.order_items
  WHERE order_id IN (
    SELECT id FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders
  WHERE branch_id = p_branch_id
    AND status = 'DRAFT';

  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  PERFORM public.close_all_open_shift_cash_register_openings(
    p_shift_id,
    'Auto-cierre: turno expirado'
  );

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = p_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_and_close_stale_shift(uuid, uuid, text) TO authenticated;

-- Forzar cierre (Administracion > Forzar cierre de turno)
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

  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  GET DIAGNOSTICS v_paid_closed = ROW_COUNT;

  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  GET DIAGNOSTICS v_ops_closed = ROW_COUNT;

  v_openings_closed := public.close_all_open_shift_cash_register_openings(
    p_shift_id,
    'Auto-cierre: cierre forzado de turno'
  );

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = v_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

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

-- Cierre normal (Admin > Turno): red de seguridad tras pasar bloqueos
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
  v_actor_id uuid := auth.uid();
  v_now timestamptz := now();
  v_blockers_message text;
BEGIN
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

  PERFORM public.cancel_empty_draft_orders_for_branch(p_branch_id);

  UPDATE public.orders o
  SET status = 'KITCHEN_DISPATCHED',
      dispatched_at = COALESCE(o.dispatched_at, v_now),
      closed_at = COALESCE(o.closed_at, v_now),
      updated_at = v_now
  WHERE o.branch_id = p_branch_id
    AND o.cash_shift_id IS NOT DISTINCT FROM p_shift_id
    AND COALESCE(o.is_special, false)
    AND o.status = 'PAID'
    AND o.paid_at IS NOT NULL
    AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%';

  UPDATE public.cash_register_openings cro
  SET status = 'cerrada',
      closed_at = COALESCE(cro.closed_at, v_now),
      notes = CASE
        WHEN COALESCE(btrim(cro.notes), '') = '' THEN 'Auto-cierre: admin sin cobros al cerrar turno'
        WHEN cro.notes ILIKE '%Auto-cierre: admin sin cobros%' THEN cro.notes
        ELSE cro.notes || ' | Auto-cierre: admin sin cobros al cerrar turno'
      END,
      updated_at = v_now
  WHERE cro.shift_id = p_shift_id
    AND cro.branch_id = p_branch_id
    AND cro.status = 'abierta'
    AND public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
    AND NOT public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id);

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  v_blockers_message := public.format_shift_closure_blockers_message(p_branch_id);
  IF v_blockers_message IS NOT NULL AND btrim(v_blockers_message) <> '' THEN
    RAISE EXCEPTION '%', v_blockers_message;
  END IF;

  PERFORM public.close_all_open_shift_cash_register_openings(
    p_shift_id,
    'Auto-cierre al cerrar turno'
  );

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = p_notes,
      closed_by = v_actor_id,
      closed_from_device = NULLIF(btrim(COALESCE(p_closed_from_device, '')), ''),
      closed_from_user_agent = NULLIF(btrim(COALESCE(p_closed_from_user_agent, '')), ''),
      caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text, text, text) TO authenticated;

-- Reparar aperturas colgadas en turnos ya cerrados (p. ej. cierres expirados anteriores)
UPDATE public.cash_register_openings cro
SET status = 'cerrada',
    closed_at = COALESCE(cro.closed_at, cs.closed_at, cs.opened_at, now()),
    notes = CASE
      WHEN COALESCE(btrim(cro.notes), '') = '' THEN 'Auto-cierre retroactivo: turno ya cerrado'
      WHEN cro.notes ILIKE '%Auto-cierre retroactivo%' THEN cro.notes
      ELSE cro.notes || ' | Auto-cierre retroactivo: turno ya cerrado'
    END,
    updated_at = now()
FROM public.cash_shifts cs
WHERE cs.id = cro.shift_id
  AND cs.status = 'CLOSED'
  AND cro.status = 'abierta';
