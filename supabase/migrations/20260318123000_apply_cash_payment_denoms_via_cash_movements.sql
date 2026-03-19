DROP FUNCTION IF EXISTS public.registrar_movimiento_caja_operativo(uuid, public.cash_movement_type, integer, uuid, uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja_operativo(
  p_shift_id uuid,
  p_movement_type public.cash_movement_type,
  p_qty_delta integer,
  p_payment_id uuid DEFAULT NULL,
  p_denomination_id uuid DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL
)
RETURNS public.cash_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_caja_status public.caja_status;
  v_cashier_id uuid;
  v_row public.cash_movements%ROWTYPE;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  IF p_qty_delta IS NULL OR p_qty_delta <= 0 THEN
    RAISE EXCEPTION 'qty_delta debe ser mayor a 0';
  END IF;

  SELECT cs.branch_id, cs.status, cs.caja_status, cs.cashier_id
  INTO v_branch_id, v_shift_status, v_caja_status, v_cashier_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF v_shift_status <> 'OPEN' OR v_caja_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Solo puedes registrar movimientos con una caja abierta';
  END IF;

  IF p_movement_type = 'PAYMENT_IN' AND p_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment_id es obligatorio para PAYMENT_IN';
  END IF;

  IF p_movement_type IN ('PAYMENT_IN', 'CHANGE_OUT') AND p_denomination_id IS NULL THEN
    RAISE EXCEPTION 'denomination_id es obligatorio para este movimiento';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
    OR (
      v_cashier_id = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), v_branch_id)
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para registrar movimientos de cobro en esta caja';
  END IF;

  IF p_movement_type = 'PAYMENT_IN' THEN
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current + p_qty_delta
    WHERE csd.shift_id = p_shift_id
      AND csd.denomination_id = p_denomination_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La denominacion recibida no existe en la caja actual';
    END IF;
  ELSIF p_movement_type = 'CHANGE_OUT' THEN
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current - p_qty_delta
    WHERE csd.shift_id = p_shift_id
      AND csd.denomination_id = p_denomination_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La denominacion del cambio no existe en la caja actual';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.cash_shift_denoms csd
      WHERE csd.shift_id = p_shift_id
        AND csd.denomination_id = p_denomination_id
        AND csd.qty_current < 0
    ) THEN
      RAISE EXCEPTION 'No hay suficientes unidades en caja para entregar el cambio';
    END IF;
  END IF;

  INSERT INTO public.cash_movements (
    id,
    shift_id,
    movement_type,
    denomination_id,
    qty_delta,
    payment_id,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    p_shift_id,
    p_movement_type,
    p_denomination_id,
    p_qty_delta,
    p_payment_id,
    COALESCE(p_created_at, now())
  )
  RETURNING *
  INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja_operativo(uuid, public.cash_movement_type, integer, uuid, uuid, timestamptz) TO authenticated;
