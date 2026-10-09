-- Cierres de caja: para cierres aprobados por un administrador, devolver el total contado aprobado.

DROP FUNCTION IF EXISTS public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer, text);

CREATE FUNCTION public.list_closed_cash_register_openings(p_branch_id uuid, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 150, p_aprobacion_estado text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, shift_id uuid, branch_id uuid, cashier_id uuid, cashier_name text, cashier_username text, opened_at timestamp with time zone, closed_at timestamp with time zone, initial_total numeric, final_total numeric, collected_total numeric, notes text, shift_number integer, shift_code text, shift_opened_at timestamp with time zone, shift_status text, aprobacion_estado text, aprobado_por_nombre text, aprobado_en timestamp with time zone, monto_aprobado numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 150), 500));
BEGIN
  SET LOCAL statement_timeout = '30s';

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'El rango de fechas es obligatorio';
  END IF;
  IF p_desde > p_hasta THEN
    RAISE EXCEPTION 'El rango de fechas es invalido';
  END IF;

  IF NOT public.can_view_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar cierres de caja historicos';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      cro.id,
      cro.shift_id,
      cro.branch_id,
      cro.cashier_id,
      cro.opened_at,
      cro.closed_at,
      cro.initial_total,
      cro.notes,
      cro.aprobacion_estado,
      cro.aprobado_por,
      cro.aprobado_en,
      cs.shift_number,
      cs.shift_code,
      cs.opened_at AS shift_opened_at,
      cs.status::text AS shift_status,
      COALESCE(NULLIF(TRIM(cashier.full_name), ''), cashier.alias, cashier.username, 'Sin nombre')::text AS cashier_name,
      COALESCE(cashier.username, cashier.alias, '')::text AS cashier_username
    FROM public.cash_register_openings cro
    JOIN public.cash_shifts cs
      ON cs.id = cro.shift_id
    JOIN public.profiles cashier
      ON cashier.id = cro.cashier_id
    WHERE cro.branch_id = p_branch_id
      AND cro.status = 'cerrada'
      AND cro.closed_at IS NOT NULL
      AND (
        (cro.opened_at >= p_desde AND cro.opened_at <= p_hasta)
        OR (cro.closed_at >= p_desde AND cro.closed_at <= p_hasta)
      )
      AND (p_shift_id IS NULL OR cro.shift_id = p_shift_id)
      AND (p_cashier_id IS NULL OR cro.cashier_id = p_cashier_id)
      AND (p_aprobacion_estado IS NULL OR cro.aprobacion_estado = p_aprobacion_estado)
      -- Excluir ruido de auto-cierre admin sin cobros (rápido por notes)
      AND COALESCE(cro.notes, '') NOT ILIKE '%Auto-cierre: admin sin cobros%'
    ORDER BY cro.closed_at DESC, cro.opened_at DESC
    LIMIT (v_limit * 3)
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    WHERE NOT (
      public.can_manage_branch_admin(c.cashier_id, c.branch_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_users csu
        WHERE csu.shift_id = c.shift_id
          AND csu.user_id = c.cashier_id
          AND csu.is_enabled = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.shift_id = c.shift_id
          AND p.created_by = c.cashier_id
          AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
        LIMIT 1
      )
    )
    ORDER BY c.closed_at DESC, c.opened_at DESC
    LIMIT v_limit
  ),
  pay_totals AS (
    SELECT
      f.id AS opening_id,
      COALESCE(SUM(p.amount), 0)::numeric AS collected_total,
      COALESCE(SUM(p.amount) FILTER (
        WHERE lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
      ), 0)::numeric AS cash_total
    FROM filtered f
    LEFT JOIN public.payments p
      ON p.shift_id = f.shift_id
     AND p.created_by = f.cashier_id
     AND p.created_at >= f.opened_at
     AND p.created_at <= f.closed_at
     AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
     AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
     AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    LEFT JOIN public.payment_methods pm
      ON pm.id = p.payment_method_id
    GROUP BY f.id
  ),
  mov_totals AS (
    SELECT
      f.id AS opening_id,
      COALESCE(SUM(
        CASE
          WHEN crm.movement_type = 'entrada' THEN crm.amount
          WHEN crm.movement_type = 'salida' THEN -crm.amount
          ELSE 0
        END
      ), 0)::numeric AS movement_net
    FROM filtered f
    LEFT JOIN public.cash_register_movements crm
      ON crm.shift_id = f.shift_id
     AND crm.recorded_by = f.cashier_id
     AND crm.created_at >= f.opened_at
     AND crm.created_at <= f.closed_at
    GROUP BY f.id
  )
  SELECT
    f.id,
    f.shift_id,
    f.branch_id,
    f.cashier_id,
    f.cashier_name,
    f.cashier_username,
    f.opened_at,
    f.closed_at,
    f.initial_total,
    (
      f.initial_total
      + COALESCE(pt.cash_total, 0)
      + COALESCE(mt.movement_net, 0)
    ) AS final_total,
    COALESCE(pt.collected_total, 0) AS collected_total,
    f.notes,
    f.shift_number,
    f.shift_code,
    f.shift_opened_at,
    f.shift_status,
    f.aprobacion_estado,
    CASE
      WHEN approver.id IS NULL THEN NULL
      ELSE COALESCE(NULLIF(TRIM(approver.full_name), ''), approver.alias, approver.username)::text
    END AS aprobado_por_nombre,
    f.aprobado_en,
    CASE
      WHEN f.aprobacion_estado = 'APROBADO' AND f.aprobado_por IS NOT NULL THEN (
        SELECT SUM(c.cantidad_contada * c.denominacion_valor)
        FROM public.conteos_cierre_caja c
        WHERE c.apertura_id = f.id
      )
    END AS monto_aprobado
  FROM filtered f
  LEFT JOIN pay_totals pt ON pt.opening_id = f.id
  LEFT JOIN mov_totals mt ON mt.opening_id = f.id
  LEFT JOIN public.profiles approver ON approver.id = f.aprobado_por
  ORDER BY f.closed_at DESC, f.opened_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
