CREATE OR REPLACE FUNCTION public.get_mesero_ready_alerts(
  p_branch_id uuid,
  p_created_by uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  notification_id uuid,
  order_id uuid,
  order_number integer,
  order_type text,
  branch_id uuid,
  created_by uuid,
  table_name text,
  split_code text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id AS notification_id,
    o.id AS order_id,
    o.order_number,
    o.order_type::text AS order_type,
    o.branch_id,
    o.created_by,
    t.name AS table_name,
    s.split_code,
    e.created_at
  FROM public.order_ready_events e
  INNER JOIN public.orders o
    ON o.id = e.order_id
  LEFT JOIN public.restaurant_tables t
    ON t.id = o.table_id
  LEFT JOIN public.table_splits s
    ON s.id = o.split_id
  WHERE o.branch_id = p_branch_id
    AND o.created_by = p_created_by
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_mesero_ready_alerts(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mesero_ready_alerts(uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.order_has_dispatch_after(
  p_order_id uuid,
  p_after timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_dispatch_events e
    WHERE e.order_id = p_order_id
      AND e.created_at > p_after
  );
$$;

REVOKE ALL ON FUNCTION public.order_has_dispatch_after(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_has_dispatch_after(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.emit_order_ready_alert(
  p_order_id uuid,
  p_emitted_by uuid,
  p_source_module text DEFAULT 'dispatch'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden % no existe', p_order_id;
  END IF;

  INSERT INTO public.order_ready_events (
    order_id,
    event_type,
    created_by,
    source_module,
    notes,
    created_at
  ) VALUES (
    p_order_id,
    'partial',
    p_emitted_by,
    p_source_module,
    'alert_only',
    v_now
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_order_ready_alert(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emit_order_ready_alert(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
