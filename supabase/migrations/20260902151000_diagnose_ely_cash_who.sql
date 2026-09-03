-- Quién cobró el efectivo "de más" vs denoms de ely ($169.25)
DO $$
DECLARE
  v_opening_id uuid := '5ba70098-86aa-403a-bc25-a00512631152';
  v_shift_id uuid := '3cc1b60b-c52b-4f79-9a9f-455928a2bd03';
  v_ely uuid := 'f10da513-24e3-4f01-a9fc-de9baa4f3521';
  v_opened_at timestamptz;
  r record;
BEGIN
  SELECT opened_at INTO v_opened_at FROM public.cash_register_openings WHERE id = v_opening_id;

  RAISE NOTICE '=== Efectivo del turno por cajero (activos) ===';
  FOR r IN
    SELECT
      COALESCE(pr.username, pr.alias, left(p.created_by::text, 8)) AS who,
      COUNT(*) AS n,
      SUM(p.amount)::numeric AS total
    FROM public.payments p
    JOIN public.payment_methods pm ON pm.id = p.payment_method_id
    LEFT JOIN public.profiles pr ON pr.id = p.created_by
    WHERE p.shift_id = v_shift_id
      AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
      AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    GROUP BY 1
    ORDER BY total DESC
  LOOP
    RAISE NOTICE '  % : n=% total=%', r.who, r.n, r.total;
  END LOOP;

  RAISE NOTICE '=== Efectivo turno total ===';
  SELECT SUM(p.amount)::numeric, COUNT(*)
  INTO r
  FROM public.payments p
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.shift_id = v_shift_id
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
    AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%';
  -- can't select two into record easily; redo:
  RAISE NOTICE '(ver filas por cajero arriba)';

  RAISE NOTICE '=== Aperturas del mismo turno ===';
  FOR r IN
    SELECT
      COALESCE(pr.username, pr.alias, '') AS who,
      cro.status,
      cro.initial_total,
      cro.opened_at,
      cro.closed_at,
      (
        SELECT COALESCE(SUM(d.value * csd.qty_current), 0)
        FROM public.cash_shift_denoms csd
        JOIN public.denominations d ON d.id = csd.denomination_id
        WHERE csd.opening_id = cro.id
      ) AS denom_current
    FROM public.cash_register_openings cro
    JOIN public.profiles pr ON pr.id = cro.cashier_id
    WHERE cro.shift_id = v_shift_id
    ORDER BY cro.opened_at
  LOOP
    RAISE NOTICE '  % status=% init=% current_denoms=% opened=% closed=%',
      r.who, r.status, r.initial_total, r.denom_current, r.opened_at, r.closed_at;
  END LOOP;

  RAISE NOTICE '=== Efectivo cobrado por otros DESPUES de apertura ely ===';
  FOR r IN
    SELECT
      COALESCE(pr.username, pr.alias, '') AS who,
      COUNT(*) AS n,
      SUM(p.amount)::numeric AS total
    FROM public.payments p
    JOIN public.payment_methods pm ON pm.id = p.payment_method_id
    LEFT JOIN public.profiles pr ON pr.id = p.created_by
    WHERE p.shift_id = v_shift_id
      AND p.created_by <> v_ely
      AND p.created_at >= v_opened_at
      AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
      AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    GROUP BY 1
    ORDER BY total DESC
  LOOP
    RAISE NOTICE '  % : n=% total=%', r.who, r.n, r.total;
  END LOOP;
END;
$$;
