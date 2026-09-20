-- Un admin de sucursal/global puede cobrar aunque también sea responsable de cambios.

CREATE OR REPLACE FUNCTION public.block_auxiliary_user_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_branch_id uuid;
BEGIN
  SELECT COALESCE(o.cash_shift_id, cs.id), o.branch_id
  INTO v_shift_id, v_branch_id
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT current_shift.id
    FROM public.cash_shifts current_shift
    WHERE current_shift.branch_id = o.branch_id
      AND current_shift.status = 'OPEN'
    ORDER BY current_shift.opened_at DESC
    LIMIT 1
  ) cs ON true
  WHERE o.id = NEW.order_id;

  IF public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = v_shift_id
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
      AND csu.can_exchange_cash = true
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar no puede registrar cobros';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
