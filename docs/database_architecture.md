# Database Architecture

## Resumen
- Motor: PostgreSQL sobre Supabase.
- PKs tecnicas: UUID.
- Identificadores operativos legibles:
  - `orders.order_number`
  - `orders.order_code`
  - codigos visibles auxiliares donde aplique

## Dominios principales

### 1. Identidad y acceso
- `profiles`
- `user_branches`
- `user_branch_roles`
- `user_branch_modules`
- `cash_shift_users`
- `webauthn_credentials`
- `webauthn_challenges`

### 2. Catalogo
- Modelo principal:
  - `menu_nodes`
  - `menu_node_modifiers`
  - `bulk_included_products`
  - `bulk_included_product_ranges`
- Modelo legacy aun activo:
  - `categories`
  - `subcategories`
  - `products`
  - `subcategory_modifiers`
  - `modifiers`

### 3. Operacion de ordenes
- `orders`
- `order_items`
- `order_item_modifiers`
- `order_cancellations`
- `order_item_cancellations`
- `order_ready_events`
- `order_item_ready_events`
- `order_dispatch_events`
- `order_item_dispatch_events`
- `order_ready_notifications`

### 4. Mesas
- `restaurant_tables`
- `table_splits`
- `orders.table_order_position`
- `orders.table_name_snapshot`
- `branches.reference_table_count`
- `cash_shifts.active_tables_count`

### 5. Caja y pagos
- `cash_shifts`
- `cash_shift_denoms`
- `cash_register_openings`
- `cash_register_movements`
- `cash_movements`
- `payments`
- `payment_items`
- `payment_void_requests`
- `cash_register_templates`
- `cash_register_template_denoms`

### 6. Comprobantes de transferencia
- `payment_capture_requests`
- `payment_proofs`

## Reglas vigentes por area

### Catalogo y venta
- `menu_nodes` define la estructura visible del menu.
- `order_items.product_id` sigue dependiendo de `products(id)`.
- `legacy_product_id` en `menu_nodes` sigue siendo parte del puente hacia legacy.
- `manual_price_enabled` se resuelve desde `menu_nodes`.
- `BULK` puede operar con `price = NULL` y reglas de entrega en tablas auxiliares.

### Ordenes
- `orders.menu_scope` conserva el arbol visual usado por la orden.
- `orders.is_special` y `orders.special_total_manual` modelan `Orden Especial`.
- `orders.is_tray_order` sigue modelando `Orden Bandeja`.
- `order_items.tray_item_type` sigue distinguiendo `A/B/C`.
- `get_order_operational_snapshot(...)` sigue siendo la lectura principal de cantidades operativas.

### Mesas / Unir / Dividir
- `orders.table_order_position` es la base vigente para ordenar visualmente las cuentas activas dentro de una mesa.
- `table_splits` sigue existiendo, pero ya no es la fuente principal de numeracion/orden de tabs activos tras el rework de 2026-04-12.
- `orders.table_name_snapshot` conserva el nombre de la mesa cuando una orden se desacopla de `table_id`.
- `move_dine_in_order_items_between_orders(...)` es la RPC actual para mover items entre ordenes `DINE_IN`.
- Reglas de esa RPC:
  - ambas ordenes deben ser `DINE_IN`
  - no pueden ser especiales
  - deben pertenecer a la misma sucursal
  - solo mueve cantidad operativamente disponible
  - desde la version actual, no mueve cantidad ya comprometida por pago
  - preserva y redistribuye `order_item_ready_events` y `order_item_dispatch_events`
  - si la orden destino sale de borrador operativo, puede asignar `order_number` y `order_code`

### Caja
- `cash_shifts` representa el turno operativo.
- `cash_register_openings` representa historial real de aperturas/cierres/anulaciones de caja.
- `cash_shift_denoms.qty_current` es la fuente real de composicion actual de caja.
- `cash_register_templates` y `cash_register_template_denoms` guardan composiciones predefinidas de apertura.
- Regla importante vigente:
  - cerrar caja y cerrar turno ya no son la misma operacion
  - `close_cash_register(...)` puede cerrar la caja del turno sin exigir cierre del turno

### Anulacion de pagos
- `payment_void_requests` concentra la solicitud y el ciclo de autorizacion/ejecucion.
- Campos nuevos relevantes:
  - `payment_item_selections jsonb`
  - `refund_amount`
  - `cash_refund_detail jsonb`
  - `replacement_payment_id`
- `payments` conserva el resultado:
  - `status = 'voided'` cuando aplica
  - notas/marcadores de auditoria (`VOID_REQUESTED`, `VOIDED`, etc.)
- La anulacion parcial genera un `replacement_payment_id` para la parte que sigue activa.
- Las devoluciones en efectivo disminuyen `cash_shift_denoms.qty_current` y registran `cash_movements`.

