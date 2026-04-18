CREATE OR REPLACE FUNCTION public.list_pending_order_cancellation_requests(
  p_branch_id uuid
)
RETURNS TABLE (
  order_id uuid,
  requested_at timestamptz,
  notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible_orders AS (
    SELECT o.id, o.branch_id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND o.status <> 'CANCELLED'
      AND o.status <> 'PAID'
      AND (
        public.can_manage_branch_admin(auth.uid(), o.branch_id)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'mesas', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'ordenes', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_total', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_mesa', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), o.branch_id, 'despacho_para_llevar', 'VIEW'::public.access_level)
      )
  ),
  latest_requests AS (
    SELECT DISTINCT ON (oc.order_id)
      oc.order_id,
      COALESCE(o.cancel_requested_at, oc.created_at) AS requested_at,
      oc.notes
    FROM public.order_cancellations oc
    JOIN visible_orders vo ON vo.id = oc.order_id
    JOIN public.orders o ON o.id = oc.order_id
    WHERE oc.status = 'VOIDED'
      AND oc.notes ILIKE '[PENDING_REQUEST]%'
    ORDER BY oc.order_id, COALESCE(o.cancel_requested_at, oc.created_at) DESC, oc.created_at DESC
  )
  SELECT
    lr.order_id,
    lr.requested_at,
    lr.notes
  FROM latest_requests lr
  ORDER BY lr.requested_at DESC NULLS LAST, lr.order_id;
$$;

REVOKE ALL ON FUNCTION public.list_pending_order_cancellation_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_order_cancellation_requests(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
