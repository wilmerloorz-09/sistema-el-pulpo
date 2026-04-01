-- RPC to check if a user can be deleted based on historical records
CREATE OR REPLACE FUNCTION public.admin_can_delete_user(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- 1. Orders (Created, cancelled, or requested cancellation)
  SELECT COUNT(*) INTO v_count FROM public.orders 
  WHERE created_by = p_user_id 
     OR cancelled_by = p_user_id 
     OR cancel_requested_by = p_user_id;
  IF v_count > 0 THEN 
    RETURN jsonb_build_object('can_delete', false, 'reason', 'El usuario tiene pedidos registrados'); 
  END IF;

  -- 2. Payments
  SELECT COUNT(*) INTO v_count FROM public.payments WHERE created_by = p_user_id;
  IF v_count > 0 THEN 
    RETURN jsonb_build_object('can_delete', false, 'reason', 'El usuario tiene pagos procesados'); 
  END IF;

  -- 3. Cash Shifts
  SELECT COUNT(*) INTO v_count FROM public.cash_shifts WHERE cashier_id = p_user_id;
  IF v_count > 0 THEN 
    RETURN jsonb_build_object('can_delete', false, 'reason', 'El usuario tiene turnos de caja registrados'); 
  END IF;

  -- 4. Order Cancellations
  SELECT COUNT(*) INTO v_count FROM public.order_cancellations WHERE created_by = p_user_id;
  IF v_count > 0 THEN 
    RETURN jsonb_build_object('can_delete', false, 'reason', 'El usuario tiene registros de cancelaciones'); 
  END IF;

  RETURN jsonb_build_object('can_delete', true, 'reason', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_can_delete_user(UUID) TO authenticated;
