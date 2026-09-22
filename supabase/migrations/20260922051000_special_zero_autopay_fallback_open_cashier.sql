-- Autopago especial $0: cajero principal con caja abierta;
-- si no está / ya cerró, cualquier otro cajero con caja abierta del turno.

CREATE OR REPLACE FUNCTION public.autopagar_orden_especial_cero_interna(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := COALESCE(p_actor_id, auth.uid());
  v_primary_cashier_id uuid;
  v_assignee_id uuid;
  v_assign_tag text := '';
  v_now timestamptz := COALESCE(p_recorded_at, now());
  v_payment_id uuid;
  v_payment_method_id uuid;
  v_group_id text;
  v_existing_payment_id uuid;
  v_shift_id uuid;
  v_payments jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item record;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE
     OR v_order.special_total_manual IS NULL
     OR v_order.special_total_manual <> 0 THEN
    RETURN NULL;
  END IF;

  v_shift_id := COALESCE(
    v_order.cash_shift_id,
    public.infer_payment_shift_id(p_order_id, v_now, false)
  );

  IF v_shift_id IS NULL THEN
    SELECT cs.id, cs.primary_cashier_id
    INTO v_shift_id, v_primary_cashier_id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = v_order.branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
    LIMIT 1;
  ELSE
    SELECT cs.primary_cashier_id
    INTO v_primary_cashier_id
    FROM public.cash_shifts cs
    WHERE cs.id = v_shift_id;
  END IF;

  -- 1) Principal con caja abierta (no auxiliar).
  IF v_shift_id IS NOT NULL AND v_primary_cashier_id IS NOT NULL THEN
    SELECT cro.cashier_id
    INTO v_assignee_id
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = v_shift_id
      AND cro.cashier_id = v_primary_cashier_id
      AND cro.status = 'abierta'
      AND COALESCE(cro.register_role, 'cashier') <> 'auxiliary'
    ORDER BY cro.opened_at DESC NULLS LAST, cro.id DESC
    LIMIT 1;

    IF v_assignee_id IS NOT NULL THEN
      v_assign_tag := '|ASSIGNED_PRIMARY_CASHIER:1';
    END IF;
  END IF;

  -- 2) Si principal ausente o caja cerrada: cualquier otro cajero con caja abierta.
  IF v_assignee_id IS NULL AND v_shift_id IS NOT NULL THEN
    SELECT cro.cashier_id
    INTO v_assignee_id
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = v_shift_id
      AND cro.status = 'abierta'
      AND COALESCE(cro.register_role, 'cashier') <> 'auxiliary'
    ORDER BY cro.opened_at ASC NULLS LAST, cro.id ASC
    LIMIT 1;

    IF v_assignee_id IS NOT NULL THEN
      v_assign_tag := '|ASSIGNED_OPEN_CASHIER:1';
    END IF;
  END IF;

  -- 3) Fallback: actor / creador.
  v_actor_id := COALESCE(v_assignee_id, v_actor_id, v_order.created_by);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el usuario del cobro';
  END IF;

  SELECT p.id
  INTO v_existing_payment_id
  FROM public.payments p
  WHERE p.order_id = p_order_id
    AND COALESCE(lower(p.status), 'active') NOT IN ('voided', 'reversed')
    AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
    AND COALESCE(p.notes, '') NOT ILIKE '%TRANSFER_PROOF_PENDING:1%'
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1;

  IF v_existing_payment_id IS NOT NULL THEN
    PERFORM public.sync_order_payment_state_internal(p_order_id);
    RETURN v_existing_payment_id;
  END IF;

  SELECT pm.id
  INTO v_payment_method_id
  FROM public.payment_methods pm
  WHERE pm.branch_id = v_order.branch_id
    AND pm.is_active IS TRUE
    AND lower(trim(pm.name)) IN ('efectivo', 'cash')
  ORDER BY pm.name
  LIMIT 1;

  IF v_payment_method_id IS NULL THEN
    SELECT pm.id
    INTO v_payment_method_id
    FROM public.payment_methods pm
    WHERE pm.branch_id = v_order.branch_id
      AND pm.is_active IS TRUE
    ORDER BY pm.name
    LIMIT 1;
  END IF;

  IF v_payment_method_id IS NULL THEN
    RAISE EXCEPTION 'No hay metodo de pago activo en la sucursal';
  END IF;

  v_payment_id := gen_random_uuid();
  v_group_id := replace(v_payment_id::text, '-', '');

  v_payments := jsonb_build_array(
    jsonb_build_object(
      'id', v_payment_id::text,
      'order_id', p_order_id::text,
      'payment_method_id', v_payment_method_id::text,
      'amount', '0',
      'change_amount', '0',
      'notes', format(
        'GROUP:%s|ITEMS_ANCHOR:1|TENDERED:0.00|APPLIED:0.00|SPECIAL_ORDER:1|SPECIAL_ZERO_AUTOPAY:1%s',
        v_group_id,
        v_assign_tag
      ),
      'created_by', v_actor_id::text
    )
  );

  FOR v_item IN
    SELECT oi.id, oi.quantity, oi.unit_price
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('DRAFT', 'CANCELLED')
      AND COALESCE(oi.quantity, 0) > 0
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'payment_id', v_payment_id::text,
        'order_item_id', v_item.id::text,
        'quantity_paid', GREATEST(0, COALESCE(v_item.quantity, 0))::text,
        'unit_price', COALESCE(v_item.unit_price, 0)::text,
        'total_amount', '0'
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'La orden especial no tiene items enviados para registrar el cobro';
  END IF;

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    created_by,
    created_at,
    status,
    shift_id
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    (p->>'change_amount')::numeric,
    p->>'notes',
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, v_now),
    'active',
    v_shift_id
  FROM jsonb_array_elements(v_payments) AS p;

  INSERT INTO public.payment_items (
    id,
    payment_id,
    order_item_id,
    quantity_paid,
    unit_price,
    total_amount
  )
  SELECT
    (i->>'id')::uuid,
    (i->>'payment_id')::uuid,
    (i->>'order_item_id')::uuid,
    (i->>'quantity_paid')::numeric,
    (i->>'unit_price')::numeric,
    (i->>'total_amount')::numeric
  FROM jsonb_array_elements(v_items) AS i;

  PERFORM public.sync_order_payment_state_internal(p_order_id);

  RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION public.autopagar_orden_especial_cero_interna(uuid, uuid, timestamptz) IS
  'Cobro $0 de especial. Preferir cajero principal con caja abierta; si no, otro cajero con caja abierta.';
