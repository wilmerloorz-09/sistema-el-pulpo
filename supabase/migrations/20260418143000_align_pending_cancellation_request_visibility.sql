CREATE OR REPLACE FUNCTION public.request_order_cancellation(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'order_id y user_id son obligatorios para solicitar anulacion';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order.status = 'PAID' THEN
    RAISE EXCEPTION 'No se puede solicitar cancelar una orden pagada';
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'La orden ya esta cancelada';
  END IF;

  UPDATE public.orders
  SET cancel_requested_by = p_user_id,
      cancel_requested_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_order_cancellation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_order_cancellation(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view order cancellations by branch permission" ON public.order_cancellations;
CREATE POLICY "Users can view order cancellations by branch permission"
ON public.order_cancellations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_cancellations.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
        OR EXISTS (
          SELECT 1
          FROM public.get_my_branch_shift_gate(o.branch_id) gate
          WHERE COALESCE(gate.can_access_orders, false)
             OR COALESCE(gate.can_serve_tables, false)
             OR COALESCE(gate.can_authorize_order_cancel, false)
             OR COALESCE(gate.is_supervisor, false)
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can view order item cancellations by branch permission" ON public.order_item_cancellations;
CREATE POLICY "Users can view order item cancellations by branch permission"
ON public.order_item_cancellations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_item_cancellations.order_id
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
        OR EXISTS (
          SELECT 1
          FROM public.get_my_branch_shift_gate(o.branch_id) gate
          WHERE COALESCE(gate.can_access_orders, false)
             OR COALESCE(gate.can_serve_tables, false)
             OR COALESCE(gate.can_authorize_order_cancel, false)
             OR COALESCE(gate.is_supervisor, false)
        )
      )
  )
);

NOTIFY pgrst, 'reload schema';
