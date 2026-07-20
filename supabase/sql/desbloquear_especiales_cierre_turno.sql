-- =============================================================================
-- Desbloquear cierre: ver y finalizar órdenes especiales que bloquean
-- =============================================================================
-- Pegar en Supabase → SQL Editor → Run
-- 1) Lista qué especiales están bloqueando
-- 2) Las finaliza (PAID → despachada/cerrada; pendientes $0 → PAID+cerrada)
-- Luego puedes cerrar el turno desde Admin > Turno (o usar forzar_cierre).

SET statement_timeout = '120s';

-- ── A) Diagnóstico: qué está bloqueando ─────────────────────────────────────
WITH open_shift AS (
  SELECT cs.id AS shift_id, cs.branch_id, b.name AS branch_name
  FROM public.cash_shifts cs
  JOIN public.branches b ON b.id = cs.branch_id
  WHERE b.name ILIKE '%Local Principal%'
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1
)
SELECT
  o.id,
  o.order_code,
  o.order_number,
  o.status,
  o.is_special,
  o.special_total_manual,
  o.total,
  o.paid_at,
  o.dispatched_at,
  o.closed_at,
  o.created_at
FROM public.orders o
JOIN open_shift os ON o.branch_id = os.branch_id
  AND o.cash_shift_id IS NOT DISTINCT FROM os.shift_id
WHERE COALESCE(o.is_special, false)
  AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID', 'KITCHEN_DISPATCHED')
  AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%'
ORDER BY o.updated_at DESC;

-- ── B) Finalizar especiales del turno abierto (desbloquea el cierre) ────────
DO $$
DECLARE
  v_branch_id uuid;
  v_shift_id uuid;
  v_now timestamptz := now();
  v_n integer := 0;
BEGIN
  SELECT cs.branch_id, cs.id
  INTO v_branch_id, v_shift_id
  FROM public.cash_shifts cs
  JOIN public.branches b ON b.id = cs.branch_id
  WHERE b.name ILIKE '%Local Principal%'
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno OPEN en Local Principal';
  END IF;

  -- Especiales ya pagadas: pasar a despachadas/cerradas
  UPDATE public.orders
  SET status = 'KITCHEN_DISPATCHED',
      dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = v_branch_id
    AND cash_shift_id IS NOT DISTINCT FROM v_shift_id
    AND COALESCE(is_special, false)
    AND status = 'PAID'
    AND COALESCE(notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Especiales PAID finalizadas: %', v_n;

  -- Especiales pendientes (en caja / despachadas sin cobro): marcar pagadas y cerrar
  -- (incluye $0 que bloquean cierre)
  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = v_branch_id
    AND cash_shift_id IS NOT DISTINCT FROM v_shift_id
    AND COALESCE(is_special, false)
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND COALESCE(notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Especiales pendientes cerradas como PAID: %', v_n;

  -- Dejar las que acabamos de poner PAID también en KITCHEN_DISPATCHED
  UPDATE public.orders
  SET status = 'KITCHEN_DISPATCHED',
      updated_at = v_now
  WHERE branch_id = v_branch_id
    AND cash_shift_id IS NOT DISTINCT FROM v_shift_id
    AND COALESCE(is_special, false)
    AND status = 'PAID'
    AND closed_at IS NOT NULL
    AND COALESCE(notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%';

  RAISE NOTICE 'Listo. Intenta cerrar el turno desde Admin > Turno.';
END;
$$;
