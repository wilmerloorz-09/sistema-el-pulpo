-- =============================================================================
-- Detalle de bloqueos al cerrar turno (cajas abiertas + órdenes por motivo)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_branch_shift_closure_blockers(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_open_cashiers jsonb := '[]'::jsonb;
  v_unpaid jsonb := '[]'::jsonb;
  v_pending_dispatch jsonb := '[]'::jsonb;
  v_incomplete jsonb := '[]'::jsonb;
  v_can_close boolean := true;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'can_close', false,
      'open_cashiers', '[]'::jsonb,
      'unpaid_orders', '[]'::jsonb,
      'pending_dispatch_orders', '[]'::jsonb,
      'incomplete_orders', '[]'::jsonb
    );
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN jsonb_build_object(
      'can_close', true,
      'open_cashiers', '[]'::jsonb,
      'unpaid_orders', '[]'::jsonb,
      'pending_dispatch_orders', '[]'::jsonb,
      'incomplete_orders', '[]'::jsonb
    );
  END IF;

  -- Cajas abiertas por cajero
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'cashier_id', cro.cashier_id,
        'cashier_name', COALESCE(
          NULLIF(btrim(p.alias), ''),
          NULLIF(btrim(p.username), ''),
          NULLIF(btrim(p.first_name), ''),
          'Usuario'
        )
      )
      ORDER BY COALESCE(NULLIF(btrim(p.alias), ''), NULLIF(btrim(p.username), ''), p.id::text)
    ),
    '[]'::jsonb
  )
  INTO v_open_cashiers
  FROM public.cash_register_openings cro
  LEFT JOIN public.profiles p ON p.id = cro.cashier_id
  WHERE cro.shift_id = v_shift_id
    AND cro.status = 'abierta';

  -- Órdenes que bloquean (misma fuente que el cierre)
  WITH blockers AS (
    SELECT
      b.order_id,
      b.order_status,
      b.paid_at,
      b.reference_label,
      o.order_code,
      o.order_number,
      o.order_type,
      COALESCE(o.is_special, false) AS is_special,
      CASE
        WHEN NULLIF(btrim(COALESCE(o.order_code, '')), '') IS NOT NULL THEN btrim(o.order_code)
        WHEN o.order_number IS NOT NULL THEN '#' || lpad(o.order_number::text, 4, '0')
        ELSE left(o.id::text, 8)
      END AS order_ref
    FROM public.list_branch_closure_blocking_orders(p_branch_id) b
    JOIN public.orders o ON o.id = b.order_id
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN order_status = 'DRAFT' THEN 'incomplete'
        WHEN order_status = 'PAID' THEN 'pending_dispatch'
        WHEN paid_at IS NULL THEN 'unpaid'
        ELSE 'unpaid'
      END AS blocker_kind
    FROM blockers
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'order_id', c.order_id,
            'order_ref', c.order_ref,
            'label', c.reference_label,
            'status', c.order_status
          )
          ORDER BY c.order_ref
        )
        FROM classified c
        WHERE c.blocker_kind = 'unpaid'
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'order_id', c.order_id,
            'order_ref', c.order_ref,
            'label', c.reference_label,
            'status', c.order_status
          )
          ORDER BY c.reference_label, c.order_ref
        )
        FROM classified c
        WHERE c.blocker_kind = 'pending_dispatch'
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'order_id', c.order_id,
            'order_ref', c.order_ref,
            'label', c.reference_label,
            'status', c.order_status
          )
          ORDER BY c.order_ref
        )
        FROM classified c
        WHERE c.blocker_kind = 'incomplete'
      ),
      '[]'::jsonb
    )
  INTO v_unpaid, v_pending_dispatch, v_incomplete;

  v_can_close :=
    jsonb_array_length(v_open_cashiers) = 0
    AND jsonb_array_length(v_unpaid) = 0
    AND jsonb_array_length(v_pending_dispatch) = 0
    AND jsonb_array_length(v_incomplete) = 0;

  RETURN jsonb_build_object(
    'can_close', v_can_close,
    'shift_id', v_shift_id,
    'open_cashiers', v_open_cashiers,
    'unpaid_orders', v_unpaid,
    'pending_dispatch_orders', v_pending_dispatch,
    'incomplete_orders', v_incomplete
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.format_shift_closure_blockers_message(p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_lines text[] := ARRAY[]::text[];
  v_chunk text;
  v_label text;
  v_refs text;
  v_extra int;
BEGIN
  v_data := public.get_branch_shift_closure_blockers(p_branch_id);

  IF COALESCE((v_data ->> 'can_close')::boolean, false) THEN
    RETURN NULL;
  END IF;

  v_lines := array_append(v_lines, 'No puedes cerrar el turno. Falta:');
  v_lines := array_append(v_lines, '');

  -- Cajas abiertas
  IF jsonb_array_length(COALESCE(v_data -> 'open_cashiers', '[]'::jsonb)) > 0 THEN
    SELECT string_agg(x.cashier_name, ', ' ORDER BY x.cashier_name)
    INTO v_chunk
    FROM (
      SELECT DISTINCT y.cashier_name
      FROM jsonb_to_recordset(v_data -> 'open_cashiers') AS y(cashier_id uuid, cashier_name text)
    ) x;
    v_lines := array_append(
      v_lines,
      '- Cerrar caja de: ' || COALESCE(NULLIF(v_chunk, ''), 'cajero(s) con caja abierta')
    );
  END IF;

  -- Sin pagar
  IF jsonb_array_length(COALESCE(v_data -> 'unpaid_orders', '[]'::jsonb)) > 0 THEN
    SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
    INTO v_chunk
    FROM (
      SELECT r.order_ref, r.label
      FROM jsonb_to_recordset(v_data -> 'unpaid_orders') AS r(order_id uuid, order_ref text, label text, status text)
      ORDER BY r.order_ref
      LIMIT 20
    ) x;
    v_lines := array_append(v_lines, '- Órdenes sin pagar: ' || COALESCE(v_chunk, ''));
    v_extra := jsonb_array_length(v_data -> 'unpaid_orders') - 20;
    IF v_extra > 0 THEN
      v_lines := array_append(v_lines, '  … y ' || v_extra::text || ' más');
    END IF;
  END IF;

  -- Por despachar, agrupado por etiqueta (Para llevar, Mesa, etc.)
  IF jsonb_array_length(COALESCE(v_data -> 'pending_dispatch_orders', '[]'::jsonb)) > 0 THEN
    FOR v_label, v_refs IN
      SELECT g.label, g.refs
      FROM (
        SELECT
          r.label,
          string_agg(r.order_ref, ', ' ORDER BY r.order_ref) AS refs
        FROM jsonb_to_recordset(v_data -> 'pending_dispatch_orders') AS r(order_id uuid, order_ref text, label text, status text)
        GROUP BY r.label
        ORDER BY r.label
      ) g
    LOOP
      v_lines := array_append(
        v_lines,
        '- Órdenes por despachar en ' || COALESCE(v_label, 'Órdenes') || ': ' || COALESCE(v_refs, '')
      );
    END LOOP;
  END IF;

  -- Borradores incompletos
  IF jsonb_array_length(COALESCE(v_data -> 'incomplete_orders', '[]'::jsonb)) > 0 THEN
    SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
    INTO v_chunk
    FROM (
      SELECT r.order_ref, r.label
      FROM jsonb_to_recordset(v_data -> 'incomplete_orders') AS r(order_id uuid, order_ref text, label text, status text)
      ORDER BY r.order_ref
      LIMIT 20
    ) x;
    v_lines := array_append(v_lines, '- Órdenes incompletas (borrador): ' || COALESCE(v_chunk, ''));
  END IF;

  RETURN array_to_string(v_lines, E'\n');
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL,
  p_closed_from_device text DEFAULT NULL,
  p_closed_from_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_actor_id uuid := auth.uid();
  v_now timestamptz := now();
  v_blockers_message text;
BEGIN
  SET LOCAL statement_timeout = '120s';

  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  PERFORM public.cancel_empty_draft_orders_for_branch(p_branch_id);

  -- Finalizar especiales ya pagadas del turno (no deben quedar colgadas en PAID)
  UPDATE public.orders o
  SET status = 'KITCHEN_DISPATCHED',
      dispatched_at = COALESCE(o.dispatched_at, v_now),
      closed_at = COALESCE(o.closed_at, v_now),
      updated_at = v_now
  WHERE o.branch_id = p_branch_id
    AND o.cash_shift_id IS NOT DISTINCT FROM p_shift_id
    AND COALESCE(o.is_special, false)
    AND o.status = 'PAID'
    AND o.paid_at IS NOT NULL
    AND COALESCE(o.notes, '') NOT ILIKE '%VOID_SUCCESSOR_ORDER:%';

  -- Mensaje unificado: cajas abiertas + órdenes pendientes (sin pagar / por despachar / incompletas)
  v_blockers_message := public.format_shift_closure_blockers_message(p_branch_id);
  IF v_blockers_message IS NOT NULL AND btrim(v_blockers_message) <> '' THEN
    RAISE EXCEPTION '%', v_blockers_message;
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = p_notes,
      closed_by = v_actor_id,
      closed_from_device = NULLIF(btrim(COALESCE(p_closed_from_device, '')), ''),
      closed_from_user_agent = NULLIF(btrim(COALESCE(p_closed_from_user_agent, '')), '')
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_branch_shift_closure_blockers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_shift_closure_blockers(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.format_shift_closure_blockers_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.format_shift_closure_blockers_message(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
