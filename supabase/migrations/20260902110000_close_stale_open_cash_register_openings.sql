-- Cierre retroactivo: aperturas de caja aún 'abierta' de días anteriores a hoy
-- (America/Guayaquil). Complementa el backfill de 20260902100000.

DO $$
DECLARE
  v_today_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'America/Guayaquil')
    AT TIME ZONE 'America/Guayaquil'
  );
  v_shift_id uuid;
  v_closed_count integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.cash_register_openings cro
    SET status = 'cerrada',
        closed_at = COALESCE(
          cro.closed_at,
          cs.closed_at,
          (
            date_trunc('day', cro.opened_at AT TIME ZONE 'America/Guayaquil')
            + interval '1 day'
            - interval '1 second'
          ) AT TIME ZONE 'America/Guayaquil',
          now()
        ),
        notes = CASE
          WHEN COALESCE(btrim(cro.notes), '') = '' THEN
            'Auto-cierre retroactivo: caja de día anterior'
          WHEN cro.notes ILIKE '%Auto-cierre retroactivo: caja de día anterior%' THEN
            cro.notes
          ELSE
            cro.notes || ' | Auto-cierre retroactivo: caja de día anterior'
        END,
        updated_at = now()
    FROM public.cash_shifts cs
    WHERE cs.id = cro.shift_id
      AND cro.status = 'abierta'
      AND cro.opened_at < v_today_start
    RETURNING cro.shift_id
  )
  SELECT COUNT(*)::integer
  INTO v_closed_count
  FROM updated;

  FOR v_shift_id IN
    SELECT DISTINCT cro.shift_id
    FROM public.cash_register_openings cro
    WHERE cro.notes ILIKE '%Auto-cierre retroactivo: caja de día anterior%'
  LOOP
    PERFORM public.sync_shift_caja_status_from_openings(v_shift_id);
  END LOOP;

  RAISE NOTICE 'Cajas de días anteriores cerradas: %', v_closed_count;
END;
$$;
