-- Optimiza list_closed_cash_register_openings: evita payment_belongs_to_register_opening
-- por fila (causaba statement timeout). Totales set-based + filtro admin barato.

DROP FUNCTION IF EXISTS public.list_closed_cash_register_openings(
  uuid, timestamptz, timestamptz, uuid, uuid, integer
);

CREATE OR REPLACE FUNCTION public.list_closed_cash_register_openings(
  p_branch_id uuid,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_shift_id uuid DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 150
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  branch_id uuid,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  final_total numeric,
  collected_total numeric,
  notes text,
  shift_number integer,
  shift_code text,
  shift_opened_at timestamptz,
  shift_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    f.shift_status
  FROM filtered f
  LEFT JOIN pay_totals pt ON pt.opening_id = f.id
  LEFT JOIN mov_totals mt ON mt.opening_id = f.id
  ORDER BY f.closed_at DESC, f.opened_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_closed_cash_register_openings(
  uuid, timestamptz, timestamptz, uuid, uuid, integer
) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_cash_register_openings_branch_status_closed_at
  ON public.cash_register_openings (branch_id, status, closed_at DESC)
  WHERE status = 'cerrada' AND closed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_register_openings_branch_status_opened_at
  ON public.cash_register_openings (branch_id, status, opened_at DESC)
  WHERE status = 'cerrada';
