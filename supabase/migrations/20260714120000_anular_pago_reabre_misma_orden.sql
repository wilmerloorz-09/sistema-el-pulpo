-- =============================================================================
-- Anulación de pago: reabrir la MISMA orden (mismo order_code / order_number)
-- =============================================================================
-- Antes: al anular se cancelaba la orden y se creaba una sucesora con nuevo
-- número (VOID_SUCCESSOR_ORDER).
-- Ahora: la orden anulada permanece activa, se limpia paid_at y vuelve a
-- En Caja (SENT_TO_KITCHEN) para poder re-cobrarse con el mismo número.
-- Órdenes históricas ya marcadas con VOID_SUCCESSOR_ORDER no se tocan.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_successor_order_after_payment_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
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
  INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Históricas de anulación previa (flujo con sucesora): no modificar.
  IF COALESCE(v_order.notes, '') ILIKE '%VOID_SUCCESSOR_ORDER:%' THEN
    RETURN NEW;
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  -- Salir de PAID (estado terminal) para permitir sync / re-cobro.
  -- Conservar mesa, código y número de la orden.
  UPDATE public.orders
  SET
    status = 'SENT_TO_KITCHEN'::public.order_status,
    paid_at = NULL,
    token_promocion = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancellation_reason = NULL,
    cancelled_from_status = NULL,
    notes = public.append_payment_note_marker(
      public.append_payment_note_marker(
        v_order.notes,
        'VOIDED_PAYMENT:' || NEW.id::text
      ),
      'VOIDED_PAYMENT_REOPEN:' || NEW.id::text
    ),
    updated_at = now()
  WHERE id = v_order.id;

  -- Quitar cobro aplicado en ítems; sync lo recalculará si quedan pagos activos.
  UPDATE public.order_items
  SET paid_at = NULL
  WHERE order_id = v_order.id
    AND paid_at IS NOT NULL;

  PERFORM public.sync_order_payment_state_internal(v_order.id);
  PERFORM public.restore_voided_dine_in_order_to_table(v_order.id);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_successor_order_after_payment_void() IS
  'Tras anular un pago, reabre la misma orden (mismo número) para re-cobro. Ya no crea orden sucesora.';

NOTIFY pgrst, 'reload schema';
