-- Historial de cierres de caja (admin): la tabla cash_register_openings tenía RLS
-- habilitado sin políticas SELECT, por lo que el cliente siempre veía 0 filas.
-- Esta migración:
-- 1) Permite SELECT a admins / cajero dueño / miembros del turno
-- 2) Expone RPC list_closed_cash_register_openings (SECURITY DEFINER)
-- 3) Permite a admins ver denominaciones del turno para reimprimir reportes

CREATE OR REPLACE FUNCTION public.can_view_branch_admin(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_sucursal', 'VIEW'::public.access_level)
    OR public.has_branch_permission(p_user_id, p_branch_id, 'admin_global', 'VIEW'::public.access_level);
$$;

GRANT EXECUTE ON FUNCTION public.can_view_branch_admin(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view cash register openings" ON public.cash_register_openings;
CREATE POLICY "Users can view cash register openings"
ON public.cash_register_openings
FOR SELECT
TO authenticated
USING (
  public.can_view_branch_admin(auth.uid(), branch_id)
  OR public.can_manage_shift_admin(auth.uid(), branch_id)
  OR cashier_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = cash_register_openings.shift_id
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
  )
);

DROP POLICY IF EXISTS "Users can view cash shift denoms by permission" ON public.cash_shift_denoms;
CREATE POLICY "Users can view cash shift denoms by permission"
ON public.cash_shift_denoms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_denoms.shift_id
      AND (
        public.can_operate_cash_branch(auth.uid(), cs.branch_id)
        OR public.can_view_branch_admin(auth.uid(), cs.branch_id)
        OR cs.cashier_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS "Users can view payments by cash permission" ON public.payments;
CREATE POLICY "Users can view payments by cash permission"
ON public.payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = payments.order_id
      AND (
        public.can_operate_cash_branch(auth.uid(), o.branch_id)
        OR public.can_view_branch_admin(auth.uid(), o.branch_id)
      )
  )
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
    -- Incluye cierres aunque el turno (cash_shifts) siga OPEN
    AND (
      (cro.opened_at >= p_desde AND cro.opened_at <= p_hasta)
      OR (cro.closed_at >= p_desde AND cro.closed_at <= p_hasta)
    )
    AND (p_shift_id IS NULL OR cro.shift_id = p_shift_id)
    AND (p_cashier_id IS NULL OR cro.cashier_id = p_cashier_id)
  ORDER BY cro.closed_at DESC, cro.opened_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 150), 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer)
  TO authenticated;
