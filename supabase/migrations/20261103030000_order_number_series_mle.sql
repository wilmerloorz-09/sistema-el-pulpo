-- Numeración visible por tipo/sucursal/día: M001, L001, E001.
-- Órdenes históricas conservan order_code numérico y UI #0001.

CREATE OR REPLACE FUNCTION public.order_number_series_for_type(p_order_type public.order_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_order_type
    WHEN 'EXPRESS'::public.order_type THEN 'E'
    WHEN 'TAKEOUT'::public.order_type THEN 'L'
    WHEN 'EXTRA'::public.order_type THEN 'L'
    ELSE 'M'
  END;
$$;

CREATE OR REPLACE FUNCTION public.order_number_from_order_code(p_order_code text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_suffix text;
BEGIN
  IF p_order_code IS NULL OR btrim(p_order_code) = '' THEN
    RETURN NULL;
  END IF;

  v_suffix := split_part(btrim(p_order_code), '-', 2);
  IF v_suffix ~ '^[MLE][0-9]+$' THEN
    RETURN substring(v_suffix from 2)::integer;
  END IF;
  IF v_suffix ~ '^[0-9]+$' THEN
    RETURN v_suffix::integer;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_order_numbering(
  p_branch_id uuid,
  p_order_type public.order_type,
  p_created_at timestamptz DEFAULT now(),
  p_exclude_order_id uuid DEFAULT NULL
)
RETURNS TABLE(out_order_code text, out_order_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_token text;
  v_date_part text;
  v_series text;
  v_seq bigint;
  v_suffix text;
  v_candidate text;
  v_try int := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  v_series := public.order_number_series_for_type(p_order_type);

  SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
    INTO v_branch_token
  FROM public.branches
  WHERE id = p_branch_id;

  IF v_branch_token IS NULL OR btrim(v_branch_token) = '' THEN
    v_branch_token := 'SUC000';
  END IF;

  v_date_part := to_char(COALESCE(p_created_at, now()) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

  LOOP
    v_try := v_try + 1;
    v_seq := public.next_human_sequence(
      'orders_daily_' || v_series,
      p_branch_id,
      v_date_part
    );
    v_suffix := v_series || lpad(v_seq::text, 3, '0');
    v_candidate := v_branch_token || v_date_part || '-' || v_suffix;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.order_code = v_candidate
        AND (p_exclude_order_id IS NULL OR o.id <> p_exclude_order_id)
    );

    IF v_try >= 50 THEN
      RAISE EXCEPTION 'No se pudo generar order_code unico (% / % / %)', v_series, p_branch_id, v_date_part;
    END IF;
  END LOOP;

  out_order_code := v_candidate;
  out_order_number := v_seq::integer;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.order_number_series_for_type(public.order_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_number_from_order_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_order_numbering(uuid, public.order_type, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_order_number_from_order_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_parsed integer;
BEGIN
  IF NEW.order_code IS NULL OR btrim(NEW.order_code) = '' THEN
    RETURN NEW;
  END IF;

  v_parsed := public.order_number_from_order_code(NEW.order_code);
  IF v_parsed IS NOT NULL THEN
    NEW.order_number := v_parsed;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alloc record;
BEGIN
  IF NEW.order_code IS NOT NULL AND btrim(NEW.order_code) <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  SELECT a.out_order_code, a.out_order_number
    INTO v_alloc
  FROM public.allocate_order_numbering(
    NEW.branch_id,
    NEW.order_type,
    COALESCE(NEW.created_at, now()),
    NEW.id
  ) a;

  NEW.order_code := v_alloc.out_order_code;
  NEW.order_number := COALESCE(NEW.order_number, v_alloc.out_order_number);
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.submit_order_draft_items(p_order_id uuid)
 RETURNS TABLE(order_id uuid, order_status order_status, submitted_item_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_branch_token text;
  v_workflow_mode text := 'CASH_THEN_DISPATCH';
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_especial_cero boolean := false;
  v_autopagar_al_enviar boolean := false;
  v_reabrir_despachada boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  v_reabrir_despachada := v_order.status = 'KITCHEN_DISPATCHED';

  SELECT COALESCE(b.workflow_mode, 'CASH_THEN_DISPATCH')
  INTO v_workflow_mode
  FROM public.branches b
  WHERE b.id = v_order.branch_id;

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_especial_cero := COALESCE(v_order.is_special, false)
    AND v_order.special_total_manual IS NOT NULL
    AND v_order.special_total_manual = 0;

  v_autopagar_al_enviar := v_especial_cero
    AND v_workflow_mode = 'CASH_THEN_DISPATCH';

  v_next_status := CASE
    WHEN v_autopagar_al_enviar THEN 'PAID'::public.order_status
    ELSE 'SENT_TO_KITCHEN'::public.order_status
  END;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT a.out_order_code, a.out_order_number
      INTO v_new_order_code, v_new_order_number
    FROM public.allocate_order_numbering(
      v_order.branch_id,
      v_order.order_type,
      COALESCE(v_order.created_at, v_now),
      NULL
    ) a;
  ELSIF v_new_order_number IS NULL THEN
    v_new_order_number := public.order_number_from_order_code(v_new_order_code);
  END IF;
UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = CASE
      WHEN v_autopagar_al_enviar THEN v_now
      WHEN v_reabrir_despachada THEN o.paid_at
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_reabrir_despachada THEN o.dispatched_at
      ELSE NULL
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  IF v_autopagar_al_enviar THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, v_actor_id);
    SELECT o.status INTO v_next_status FROM public.orders o WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$function$;


CREATE OR REPLACE FUNCTION public.submit_express_order_draft_items(p_order_id uuid)
 RETURNS TABLE(order_id uuid, order_status order_status, submitted_item_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_reabrir_despachada boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.order_type <> 'EXPRESS' THEN
    RAISE EXCEPTION 'Esta operacion solo aplica a ordenes Express';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  v_reabrir_despachada := v_order.status = 'KITCHEN_DISPATCHED';

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_next_status := 'SENT_TO_KITCHEN'::public.order_status;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT a.out_order_code, a.out_order_number
      INTO v_new_order_code, v_new_order_number
    FROM public.allocate_order_numbering(
      v_order.branch_id,
      v_order.order_type,
      COALESCE(v_order.created_at, v_now),
      NULL
    ) a;
  ELSIF v_new_order_number IS NULL THEN
    v_new_order_number := public.order_number_from_order_code(v_new_order_code);
  END IF;
UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = CASE WHEN v_reabrir_despachada THEN o.paid_at ELSE NULL END,
    dispatched_at = CASE WHEN v_reabrir_despachada THEN o.dispatched_at ELSE NULL END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$function$;


CREATE OR REPLACE FUNCTION public._enviar_orden_express_pedidos_interno(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_draft_count integer := 0;
  v_new_order_number integer;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_new_order_code text;
  v_try int := 0;
  v_actor_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.order_type <> 'EXPRESS' THEN
    RAISE EXCEPTION 'Esta operacion solo aplica a ordenes Express.';
  END IF;

  IF v_order.status IN ('PAID', 'KITCHEN_DISPATCHED', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  -- Pedido externo sin usuario del sistema: el movimiento se registra a nombre del cajero del turno.
  IF v_actor_id IS NULL THEN
    SELECT cs.cashier_id INTO v_actor_id FROM public.cash_shifts cs WHERE cs.id = v_order.cash_shift_id;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);
  END IF;

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT a.out_order_code, a.out_order_number
      INTO v_new_order_code, v_new_order_number
    FROM public.allocate_order_numbering(
      v_order.branch_id,
      v_order.order_type,
      COALESCE(v_order.created_at, v_now),
      NULL
    ) a;
  ELSIF v_new_order_number IS NULL THEN
    v_new_order_number := public.order_number_from_order_code(v_new_order_code);
  END IF;
UPDATE public.orders o
  SET
    status = 'SENT_TO_KITCHEN',
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = NULL,
    dispatched_at = NULL,
    updated_at = v_now
  WHERE o.id = p_order_id;

  PERFORM public.recompute_order_operational_state(p_order_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.move_dine_in_order_items_between_orders(p_source_order_id uuid, p_destination_order_id uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(source_order_id uuid, destination_order_id uuid, moved_items integer, moved_units integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_order public.orders%ROWTYPE;
  v_destination_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_lock_key_a text;
  v_lock_key_b text;
  v_source_item_id uuid;
  v_requested_qty integer;
  v_source_item public.order_items%ROWTYPE;
  v_snapshot record;
  v_move_pending integer;
  v_move_ready_available integer;
  v_move_dispatched integer;
  v_move_dispatched_from_pending integer;
  v_move_dispatched_from_ready integer;
  v_move_ready_history integer;
  v_destination_item_id uuid;
  v_ready_event_id uuid;
  v_dispatch_event_id uuid;
  v_remaining integer;
  v_take integer;
  v_ready_line record;
  v_dispatch_line record;
  v_modifier record;
  v_moved_items integer := 0;
  v_moved_units integer := 0;
  v_source_remaining_rows integer := 0;
  v_paid_qty_effective integer := 0;
  v_movable_dispatched integer := 0;
  v_max_movable integer := 0;
  v_destination_order_after public.orders%ROWTYPE;
  v_destination_new_order_number integer;
  v_destination_new_order_code text;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_try int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_source_order_id IS NULL OR p_destination_order_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la orden origen y la orden destino';
  END IF;

  IF p_source_order_id = p_destination_order_id THEN
    RAISE EXCEPTION 'La orden destino debe ser distinta de la orden origen';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos un item para mover';
  END IF;

  SELECT o.*
  INTO v_source_order
  FROM public.orders o
  WHERE o.id = p_source_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden origen';
  END IF;

  SELECT o.*
  INTO v_destination_order
  FROM public.orders o
  WHERE o.id = p_destination_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden destino';
  END IF;

  IF v_source_order.order_type <> 'DINE_IN' OR v_destination_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden mover items entre ordenes DINE_IN';
  END IF;

  IF COALESCE(v_source_order.is_special, false) OR COALESCE(v_destination_order.is_special, false) THEN
    RAISE EXCEPTION 'Las ordenes especiales no participan en Unir/Dividir';
  END IF;

  IF v_source_order.table_id IS NULL OR v_destination_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Ambas ordenes deben pertenecer a una mesa o division activa';
  END IF;

  IF v_source_order.branch_id <> v_destination_order.branch_id THEN
    RAISE EXCEPTION 'Las ordenes deben pertenecer a la misma sucursal';
  END IF;

  IF v_source_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    OR v_destination_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED') THEN
    RAISE EXCEPTION 'Solo se pueden mover items entre ordenes activas';
  END IF;

  -- Sin chequeo de OPERATE en mesas/ordenes: cualquier usuario autenticado puede mover ítems.

  v_lock_key_a := LEAST(p_source_order_id::text, p_destination_order_id::text);
  v_lock_key_b := GREATEST(p_source_order_id::text, p_destination_order_id::text);

  PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_items_between_orders:' || v_lock_key_a));
  IF v_lock_key_b <> v_lock_key_a THEN
    PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_items_between_orders:' || v_lock_key_b));
  END IF;

  CREATE TEMP TABLE tmp_move_targets (
    order_item_id uuid PRIMARY KEY,
    quantity integer NOT NULL CHECK (quantity > 0)
  ) ON COMMIT DROP;

  FOR v_source_item_id, v_requested_qty IN
    SELECT
      (item ->> 'order_item_id')::uuid,
      (item ->> 'quantity')::integer
    FROM jsonb_array_elements(p_items) AS item
  LOOP
    IF v_source_item_id IS NULL THEN
      RAISE EXCEPTION 'order_item_id invalido en Unir/Dividir';
    END IF;

    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para item %', v_source_item_id;
    END IF;

    INSERT INTO tmp_move_targets (order_item_id, quantity)
    VALUES (v_source_item_id, v_requested_qty)
    ON CONFLICT (order_item_id)
    DO UPDATE SET quantity = tmp_move_targets.quantity + EXCLUDED.quantity;
  END LOOP;

  FOR v_source_item_id, v_requested_qty IN
    SELECT order_item_id, quantity
    FROM tmp_move_targets
  LOOP
    SELECT
      oi.*
    INTO v_source_item
    FROM public.order_items oi
    WHERE oi.id = v_source_item_id
      AND oi.order_id = p_source_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El item % no pertenece a la orden origen', v_source_item_id;
    END IF;

    SELECT
      COALESCE(snapshot.quantity_pending_prepare, 0)::int AS quantity_pending_prepare,
      COALESCE(snapshot.quantity_ready_available, 0)::int AS quantity_ready_available,
      GREATEST(
        0,
        COALESCE(snapshot.quantity_dispatched_total, 0) - COALESCE(snapshot.quantity_cancelled_dispatched, 0)
      )::int AS quantity_dispatched_available,
      COALESCE(snapshot.quantity_paid, 0)::int AS quantity_paid,
      COALESCE(snapshot.quantity_cancelled_total, 0)::int AS quantity_cancelled_total
    INTO v_snapshot
    FROM public.get_order_operational_snapshot(p_source_order_id) snapshot
    WHERE snapshot.order_item_id = v_source_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo resolver el estado operativo del item %', v_source_item_id;
    END IF;

    v_paid_qty_effective := LEAST(
      COALESCE(v_snapshot.quantity_paid, 0),
      COALESCE(v_snapshot.quantity_dispatched_available, 0)
    );
    v_movable_dispatched := GREATEST(
      0,
      COALESCE(v_snapshot.quantity_dispatched_available, 0) - v_paid_qty_effective
    );
    v_max_movable := COALESCE(v_snapshot.quantity_pending_prepare, 0)
      + COALESCE(v_snapshot.quantity_ready_available, 0)
      + v_movable_dispatched;

    IF v_requested_qty > v_max_movable THEN
      RAISE EXCEPTION 'El item % solo tiene % unidad(es) disponibles para mover sin afectar pagos existentes', v_source_item_id, v_max_movable;
    END IF;

    v_move_pending := LEAST(v_requested_qty, COALESCE(v_snapshot.quantity_pending_prepare, 0));
    v_remaining := v_requested_qty - v_move_pending;
    v_move_ready_available := LEAST(v_remaining, COALESCE(v_snapshot.quantity_ready_available, 0));
    v_remaining := v_remaining - v_move_ready_available;
    v_move_dispatched := LEAST(v_remaining, v_movable_dispatched);
    v_move_dispatched_from_pending := 0;
    v_move_dispatched_from_ready := 0;

    IF v_move_dispatched > 0 THEN
      v_remaining := v_move_dispatched;

      FOR v_dispatch_line IN
        SELECT
          oide.id,
          oide.quantity_dispatched,
          oide.source_stage
        FROM public.order_item_dispatch_events oide
        JOIN public.order_dispatch_events ode
          ON ode.id = oide.order_dispatch_event_id
        WHERE oide.order_item_id = v_source_item.id
          AND ode.status = 'APPLIED'
        ORDER BY oide.created_at DESC, oide.id DESC
        FOR UPDATE OF oide
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_remaining, COALESCE(v_dispatch_line.quantity_dispatched, 0));
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;

        IF v_dispatch_line.source_stage = 'PENDING' THEN
          v_move_dispatched_from_pending := v_move_dispatched_from_pending + v_take;
        ELSE
          v_move_dispatched_from_ready := v_move_dispatched_from_ready + v_take;
        END IF;

        IF v_take = v_dispatch_line.quantity_dispatched THEN
          DELETE FROM public.order_item_dispatch_events
          WHERE id = v_dispatch_line.id;
        ELSE
          UPDATE public.order_item_dispatch_events
          SET quantity_dispatched = quantity_dispatched - v_take
          WHERE id = v_dispatch_line.id;
        END IF;

        v_remaining := v_remaining - v_take;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'No se pudo redistribuir el historial despachado del item %', v_source_item_id;
      END IF;
    END IF;

    v_move_ready_history := v_move_ready_available + v_move_dispatched_from_ready;

    IF v_move_ready_history > 0 THEN
      v_remaining := v_move_ready_history;

      FOR v_ready_line IN
        SELECT
          oire.id,
          oire.quantity_ready
        FROM public.order_item_ready_events oire
        JOIN public.order_ready_events ore
          ON ore.id = oire.order_ready_event_id
        WHERE oire.order_item_id = v_source_item.id
          AND ore.status = 'APPLIED'
        ORDER BY oire.created_at DESC, oire.id DESC
        FOR UPDATE OF oire
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_remaining, COALESCE(v_ready_line.quantity_ready, 0));
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;

        IF v_take = v_ready_line.quantity_ready THEN
          DELETE FROM public.order_item_ready_events
          WHERE id = v_ready_line.id;
        ELSE
          UPDATE public.order_item_ready_events
          SET quantity_ready = quantity_ready - v_take
          WHERE id = v_ready_line.id;
        END IF;

        v_remaining := v_remaining - v_take;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'No se pudo redistribuir el historial de listo del item %', v_source_item_id;
      END IF;
    END IF;

    INSERT INTO public.order_items (
      id,
      order_id,
      product_id,
      description_snapshot,
      item_note,
      quantity,
      unit_price,
      total,
      status,
      sent_to_kitchen_at,
      ready_at,
      dispatched_at,
      tray_item_type,
      tray_container_cost,
      paid_at,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      p_destination_order_id,
      v_source_item.product_id,
      v_source_item.description_snapshot,
      v_source_item.item_note,
      v_requested_qty,
      v_source_item.unit_price,
      CASE
        WHEN v_requested_qty > 0 THEN (v_requested_qty * COALESCE(v_source_item.unit_price, 0)) + COALESCE(v_source_item.tray_container_cost, 0)
        ELSE 0
      END,
      CASE
        WHEN v_move_dispatched > 0 THEN 'DISPATCHED'
        WHEN v_move_ready_history > 0 THEN 'SENT'
        ELSE COALESCE(v_source_item.status, 'SENT')
      END,
      COALESCE(v_source_item.sent_to_kitchen_at, v_source_order.sent_to_kitchen_at, v_now),
      CASE WHEN v_move_ready_history > 0 THEN COALESCE(v_source_item.ready_at, v_now) ELSE NULL END,
      CASE WHEN v_move_dispatched > 0 THEN COALESCE(v_source_item.dispatched_at, v_now) ELSE NULL END,
      v_source_item.tray_item_type,
      COALESCE(v_source_item.tray_container_cost, 0),
      NULL,
      v_now
    )
    RETURNING id
    INTO v_destination_item_id;

    FOR v_modifier IN
      SELECT oim.modifier_id
      FROM public.order_item_modifiers oim
      WHERE oim.order_item_id = v_source_item.id
    LOOP
      INSERT INTO public.order_item_modifiers (
        id,
        modifier_id,
        order_item_id
      )
      VALUES (
        gen_random_uuid(),
        v_modifier.modifier_id,
        v_destination_item_id
      );
    END LOOP;

    IF v_move_ready_history > 0 THEN
      IF v_ready_event_id IS NULL THEN
        INSERT INTO public.order_ready_events (
          order_id,
          event_type,
          created_by,
          source_module,
          notes,
          created_at
        )
        VALUES (
          p_destination_order_id,
          'partial',
          auth.uid(),
          'orders',
          format('moved_from:%s', p_source_order_id),
          v_now
        )
        RETURNING id
        INTO v_ready_event_id;
      END IF;

      INSERT INTO public.order_item_ready_events (
        order_ready_event_id,
        order_id,
        order_item_id,
        quantity_ready,
        created_at
      )
      VALUES (
        v_ready_event_id,
        p_destination_order_id,
        v_destination_item_id,
        v_move_ready_history,
        v_now
      );
    END IF;

    IF v_move_dispatched > 0 THEN
      IF v_dispatch_event_id IS NULL THEN
        INSERT INTO public.order_dispatch_events (
          order_id,
          event_type,
          created_by,
          source_module,
          notes,
          created_at
        )
        VALUES (
          p_destination_order_id,
          'partial',
          auth.uid(),
          'orders',
          format('moved_from:%s', p_source_order_id),
          v_now
        )
        RETURNING id
        INTO v_dispatch_event_id;
      END IF;

      IF v_move_dispatched_from_pending > 0 THEN
        INSERT INTO public.order_item_dispatch_events (
          order_dispatch_event_id,
          order_id,
          order_item_id,
          quantity_dispatched,
          source_stage,
          created_at
        )
        VALUES (
          v_dispatch_event_id,
          p_destination_order_id,
          v_destination_item_id,
          v_move_dispatched_from_pending,
          'PENDING',
          v_now
        );
      END IF;

      IF v_move_dispatched_from_ready > 0 THEN
        INSERT INTO public.order_item_dispatch_events (
          order_dispatch_event_id,
          order_id,
          order_item_id,
          quantity_dispatched,
          source_stage,
          created_at
        )
        VALUES (
          v_dispatch_event_id,
          p_destination_order_id,
          v_destination_item_id,
          v_move_dispatched_from_ready,
          'READY',
          v_now
        );
      END IF;
    END IF;

    UPDATE public.order_items
    SET
      quantity = quantity - v_requested_qty,
      total = CASE
        WHEN (quantity - v_requested_qty) > 0
          THEN ((quantity - v_requested_qty) * COALESCE(unit_price, 0)) + COALESCE(tray_container_cost, 0)
        ELSE 0
      END
    WHERE id = v_source_item.id;

    DELETE FROM public.order_item_modifiers
    WHERE order_item_id = v_source_item.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.id = v_source_item.id
          AND COALESCE(oi.quantity, 0) > 0
      );

    DELETE FROM public.order_items
    WHERE id = v_source_item.id
      AND COALESCE(quantity, 0) <= 0;

    v_moved_items := v_moved_items + 1;
    v_moved_units := v_moved_units + v_requested_qty;
  END LOOP;

  PERFORM public.sync_order_payment_state_internal(p_destination_order_id);

  SELECT o.*
  INTO v_destination_order_after
  FROM public.orders o
  WHERE o.id = p_destination_order_id
  FOR UPDATE;

  IF v_destination_order_after.order_number IS NULL
    AND v_destination_order_after.status <> 'DRAFT' THEN
    SELECT a.out_order_code, a.out_order_number
      INTO v_destination_new_order_code, v_destination_new_order_number
    FROM public.allocate_order_numbering(
      v_destination_order_after.branch_id,
      v_destination_order_after.order_type,
      COALESCE(v_destination_order_after.created_at, v_now),
      p_destination_order_id
    ) a;

    UPDATE public.orders o
    SET
      order_number = v_destination_new_order_number,
      order_code = v_destination_new_order_code,
      updated_at = v_now
    WHERE o.id = p_destination_order_id;
  END IF;

  SELECT COUNT(*)
  INTO v_source_remaining_rows
  FROM public.order_items oi
  WHERE oi.order_id = p_source_order_id;

  IF v_source_remaining_rows = 0 THEN
    UPDATE public.orders o
    SET
      status = 'DRAFT',
      sent_to_kitchen_at = NULL,
      ready_at = NULL,
      dispatched_at = NULL,
      paid_at = NULL,
      cancelled_at = NULL,
      cancel_requested_at = NULL,
      cancel_requested_by = NULL,
      updated_at = v_now
    WHERE o.id = p_source_order_id;
  ELSE
    PERFORM public.sync_order_payment_state_internal(p_source_order_id);
  END IF;

  RETURN QUERY
  SELECT
    p_source_order_id,
    p_destination_order_id,
    v_moved_items,
    v_moved_units;
END;
$function$;


DROP FUNCTION IF EXISTS public.get_mesero_ready_alerts(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.get_mesero_ready_alerts(
  p_branch_id uuid,
  p_created_by uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  notification_id uuid,
  order_id uuid,
  order_number integer,
  order_code text,
  order_type text,
  branch_id uuid,
  created_by uuid,
  table_name text,
  split_code text,
  created_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    e.id AS notification_id,
    o.id AS order_id,
    o.order_number,
    o.order_code,
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

NOTIFY pgrst, 'reload schema';
