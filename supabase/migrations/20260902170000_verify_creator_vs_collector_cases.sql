-- Solo diagnóstico (NOTICE). Casos creador de orden <> quien cobró.
DO $$
DECLARE
  r record;
  v_shift uuid;
  v_n int := 0;
  v_en_creador int := 0;
  v_en_cobrador int := 0;
  v_en_ninguna int := 0;
  v_opening_creador uuid;
  v_opening_cobrador uuid;
BEGIN
  SELECT cs.id
  INTO v_shift
  FROM public.cash_shifts cs
  JOIN public.branches b ON b.id = cs.branch_id
  WHERE b.name ILIKE '%Pulpo 1%Mañana%'
    AND cs.opened_at >= '2026-09-02 05:00:00+00'
    AND cs.opened_at < '2026-09-03 05:00:00+00'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift IS NULL THEN
    RAISE NOTICE 'No hay turno Pulpo 1 Mañana del 02/09';
    RETURN;
  END IF;

  RAISE NOTICE 'Turno=%', v_shift;
  RAISE NOTICE '=== Cobros donde creador orden <> cobrador (hasta 40) ===';

  FOR r IN
    SELECT
      p.id AS payment_id,
      COALESCE(NULLIF(btrim(o.order_code), ''), '#' || COALESCE(o.order_number::text, left(o.id::text, 8))) AS orden,
      COALESCE(creator.username, creator.alias, left(o.created_by::text, 8)) AS creo,
      COALESCE(cashier.username, cashier.alias, left(p.created_by::text, 8)) AS cobro,
      pm.name AS metodo,
      p.amount,
      p.created_at,
      o.created_by AS creator_id,
      p.created_by AS collector_id
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    JOIN public.payment_methods pm ON pm.id = p.payment_method_id
    LEFT JOIN public.profiles creator ON creator.id = o.created_by
    LEFT JOIN public.profiles cashier ON cashier.id = p.created_by
    WHERE p.shift_id = v_shift
      AND o.created_by IS DISTINCT FROM p.created_by
      AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
      AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
      AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    ORDER BY p.created_at DESC
    LIMIT 40
  LOOP
    v_n := v_n + 1;

    SELECT cro.id
    INTO v_opening_creador
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = v_shift
      AND cro.cashier_id = r.creator_id
      AND cro.status IN ('abierta', 'cerrada')
      AND r.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR r.created_at <= cro.closed_at)
    ORDER BY cro.opened_at DESC
    LIMIT 1;

    SELECT cro.id
    INTO v_opening_cobrador
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = v_shift
      AND cro.cashier_id = r.collector_id
      AND cro.status IN ('abierta', 'cerrada')
      AND r.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR r.created_at <= cro.closed_at)
    ORDER BY cro.opened_at DESC
    LIMIT 1;

    IF v_opening_creador IS NOT NULL
       AND public.payment_belongs_to_register_opening(r.payment_id, v_opening_creador) THEN
      v_en_creador := v_en_creador + 1;
      RAISE NOTICE 'ORDEN % | creo=% cobro=% % $% | CAJA=CREADOR(%)',
        r.orden, r.creo, r.cobro, r.metodo, r.amount, r.creo;
    ELSIF v_opening_cobrador IS NOT NULL
          AND public.payment_belongs_to_register_opening(r.payment_id, v_opening_cobrador) THEN
      v_en_cobrador := v_en_cobrador + 1;
      RAISE NOTICE 'ORDEN % | creo=% cobro=% % $% | CAJA=COBRADOR(%)',
        r.orden, r.creo, r.cobro, r.metodo, r.amount, r.cobro;
    ELSE
      v_en_ninguna := v_en_ninguna + 1;
      RAISE NOTICE 'ORDEN % | creo=% cobro=% % $% | CAJA=NINGUNA/OTRA (creador_open=% cobrador_open=%)',
        r.orden, r.creo, r.cobro, r.metodo, r.amount,
        (v_opening_creador IS NOT NULL), (v_opening_cobrador IS NOT NULL);
    END IF;
  END LOOP;

  RAISE NOTICE '--- Totales muestra: n=% en_caja_creador=% en_caja_cobrador=% ninguna/otra=% ---',
    v_n, v_en_creador, v_en_cobrador, v_en_ninguna;
END;
$$;
