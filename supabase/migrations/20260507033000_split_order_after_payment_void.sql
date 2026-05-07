-- Split an order after a payment void so the voided payment keeps the original
-- order number for audit, while the continuing account receives a fresh order code.

CREATE OR REPLACE FUNCTION public.can_void_payment(
  p_payment_id uuid,
  p_current_shift_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  can_void boolean,
  error_code text,
  error_message text,
  payment_id uuid,
  order_id uuid,
  payment_shift_id uuid,
  request_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_pending_request_id uuid;
  v_has_cash_access boolean := false;
BEGIN
  can_void := false;
  error_code := NULL;
  error_message := NULL;
  payment_id := p_payment_id;
  order_id := NULL;
  payment_shift_id := NULL;
  request_id := NULL;

  IF p_payment_id IS NULL THEN
    error_code := 'PAYMENT_REQUIRED';
    error_message := 'El pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_current_shift_id IS NULL THEN
    error_code := 'SHIFT_REQUIRED';
    error_message := 'No se encontro un turno activo para anular el pago';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    error_code := 'PAYMENT_NOT_FOUND';
    error_message := 'El pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_current_shift_id;

  IF NOT FOUND THEN
    error_code := 'SHIFT_NOT_FOUND';
    error_message := 'No se encontro el turno actual';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_shift.status <> 'OPEN' OR v_shift.caja_status <> 'OPEN' THEN
    error_code := 'SHIFT_CLOSED';
    error_message := 'No se puede anular un pago de un turno cerrado';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id;

  order_id := v_order.id;
  payment_shift_id := v_payment.shift_id;

  IF v_payment.shift_id IS NULL THEN
    error_code := 'PAYMENT_SHIFT_MISSING';
    error_message := 'El pago no tiene turno asociado';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_payment.shift_id <> p_current_shift_id THEN
    error_code := 'DIFFERENT_SHIFT';
    error_message := 'El pago solo puede anularse dentro del mismo turno en que fue registrado';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pvr.id
  INTO v_pending_request_id
  FROM public.payment_void_requests pvr
  WHERE pvr.payment_id = p_payment_id
    AND pvr.status = 'pending'
  ORDER BY pvr.created_at DESC
  LIMIT 1;

  IF COALESCE(lower(v_payment.status), 'active') = 'voided'
    OR v_payment.voided_at IS NOT NULL
    OR COALESCE(v_payment.notes, '') ILIKE '%VOIDED:%'
  THEN
    error_code := 'PAYMENT_ALREADY_VOIDED';
    error_message := 'El pago ya fue anulado';
    RETURN NEXT;
    RETURN;
  END IF;

  IF COALESCE(lower(v_payment.status), 'active') NOT IN ('active', 'completed', 'captured') THEN
    error_code := 'PAYMENT_STATUS_INVALID';
    error_message := 'El pago no esta en un estado anulable';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.id IS NULL THEN
    error_code := 'ORDER_NOT_FOUND';
    error_message := 'La cuenta asociada al pago no existe';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    error_code := 'ORDER_STATUS_BLOCKED';
    error_message := 'La cuenta asociada esta en un estado incompatible para anular el pago';
    RETURN NEXT;
    RETURN;
  END IF;

  v_has_cash_access :=
    public.can_manage_branch_admin(p_user_id, v_shift.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_current_shift_id
        AND csu.user_id = p_user_id
        AND csu.is_enabled = true
        AND (csu.can_use_caja = true OR csu.is_supervisor = true)
    );

  IF NOT v_has_cash_access THEN
    error_code := 'REQUESTER_NOT_ALLOWED';
    error_message := 'Tu usuario no tiene permisos para iniciar la anulacion del pago';
    RETURN NEXT;
    RETURN;
  END IF;

  can_void := true;
  request_id := v_pending_request_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_successor_order_after_payment_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_order public.orders%ROWTYPE;
  v_new_order_id uuid := gen_random_uuid();
  v_new_order_number integer;
  v_new_order_code text;
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_try integer := 0;
  v_table_name text;
  v_old_item record;
  v_new_item_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(lower(NEW.status), '') <> 'voided'
    OR COALESCE(lower(OLD.status), '') = 'voided'
    OR NEW.voided_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_old_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_old_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RETURN NEW;
  END IF;

  IF v_old_order.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(rt.name, v_old_order.table_name_snapshot)
  INTO v_table_name
  FROM public.restaurant_tables rt
  WHERE rt.id = v_old_order.table_id;

  v_new_order_number := nextval('orders_order_number_seq');

  SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
  INTO v_branch_token
  FROM public.branches
  WHERE id = v_old_order.branch_id;

  v_date_part := to_char(now() AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

  LOOP
    v_try := v_try + 1;
    v_seq := public.next_human_sequence('orders_daily', v_old_order.branch_id, v_date_part);
    v_new_order_code := COALESCE(v_branch_token, 'SUC000') || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.order_code = v_new_order_code
    );

    IF v_try >= 50 THEN
      RAISE EXCEPTION 'No se pudo generar order_code unico para la orden sucesora';
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    id,
    branch_id,
    order_type,
    menu_scope,
    table_id,
    split_id,
    table_order_position,
    status,
    order_number,
    order_code,
    created_by,
    created_at,
    updated_at,
    sent_to_kitchen_at,
    ready_at,
    dispatched_at,
    paid_at,
    is_special,
    special_total_manual,
    special_marked_at,
    special_marked_by,
    special_origin_table_id,
    special_origin_split_id,
    is_tray_order,
    table_name_snapshot,
    notes
  )
  VALUES (
    v_new_order_id,
    v_old_order.branch_id,
    v_old_order.order_type,
    v_old_order.menu_scope,
    v_old_order.table_id,
    v_old_order.split_id,
    v_old_order.table_order_position,
    CASE
      WHEN v_old_order.status IN ('DRAFT', 'CANCELLED', 'PAID') THEN 'KITCHEN_DISPATCHED'::public.order_status
      ELSE v_old_order.status
    END,
    v_new_order_number,
    v_new_order_code,
    v_old_order.created_by,
    now(),
    now(),
    COALESCE(v_old_order.sent_to_kitchen_at, now()),
    COALESCE(v_old_order.ready_at, now()),
    COALESCE(v_old_order.dispatched_at, now()),
    NULL,
    v_old_order.is_special,
    v_old_order.special_total_manual,
    v_old_order.special_marked_at,
    v_old_order.special_marked_by,
    v_old_order.special_origin_table_id,
    v_old_order.special_origin_split_id,
    v_old_order.is_tray_order,
    COALESCE(v_table_name, v_old_order.table_name_snapshot),
    public.append_payment_note_marker(v_old_order.notes, 'SUCCESSOR_OF_VOIDED_ORDER:' || v_old_order.id::text)
  );

  FOR v_old_item IN
    SELECT *
    FROM public.order_items oi
    WHERE oi.order_id = v_old_order.id
      AND COALESCE(oi.status::text, '') <> 'CANCELLED'
    ORDER BY oi.created_at, oi.id
  LOOP
    v_new_item_id := gen_random_uuid();

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
      created_at,
      dispatched_at,
      paid_at,
      cancelled_at,
      cancelled_by,
      cancellation_reason,
      cancelled_from_status,
      sent_to_kitchen_at,
      ready_at,
      tray_item_type,
      tray_container_cost
    )
    VALUES (
      v_new_item_id,
      v_new_order_id,
      v_old_item.product_id,
      v_old_item.description_snapshot,
      v_old_item.item_note,
      v_old_item.quantity,
      v_old_item.unit_price,
      v_old_item.total,
      CASE
        WHEN NULLIF(btrim(v_old_item.status::text), '') IS NULL THEN 'SENT'
        WHEN v_old_item.status::text = 'DRAFT' THEN 'SENT'
        WHEN v_old_item.status::text IN ('SENT', 'DISPATCHED', 'PAID', 'CANCELLED') THEN v_old_item.status::text
        ELSE 'SENT'
      END::public.order_item_status,
      now(),
      v_old_item.dispatched_at,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      COALESCE(v_old_item.sent_to_kitchen_at, now()),
      COALESCE(v_old_item.ready_at, now()),
      v_old_item.tray_item_type,
      v_old_item.tray_container_cost
    );

    INSERT INTO public.order_item_modifiers (
      id,
      order_item_id,
      modifier_id
    )
    SELECT
      gen_random_uuid(),
      v_new_item_id,
      oim.modifier_id
    FROM public.order_item_modifiers oim
    WHERE oim.order_item_id = v_old_item.id
    ON CONFLICT DO NOTHING;

    UPDATE public.payment_items pi
    SET order_item_id = v_new_item_id
    WHERE pi.order_item_id = v_old_item.id
      AND EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.id = pi.payment_id
          AND p.order_id = v_old_order.id
          AND p.id <> NEW.id
          AND COALESCE(lower(p.status), 'active') <> 'voided'
          AND p.voided_at IS NULL
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
      );
  END LOOP;

  UPDATE public.payments p
  SET order_id = v_new_order_id
  WHERE p.order_id = v_old_order.id
    AND p.id <> NEW.id
    AND COALESCE(lower(p.status), 'active') <> 'voided'
    AND p.voided_at IS NULL
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%';

  UPDATE public.orders o
  SET
    table_name_snapshot = COALESCE(v_table_name, o.table_name_snapshot),
    table_id = NULL,
    split_id = NULL,
    table_order_position = NULL,
    status = 'CANCELLED',
    paid_at = NULL,
    cancelled_at = COALESCE(o.cancelled_at, now()),
    cancelled_by = COALESCE(o.cancelled_by, NEW.voided_by),
    cancelled_from_status = COALESCE(o.cancelled_from_status, v_old_order.status::text),
    cancellation_reason = COALESCE(o.cancellation_reason, 'Pago anulado; orden conservada como historial'),
    notes = public.append_payment_note_marker(
      public.append_payment_note_marker(o.notes, 'VOID_SUCCESSOR_ORDER:' || v_new_order_id::text),
      'VOIDED_PAYMENT_HISTORICAL:' || NEW.id::text
    ),
    updated_at = now()
  WHERE o.id = v_old_order.id;

  PERFORM public.compact_table_order_positions(v_old_order.table_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_successor_order_after_payment_void ON public.payments;
CREATE TRIGGER trg_create_successor_order_after_payment_void
AFTER UPDATE OF status, voided_at ON public.payments
FOR EACH ROW
WHEN (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.create_successor_order_after_payment_void();

CREATE OR REPLACE FUNCTION public.recalculate_check_balance(
  p_check_id uuid
)
RETURNS TABLE (
  order_id uuid,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
  v_order public.orders%ROWTYPE;
  v_cancelled_at timestamptz;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_check_id
  FOR UPDATE;

  -- Historical orders created by a payment void must stay out of active flows.
  IF FOUND AND COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    v_cancelled_at := COALESCE(v_order.cancelled_at, now());

    UPDATE public.orders
    SET
      status = 'CANCELLED',
      paid_at = NULL,
      cancelled_at = v_cancelled_at,
      cancellation_reason = COALESCE(cancellation_reason, 'Pago anulado; orden conservada como historial'),
      table_id = NULL,
      split_id = NULL,
      table_order_position = NULL,
      updated_at = now()
    WHERE id = p_check_id;

    RETURN QUERY
    SELECT p_check_id, 'CANCELLED'::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT *
  INTO v_result
  FROM public.sync_order_payment_state_internal(p_check_id)
  LIMIT 1;

  PERFORM public.restore_voided_dine_in_order_to_table(p_check_id);

  RETURN QUERY
  SELECT
    COALESCE(v_result.order_id, p_check_id),
    v_result.status,
    v_result.paid_at;
END;
$$;

REVOKE ALL ON FUNCTION public.can_void_payment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_void_payment(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_successor_order_after_payment_void() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.recalculate_check_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_check_balance(uuid) TO authenticated;

UPDATE public.orders
SET
  status = 'CANCELLED',
  paid_at = NULL,
  cancelled_at = COALESCE(cancelled_at, now()),
  cancellation_reason = COALESCE(cancellation_reason, 'Pago anulado; orden conservada como historial'),
  table_id = NULL,
  split_id = NULL,
  table_order_position = NULL,
  updated_at = now()
WHERE COALESCE(notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%';

NOTIFY pgrst, 'reload schema';
