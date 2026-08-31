-- Conteo de cobros por apertura: incluye pagos del cajero anterior tras reemplazo.

CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  RETURN QUERY
  SELECT
    cro.id,
    cro.shift_id,
    cro.status,
    cro.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    cro.notes,
    cro.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    cro.anulada_at,
    cro.motivo_anulacion,
    (cro.cashier_id = auth.uid() AND cro.status = 'abierta') AS is_current,
    (
      SELECT COUNT(*)::integer
      FROM public.payments p
      WHERE p.created_at >= cro.opened_at
        AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = p_shift_id
        )
        AND (
          p.created_by = cro.cashier_id
          OR NOT EXISTS (
            SELECT 1
            FROM public.cash_register_openings cro_other
            WHERE cro_other.shift_id = p_shift_id
              AND cro_other.status = 'abierta'
              AND cro_other.cashier_id = p.created_by
              AND cro_other.id <> cro.id
          )
        )
    ) AS payment_count
  FROM public.cash_register_openings cro
  JOIN public.profiles cashier
    ON cashier.id = cro.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = cro.anulada_por
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC;
END;
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
