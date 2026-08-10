-- =============================================================================
-- Mesas overview en 1 RTT (bundle sobre get_branch_tables_overview)
-- =============================================================================
-- Envuelve la RPC existente + órdenes activas + perfiles + pagos VOIDED,
-- para que el cliente no haga 3–4 queries extra por refresh.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_tables_overview_bundle(
  p_branch_id uuid,
  p_shift_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_opened_at timestamptz;
  v_overview jsonb;
  v_result jsonb;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'open_shift', NULL,
      'rows', '[]'::jsonb,
      'active_orders', '[]'::jsonb,
      'profiles', '[]'::jsonb,
      'voided_order_ids', '[]'::jsonb
    );
  END IF;

  IF p_shift_id IS NOT NULL THEN
    SELECT cs.id, cs.opened_at
    INTO v_shift_id, v_opened_at
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    LIMIT 1;
  ELSE
    SELECT cs.id, cs.opened_at
    INTO v_shift_id, v_opened_at
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  INTO v_overview
  FROM public.get_branch_tables_overview(p_branch_id) r;

  WITH overview_rows AS (
    SELECT *
    FROM jsonb_to_recordset(v_overview) AS x(
      table_id uuid,
      table_name text,
      visual_order integer,
      table_is_active boolean,
      status text,
      active_order_id uuid,
      active_order_status text,
      split_count integer,
      total_due numeric,
      split_totals jsonb,
      item_count integer,
      elapsed_minutes integer
    )
  ),
  active_ids AS (
    SELECT DISTINCT active_order_id AS id
    FROM overview_rows
    WHERE active_order_id IS NOT NULL
  ),
  active_orders AS (
    SELECT
      o.id,
      o.created_by,
      o.created_at,
      o.sent_to_kitchen_at,
      o.cash_shift_id
    FROM public.orders o
    WHERE o.id IN (SELECT id FROM active_ids)
  ),
  profiles AS (
    SELECT
      p.id,
      p.first_name,
      p.full_name,
      p.username,
      p.alias,
      p.email
    FROM public.profiles p
    WHERE p.id IN (SELECT DISTINCT created_by FROM active_orders WHERE created_by IS NOT NULL)
  ),
  voided AS (
    SELECT DISTINCT p.order_id
    FROM public.payments p
    WHERE p.order_id IN (SELECT id FROM active_ids)
      AND COALESCE(p.notes, '') ILIKE '%VOIDED%'
  )
  SELECT jsonb_build_object(
    'open_shift', CASE
      WHEN v_shift_id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_shift_id, 'opened_at', v_opened_at)
    END,
    'rows', v_overview,
    'active_orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(ao))
      FROM active_orders ao
    ), '[]'::jsonb),
    'profiles', COALESCE((
      SELECT jsonb_agg(to_jsonb(pr))
      FROM profiles pr
    ), '[]'::jsonb),
    'voided_order_ids', COALESCE((
      SELECT jsonb_agg(v.order_id)
      FROM voided v
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tables_overview_bundle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tables_overview_bundle(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
