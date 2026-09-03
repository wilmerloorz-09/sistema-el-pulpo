-- Diagnóstico puntual: descuadre caja ely ~02/09 apertura $334.10
-- Solo NOTICE; no modifica datos.

DO $$
DECLARE
  r record;
  v_opening_id uuid;
  v_shift_id uuid;
  v_cashier_id uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_initial numeric;
  v_username text;
  v_branch text;
  v_denom_initial numeric;
  v_denom_current numeric;
  v_cash_pay numeric;
  v_all_pay numeric;
  v_voided_cash numeric;
  v_payment_in numeric;
  v_change_out numeric;
  v_mov_entrada numeric;
  v_mov_salida numeric;
  v_transfer_change numeric;
  v_expected numeric;
  v_cuadre numeric;
  v_cash_without_denoms numeric;
BEGIN
  SELECT cro.id, cro.shift_id, cro.cashier_id, cro.opened_at, cro.closed_at, cro.initial_total,
         COALESCE(p.username, p.alias, ''), b.name
  INTO v_opening_id, v_shift_id, v_cashier_id, v_opened_at, v_closed_at, v_initial, v_username, v_branch
  FROM public.cash_register_openings cro
  JOIN public.profiles p ON p.id = cro.cashier_id
  JOIN public.branches b ON b.id = cro.branch_id
  WHERE cro.initial_total BETWEEN 334.09 AND 334.11
    AND cro.opened_at >= '2026-09-02 05:00:00+00'
    AND cro.opened_at < '2026-09-03 05:00:00+00'
    AND (
      p.username ILIKE 'ely'
      OR p.alias ILIKE 'ely'
      OR COALESCE(p.first_name, '') ILIKE '%ely%'
      OR COALESCE(p.full_name, '') ILIKE '%ely%'
      OR COALESCE(p.full_name, '') ILIKE '%isabel%'
    )
  ORDER BY cro.opened_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    SELECT cro.id, cro.shift_id, cro.cashier_id, cro.opened_at, cro.closed_at, cro.initial_total,
           COALESCE(p.username, p.alias, ''), b.name
    INTO v_opening_id, v_shift_id, v_cashier_id, v_opened_at, v_closed_at, v_initial, v_username, v_branch
    FROM public.cash_register_openings cro
    JOIN public.profiles p ON p.id = cro.cashier_id
    JOIN public.branches b ON b.id = cro.branch_id
    WHERE cro.initial_total BETWEEN 334.09 AND 334.11
      AND cro.opened_at >= '2026-09-02 05:00:00+00'
      AND cro.opened_at < '2026-09-03 05:00:00+00'
    ORDER BY cro.opened_at DESC
    LIMIT 1;
  END IF;

  IF v_opening_id IS NULL THEN
    RAISE NOTICE 'No se encontro apertura $334.10 del 02/09';
    RETURN;
  END IF;

  RAISE NOTICE 'Match: branch=% user=% opening=%', v_branch, v_username, v_opening_id;

  SELECT COALESCE(SUM(d.value * csd.qty_initial), 0),
         COALESCE(SUM(d.value * csd.qty_current), 0)
  INTO v_denom_initial, v_denom_current
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.opening_id = v_opening_id
     OR (csd.opening_id IS NULL AND csd.shift_id = v_shift_id AND csd.cashier_id = v_cashier_id);

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_all_pay
  FROM public.payments p
  WHERE p.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= v_closed_at)
    AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%';

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_cash_pay
  FROM public.payments p
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= v_closed_at)
    AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo';

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_voided_cash
  FROM public.payments p
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= COALESCE(v_closed_at, now()))
    AND (
      lower(COALESCE(p.status, '')) IN ('voided', 'reversed')
      OR COALESCE(p.notes, '') ILIKE '%VOIDED:%'
      OR COALESCE(p.notes, '') ILIKE '%REVERSED:%'
    )
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo';

  -- Movimientos por denominacion ligados a pagos (PAYMENT_IN / CHANGE_OUT)
  SELECT
    COALESCE(SUM(CASE WHEN cm.movement_type::text = 'PAYMENT_IN' THEN d.value * cm.qty_delta ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.movement_type::text = 'CHANGE_OUT' THEN d.value * cm.qty_delta ELSE 0 END), 0)
  INTO v_payment_in, v_change_out
  FROM public.cash_movements cm
  JOIN public.denominations d ON d.id = cm.denomination_id
  JOIN public.payments p ON p.id = cm.payment_id
  WHERE cm.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= COALESCE(v_closed_at, now()));

  SELECT
    COALESCE(SUM(CASE WHEN crm.movement_type = 'entrada' THEN crm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN crm.movement_type = 'salida' THEN crm.amount ELSE 0 END), 0)
  INTO v_mov_entrada, v_mov_salida
  FROM public.cash_register_movements crm
  WHERE crm.shift_id = v_shift_id
    AND crm.recorded_by = v_cashier_id
    AND crm.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR crm.created_at <= COALESCE(v_closed_at, now()));

  -- Vueltos en efectivo de pagos NO efectivo
  SELECT COALESCE(SUM(d.value * cm.qty_delta), 0)
  INTO v_transfer_change
  FROM public.cash_movements cm
  JOIN public.denominations d ON d.id = cm.denomination_id
  JOIN public.payments p ON p.id = cm.payment_id
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE cm.shift_id = v_shift_id
    AND cm.movement_type::text = 'CHANGE_OUT'
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= COALESCE(v_closed_at, now()))
    AND lower(btrim(COALESCE(pm.name, ''))) <> 'efectivo'
    AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed');

  v_expected := v_initial + v_cash_pay - v_transfer_change + v_mov_entrada - v_mov_salida;
  v_cuadre := (v_denom_current - v_denom_initial) - v_cash_pay + v_transfer_change;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_cash_without_denoms
  FROM public.payments p
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= v_opened_at
    AND (v_closed_at IS NULL OR p.created_at <= COALESCE(v_closed_at, now()))
    AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
    AND NOT EXISTS (
      SELECT 1 FROM public.cash_movements cm
      WHERE cm.payment_id = p.id AND cm.movement_type::text = 'PAYMENT_IN'
    );

  RAISE NOTICE '=== APERTURA === id=% shift=% cashier=% opened=% initial=%',
    v_opening_id, v_shift_id, v_cashier_id, v_opened_at, v_initial;
  RAISE NOTICE 'Denoms: initial=% current=% delta=%',
    v_denom_initial, v_denom_current, (v_denom_current - v_denom_initial);
  RAISE NOTICE 'Pagos activos: all=% cash=% voided_cash=%',
    v_all_pay, v_cash_pay, v_voided_cash;
  RAISE NOTICE 'cash_movements: PAYMENT_IN=% CHANGE_OUT=% net=%',
    v_payment_in, v_change_out, (v_payment_in - v_change_out);
  RAISE NOTICE 'cash_register_movements: entrada=% salida=%',
    v_mov_entrada, v_mov_salida;
  RAISE NOTICE 'vuelto transf (CHANGE_OUT no-efectivo)=%', v_transfer_change;
  RAISE NOTICE 'Efectivo SIN actualizar denoms (sin PAYMENT_IN)=%', v_cash_without_denoms;
  RAISE NOTICE 'Esperado fisico (inicial+efectivo-vuelto+entradas-salidas)=%', v_expected;
  RAISE NOTICE 'Cuadre formula UI (delta_denoms - cash + vuelto_transf)=%', v_cuadre;
  RAISE NOTICE 'Hueco vs esperado (current - expected)=%', (v_denom_current - v_expected);
  RAISE NOTICE 'Delta denoms vs net PAYMENT_IN-CHANGE_OUT =%',
    ((v_denom_current - v_denom_initial) - (v_payment_in - v_change_out));

  RAISE NOTICE '--- Pagos efectivo SIN cash_movements PAYMENT_IN (top 30) ---';
  FOR r IN
    SELECT p.id, p.amount, p.created_at,
           (COALESCE(p.notes, '') ILIKE '%CASH_RECEIVED%' OR COALESCE(p.notes, '') ILIKE '%cash_received%' OR COALESCE(p.notes, '') ILIKE '%denoms%') AS has_cash_meta
    FROM public.payments p
    JOIN public.payment_methods pm ON pm.id = p.payment_method_id
    WHERE p.shift_id = v_shift_id
      AND p.created_by = v_cashier_id
      AND p.created_at >= v_opened_at
      AND (v_closed_at IS NULL OR p.created_at <= COALESCE(v_closed_at, now()))
      AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
      AND NOT EXISTS (
        SELECT 1 FROM public.cash_movements cm
        WHERE cm.payment_id = p.id AND cm.movement_type::text = 'PAYMENT_IN'
      )
    ORDER BY p.created_at
    LIMIT 30
  LOOP
    RAISE NOTICE '  pay % amount=% at=% has_cash_meta=%', r.id, r.amount, r.created_at, r.has_cash_meta;
  END LOOP;
END;
$$;
