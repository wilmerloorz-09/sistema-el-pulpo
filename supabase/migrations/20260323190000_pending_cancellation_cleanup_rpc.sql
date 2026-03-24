CREATE OR REPLACE FUNCTION public.clear_pending_order_cancellation_request(
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_gate record;
  v_can_authorize boolean := false;
  v_pending_ids uuid[];
  v_deleted_count integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No hay usuario autenticado';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF public.can_manage_branch_admin(v_actor_id, v_order.branch_id) THEN
    v_can_authorize := true;
  ELSE
    SELECT *
    INTO v_gate
    FROM public.get_my_branch_shift_gate(v_order.branch_id)
    LIMIT 1;

    v_can_authorize := COALESCE(v_gate.can_authorize_order_cancel, false) OR COALESCE(v_gate.is_supervisor, false);
  END IF;

  IF NOT v_can_authorize THEN
    RAISE EXCEPTION 'Esta solicitud requiere un usuario autorizado';
  END IF;

  SELECT array_agg(id)
  INTO v_pending_ids
  FROM public.order_cancellations
  WHERE order_id = p_order_id
    AND status = 'VOIDED'
    AND notes ILIKE '[PENDING_REQUEST]%';

  IF COALESCE(array_length(v_pending_ids, 1), 0) > 0 THEN
    DELETE FROM public.order_item_cancellations
    WHERE order_cancellation_id = ANY(v_pending_ids);

    DELETE FROM public.order_cancellations
    WHERE id = ANY(v_pending_ids);

    v_deleted_count := COALESCE(array_length(v_pending_ids, 1), 0);
  END IF;

  UPDATE public.orders
  SET cancel_requested_at = NULL,
      cancel_requested_by = NULL
  WHERE id = p_order_id;

  RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_pending_order_cancellation_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_pending_order_cancellation_request(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
