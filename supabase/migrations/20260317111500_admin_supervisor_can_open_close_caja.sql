CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_caja_status public.caja_status;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users
      WHERE shift_id = p_shift_id
        AND user_id = p_cashier_id
        AND is_enabled = true
        AND can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF v_caja_status != 'UNOPENED' THEN
    RAISE EXCEPTION 'La caja ya fue abierta anteriormente en este turno';
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.branch_id = p_branch_id
      AND d.is_active = true;
  ELSE
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.cash_shift_denoms (
        id,
        shift_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;
  END IF;

  UPDATE public.cash_shifts
  SET caja_status = 'OPEN'
  WHERE id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users
      WHERE shift_id = p_shift_id
        AND user_id = p_cashier_id
        AND is_enabled = true
        AND can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  IF v_caja_status != 'OPEN' THEN
    RAISE EXCEPTION 'La caja no esta abierta para cerrarse';
  END IF;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;
