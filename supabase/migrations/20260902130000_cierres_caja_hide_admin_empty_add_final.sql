-- Cierres de caja: ocultar admins no agregados al turno sin cobros
-- y exponer monto final estimado (inicial + efectivo + movimientos).

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
BEGIN
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
  SELECT
    cro.id,
    cro.shift_id,
    cro.branch_id,
    cro.cashier_id,
    COALESCE(NULLIF(TRIM(cashier.full_name), ''), cashier.alias, cashier.username, 'Sin nombre')::text AS cashier_name,
    COALESCE(cashier.username, cashier.alias, '')::text AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    (
      cro.initial_total
      + COALESCE((
          SELECT SUM(p.amount)::numeric
          FROM public.payments p
          JOIN public.payment_methods pm ON pm.id = p.payment_method_id
          WHERE public.payment_belongs_to_register_opening(p.id, cro.id)
            AND lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
        ), 0)
      + COALESCE((
          SELECT SUM(
            CASE
              WHEN crm.movement_type = 'entrada' THEN crm.amount
              WHEN crm.movement_type = 'salida' THEN -crm.amount
              ELSE 0
            END
          )::numeric
          FROM public.cash_register_movements crm
          WHERE crm.shift_id = cro.shift_id
            AND crm.recorded_by = cro.cashier_id
            AND crm.created_at >= cro.opened_at
            AND (cro.closed_at IS NULL OR crm.created_at <= cro.closed_at)
        ), 0)
    ) AS final_total,
    COALESCE((
      SELECT SUM(p.amount)::numeric
      FROM public.payments p
      WHERE public.payment_belongs_to_register_opening(p.id, cro.id)
    ), 0) AS collected_total,
    cro.notes,
    cs.shift_number,
    cs.shift_code,
    cs.opened_at AS shift_opened_at,
    cs.status::text AS shift_status
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
    -- Ocultar admin no agregado al turno y sin cobros activos
    AND NOT (
      public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_users csu
        WHERE csu.shift_id = cro.shift_id
          AND csu.user_id = cro.cashier_id
          AND csu.is_enabled = true
      )
      AND NOT public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id)
    )
  ORDER BY cro.closed_at DESC, cro.opened_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 150), 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_closed_cash_register_openings(
  uuid, timestamptz, timestamptz, uuid, uuid, integer
) TO authenticated;