### Comprobantes
- `payment_capture_requests` usa `secure_token` y estados de ciclo de captura.
- `payment_proofs` guarda metadata de archivo y campos OCR:
  - `ocr_text`
  - `analysis_status`
  - `detected_amount`
  - `amount_matches_expected`
  - `analysis_summary`
  - `analysis_error_code`
  - `analysis_ran_at`

## RPCs y funciones clave

### Catalogo / ordenes
- `create_dine_in_order(...)`
- `add_dine_in_order_item(...)`
- `submit_order_draft_items(...)`
- `convert_order_to_special(...)`
- `get_order_operational_snapshot(...)`

### Mesas
- `get_branch_tables_overview(...)`
- `move_dine_in_order_to_table(...)`
- `move_dine_in_order_items_between_orders(...)`
- `create_additional_dine_in_order(...)`
- `delete_dine_in_table_order(...)`
- `compact_table_order_positions(...)`

### Caja
- `open_cash_register(...)`
- `close_cash_register(...)`
- `anular_apertura_caja(...)`
- `list_cash_register_openings(...)`
- `registrar_movimiento_caja(...)`
- `list_cash_register_movements(...)`

### Anulacion de pagos
- `can_void_payment(...)`
- `request_void_payment(...)`
- `approve_and_void_payment(...)`
- `recalculate_check_balance(...)`
- `sync_order_payment_state(...)`
- Edge Function relacionada:
  - `void-payment`

### Comprobantes
- RPCs/funciones SQL para `payment_capture_requests` y su limpieza operativa
- backend externo `proof_capture_backend`

## Migraciones relevantes del estado actual

### Base catalogo / turnos / menus
- `20260312110000_add_menu_nodes_tree.sql`
- `20260313143000_move_modifier_assignments_to_menu_nodes.sql`
- `20260315090000_branch_reference_tables_and_shift_active_count.sql`
- `20260323213000_dual_menu_trees_table_takeout.sql`
- `20260326190000_add_manual_price_enabled_to_menu_nodes.sql`
- `20260329134000_add_bulk_included_products.sql`

### Caja / apertura / movimientos
- `20260317124500_cash_register_opening_annulment.sql`
- `20260317133000_cash_register_movements.sql`
- `20260317143000_apply_cash_register_movement_to_denoms.sql`
- `20260404153000_require_capture_user_on_cash_open.sql`
- `20260410190000_cash_register_templates.sql`
- `20260411100000_allow_cash_close_with_pending_orders.sql`
- `20260411103000_allow_reopen_cash_register_in_open_shift.sql`

### Pagos y anulaciones
- `20260409170000_secure_payment_void_same_shift_supervisor.sql`
- `20260409213000_fix_voided_payment_reopens_order_state.sql`
- `20260409220000_restore_voided_dine_in_to_table_splits.sql`
- `20260410180000_unassign_table_on_voided_payment.sql`
- `20260411113000_block_void_payments_from_closed_openings.sql`
- `20260411130000_single_void_per_order.sql`
- `20260411143000_fix_partial_paid_dine_in_order_state.sql`
- `20260411161500_partial_void_payment_with_cash_refund_breakdown.sql`
- `20260411173000_allow_approved_void_after_pending_request.sql`
- `20260411190000_fix_shift_id_ambiguity_in_approve_and_void_payment.sql`
- `20260411200000_allow_self_authorized_void_for_admins_and_supervisors.sql`

### Unir / Dividir entre ordenes
- `20260411213000_move_dine_in_order_items_between_orders.sql`
- `20260411223000_allow_move_of_unpaid_remaining_item_quantity.sql`
- `20260411233000_assign_order_number_when_move_creates_operational_destination.sql`
- `20260412103000_rework_table_orders_without_splits.sql`

### Comprobantes
- `20260404170000_add_payment_proof_capture_tables.sql`
- `proof_capture_backend/alembic/versions/20260404_000001_payment_proofs.py`
- `proof_capture_backend/alembic/versions/20260405_000002_payment_proof_analysis_fields.py`

## Reglas de integridad
1. No asumir que `menu_nodes` ya reemplazo la FK de `order_items.product_id`.
2. No confundir cierre de caja con cierre de turno.
3. Si se toca anulacion de pagos, revisar consistencia entre:
   - `payments`
   - `payment_items`
   - `payment_void_requests`
   - `cash_shift_denoms`
   - `cash_movements`
   - estado de `orders` / `table_splits`
4. Si se toca `Unir/Dividir`, no romper:
   - cantidades pagadas
   - historial `READY`
   - historial `DISPATCHED`
   - numeracion operativa de la orden destino
5. Los resets SQL limpian metadata de comprobantes, pero no Storage; el bucket `payment-proofs` se limpia aparte.
