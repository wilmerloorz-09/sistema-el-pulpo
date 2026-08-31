-- Cobros del resumen de caja por apertura (incluye cajero anterior tras reemplazo).

CREATE OR REPLACE FUNCTION public.payment_belongs_to_register_opening(
  p_payment_id uuid,
  p_opening_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    JOIN public.payments p ON p.id = p_payment_id
    WHERE cro.id = p_opening_id
      AND p.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
      AND COALESCE(p.status, '') NOT IN ('voided', 'reversed')
      AND (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = cro.shift_id
        )
        OR p.shift_id = cro.shift_id
        OR EXISTS (
          SELECT 1
          FROM public.cash_movements cm
          WHERE cm.payment_id = p.id
            AND cm.shift_id = cro.shift_id
        )
      )
      AND (
        p.created_by = cro.cashier_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.cash_register_openings cro_other
          WHERE cro_other.shift_id = cro.shift_id
            AND cro_other.status = 'abierta'
            AND cro_other.cashier_id = p.created_by
            AND cro_other.id <> cro.id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_register_opening_collected_payments(
  p_opening_id uuid
)
RETURNS TABLE (
  id uuid,
  amount numeric,
  payment_method_id uuid,
  created_at timestamptz,
  created_by uuid,
  notes text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening public.cash_register_openings%ROWTYPE;
BEGIN
  IF p_opening_id IS NULL THEN
    RAISE EXCEPTION 'opening_id es obligatorio';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.id = p_opening_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la apertura de caja solicitada';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_opening.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = v_opening.shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver los cobros de esta apertura';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.amount,
    p.payment_method_id,
    p.created_at,
    p.created_by,
    p.notes,
    p.status
  FROM public.payments p
  WHERE public.payment_belongs_to_register_opening(p.id, p_opening_id)
  ORDER BY p.created_at ASC, p.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_belongs_to_register_opening(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_belongs_to_register_opening(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_register_opening_collected_payments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_opening_collected_payments(uuid) TO authenticated;

-- payment_count: mismo criterio ampliado (orden, shift_id o movimiento de caja).
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
      WHERE public.payment_belongs_to_register_opening(p.id, cro.id)
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
