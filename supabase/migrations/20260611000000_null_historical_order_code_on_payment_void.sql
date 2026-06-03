-- Históricas por anulación de pago: liberar order_code con NULL en lugar del sufijo -Vxxxx.
-- La sucesora conserva el código operativo; order_number en la histórica sigue para auditoría.

UPDATE public.orders
SET order_code = NULL,
    updated_at = now()
WHERE status = 'CANCELLED'
  AND COALESCE(notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%'
  AND order_code ~ '-V[a-f0-9]{4}$';

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
  v_table_name text;
  v_old_item record;
  v_new_item_id uuid;
  v_voided_qty integer;
  v_remaining_qty integer;
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

  v_new_order_number := v_old_order.order_number;
  v_new_order_code := v_old_order.order_code;

  -- Liberar order_code único: la histórica queda sin código (order_number se conserva).
  UPDATE public.orders
  SET order_code = NULL,
      updated_at = now()
  WHERE id = v_old_order.id;

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
    SELECT COALESCE(SUM(oic.quantity_cancelled), 0)::integer
    INTO v_voided_qty
    FROM public.order_item_cancellations oic
    JOIN public.order_cancellations oc ON oc.id = oic.order_cancellation_id
    WHERE oic.order_item_id = v_old_item.id
      AND oc.order_id = v_old_order.id
      AND oc.status = 'APPLIED';

    v_remaining_qty := v_old_item.quantity - v_voided_qty;

    IF v_remaining_qty <= 0 THEN
      CONTINUE;
    END IF;

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
      v_remaining_qty,
      v_old_item.unit_price,
      ROUND((v_remaining_qty * v_old_item.unit_price)::numeric, 2),
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
