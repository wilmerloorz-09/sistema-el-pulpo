-- Auditoría: estado de cajas por sucursal (solo diagnóstico, sin cambios)

DO $$
DECLARE
  v_today_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'America/Guayaquil')
    AT TIME ZONE 'America/Guayaquil'
  );
  r record;
BEGIN
  RAISE NOTICE '=== Hoy inicia (Guayaquil): % ===', v_today_start;

  RAISE NOTICE '--- Cajas AUN abierta de dias anteriores ---';
  FOR r IN
    SELECT
      b.name AS branch_name,
      COUNT(*)::int AS cnt
    FROM public.cash_register_openings cro
    JOIN public.branches b ON b.id = cro.branch_id
    WHERE cro.status = 'abierta'
      AND cro.opened_at < v_today_start
    GROUP BY b.name
    ORDER BY b.name
  LOOP
    RAISE NOTICE '  % : %', r.branch_name, r.cnt;
  END LOOP;

  RAISE NOTICE '--- Cerradas retroactivo (turno ya cerrado) por sucursal ---';
  FOR r IN
    SELECT
      b.name AS branch_name,
      COUNT(*)::int AS cnt
    FROM public.cash_register_openings cro
    JOIN public.branches b ON b.id = cro.branch_id
    WHERE cro.notes ILIKE '%Auto-cierre retroactivo: turno ya cerrado%'
    GROUP BY b.name
    ORDER BY b.name
  LOOP
    RAISE NOTICE '  % : %', r.branch_name, r.cnt;
  END LOOP;

  RAISE NOTICE '--- Cerradas retroactivo (caja dia anterior) por sucursal ---';
  FOR r IN
    SELECT
      b.name AS branch_name,
      COUNT(*)::int AS cnt
    FROM public.cash_register_openings cro
    JOIN public.branches b ON b.id = cro.branch_id
    WHERE cro.notes ILIKE '%Auto-cierre retroactivo: caja de día anterior%'
    GROUP BY b.name
    ORDER BY b.name
  LOOP
    RAISE NOTICE '  % : %', r.branch_name, r.cnt;
  END LOOP;

  RAISE NOTICE '--- Total cajas cerrada (historico) por sucursal ---';
  FOR r IN
    SELECT
      b.name AS branch_name,
      COUNT(*)::int AS cnt
    FROM public.cash_register_openings cro
    JOIN public.branches b ON b.id = cro.branch_id
    WHERE cro.status = 'cerrada'
      AND cro.closed_at IS NOT NULL
    GROUP BY b.name
    ORDER BY b.name
  LOOP
    RAISE NOTICE '  % : %', r.branch_name, r.cnt;
  END LOOP;
END;
$$;
