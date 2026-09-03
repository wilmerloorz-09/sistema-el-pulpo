-- Verifica fix: cobros de ely vs Jhon en apertura ely
DO $$
DECLARE
  v_ely_opening uuid := '5ba70098-86aa-403a-bc25-a00512631152';
  v_cash numeric;
  v_all numeric;
  v_jhon numeric;
BEGIN
  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_all
  FROM public.payments p
  WHERE public.payment_belongs_to_register_opening(p.id, v_ely_opening);

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_cash
  FROM public.payments p
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE public.payment_belongs_to_register_opening(p.id, v_ely_opening)
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo';

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_jhon
  FROM public.payments p
  JOIN public.profiles pr ON pr.id = p.created_by
  JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE public.payment_belongs_to_register_opening(p.id, v_ely_opening)
    AND pr.username ILIKE 'jhon'
    AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo';

  RAISE NOTICE 'ely opening totals: all=% cash=% jhon_cash_in_ely=% (debe ser 0)',
    v_all, v_cash, v_jhon;
END;
$$;
