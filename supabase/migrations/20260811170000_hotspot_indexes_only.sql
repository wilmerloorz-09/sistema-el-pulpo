-- =============================================================================
-- Rendimiento seguro: SOLO indices (sin tocar funciones RPC)
-- =============================================================================
-- Idempotente: CREATE INDEX IF NOT EXISTS.
-- No modifica dispatch_order_quantities, register_payment_with_items ni sync.
-- Seguro bajo carga; puede tardar unos segundos en Free Nano al crear.
-- =============================================================================

-- Gate / turno: usuario en cash_shift_users
CREATE INDEX IF NOT EXISTS idx_cash_shift_users_shift_user
  ON public.cash_shift_users USING btree (shift_id, user_id);

CREATE INDEX IF NOT EXISTS idx_cash_shift_users_shift_caja_enabled
  ON public.cash_shift_users USING btree (shift_id)
  WHERE is_enabled IS TRUE AND can_use_caja IS TRUE;

-- Eventos operativos APPLIED (snapshot / recompute / despacho)
CREATE INDEX IF NOT EXISTS idx_order_ready_events_order_applied
  ON public.order_ready_events USING btree (order_id, created_at DESC)
  WHERE status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_order_dispatch_events_order_applied
  ON public.order_dispatch_events USING btree (order_id, created_at DESC)
  WHERE status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_order_cancellations_order_applied
  ON public.order_cancellations USING btree (order_id)
  WHERE status = 'APPLIED';

-- Joins item -> evento (snapshot batch / unitario)
CREATE INDEX IF NOT EXISTS idx_order_item_ready_events_ready_event_id
  ON public.order_item_ready_events USING btree (order_ready_event_id);

CREATE INDEX IF NOT EXISTS idx_order_item_dispatch_events_dispatch_event_id
  ON public.order_item_dispatch_events USING btree (order_dispatch_event_id);

CREATE INDEX IF NOT EXISTS idx_order_item_cancellations_cancellation_id
  ON public.order_item_cancellations USING btree (order_cancellation_id);

-- Compact / mesas: ordenes DINE_IN activas por mesa
CREATE INDEX IF NOT EXISTS idx_orders_table_active_position
  ON public.orders USING btree (table_id, table_order_position NULLS LAST, created_at, id)
  WHERE order_type = 'DINE_IN'
    AND table_id IS NOT NULL
    AND status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

-- Listados / cobro: items por orden + estado
CREATE INDEX IF NOT EXISTS idx_order_items_order_id_status
  ON public.order_items USING btree (order_id, status);

-- Pagos por orden + status (voided/active)
CREATE INDEX IF NOT EXISTS idx_payments_order_id_status
  ON public.payments USING btree (order_id, status);
