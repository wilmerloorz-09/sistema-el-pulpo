# Database Architecture

## Resumen
- Motor: PostgreSQL sobre Supabase.
- PKs tecnicas: UUID.
- Identificadores operativos legibles:
  - `orders.order_number`
  - `orders.order_code`

## Dominios principales

### 1. Identidad y acceso
- `profiles`
- `user_branches`
- `user_branch_roles`
- `user_branch_modules`
- `modules` / `role_permissions`
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
- En `Orden Especial`, `special_total_manual` es el valor manual visible/cobrable. No asumir que coincide con `orders.total` ni con `sum(order_items.total)`.
- Las ordenes especiales con `status = 'PAID'` deben considerarse pagadas aunque el detalle de cobro por item no exista o no represente cantidades visibles en `payment_items`.
- `orders.is_tray_order` sigue modelando `Orden Bandeja`.
- `order_items.tray_item_type` distingue `A/B/C`.
- `get_order_operational_snapshot(...)` sigue siendo la lectura principal de cantidades operativas.
- `orders.locked_for_editing` modela exclusividad transaccional para `Editar Orden`.
- La anulacion pendiente por item/orden usa dos marcas complementarias:
  - `orders.cancel_requested_at` / `orders.cancel_requested_by`
  - cabecera en `order_cancellations` con `status = 'VOIDED'` y `notes` tipo `[PENDING_REQUEST] ...`

### Mesas / Unir / Dividir
- `orders.table_order_position` es la base vigente para ordenar visualmente las cuentas activas.
- `table_splits` sigue existiendo, pero ya no es la fuente principal de numeracion visible.
- `orders.table_name_snapshot` conserva el nombre de la mesa cuando una orden se desacopla de `table_id`.
- `get_branch_tables_overview(...)` ignora borradores vacios al calcular ocupacion operativa.
- `move_dine_in_order_items_between_orders(...)` es la RPC actual para mover items entre ordenes `DINE_IN`.

### Caja
- `cash_shifts` representa el turno operativo.
- `turno` es modulo propio para administrar apertura, cierre y configuracion de turno.
- El rol `supervisor` por defecto conserva `turno: MANAGE` y ya no debe heredar `admin_sucursal`.
- `can_manage_shift_admin(p_user_id, p_branch_id)` es la funcion comun para permisos de Turno:
  - global admin
  - `turno: MANAGE`
  - `admin_sucursal: MANAGE`
  - `admin_global: MANAGE`
- Las policies/RPCs de Turno deben apoyarse en `can_manage_shift_admin(...)`, no solo en `can_manage_branch_admin(...)`.
- `cash_register_openings` representa historial real de aperturas, cierres y anulaciones de caja.
- `cash_shift_denoms.qty_current` es la fuente real de composicion actual de caja.
- `cash_register_templates` y `cash_register_template_denoms` guardan composiciones predefinidas de apertura.
- `cash_shift_users.can_use_caja` representa el usuario con permiso de cajero dentro del turno. En turno abierto, cambiar ese usuario requiere confirmacion de frontend con la contrasena del usuario autenticado que realiza el cambio.
- Cerrar caja y cerrar turno no son la misma operacion.
- `close_cash_shift_with_tables(...)` sigue siendo el cierre final del turno. Antes de llamarlo desde UI, `Admin > Turno` puede resolver ordenes especiales pendientes con valor `$0` mediante confirmacion explicita, marcandolas `PAID`.
- Para ese flujo, solo cuentan como bloqueantes las ordenes especiales `$0` en estados:
  - `SENT_TO_KITCHEN`
  - `READY`
  - `KITCHEN_DISPATCHED` con `paid_at IS NULL`
- Los reportes por apertura deben reconstruirse desde:
  - `cash_register_openings.opened_at`
  - `cash_register_openings.closed_at`
  - pagos dentro de ese rango
  - movimientos dentro de ese rango
  - `cash_shift_denoms.qty_current` para el detalle de cierre

### Anulacion de pagos
- `payment_void_requests` concentra la solicitud y el ciclo de autorizacion/ejecucion.
- Campos relevantes:
  - `payment_item_selections`
  - `refund_amount`
  - `cash_refund_detail`
  - `replacement_payment_id`
- La anulacion parcial genera un `replacement_payment_id` para la parte que sigue activa.
- Las devoluciones en efectivo disminuyen `cash_shift_denoms.qty_current` y registran `cash_movements`.

### Comprobantes
- `payment_capture_requests` usa `secure_token` y estados de ciclo de captura.
- `payment_proofs` guarda metadata de archivo y campos OCR.

## RPCs y funciones clave

### Catalogo / ordenes
- `create_dine_in_order(...)`
- `add_dine_in_order_item(...)`
- `submit_order_draft_items(...)`
- `convert_order_to_special(...)`
- `get_order_operational_snapshot(...)`
- `create_pending_order_cancellation_request(...)`
- `request_order_cancellation(...)`
- `clear_pending_order_cancellation_request(...)`
- `list_pending_order_cancellation_requests(...)`
- `dispatch_order_quantities(...)`

### Mesas
- `get_branch_tables_overview(...)`
- `move_dine_in_order_to_table(...)`
- `move_dine_in_order_items_between_orders(...)`
- `create_additional_dine_in_order(...)`
- `delete_dine_in_table_order(...)`
- `compact_table_order_positions(...)`

### Caja
- `can_manage_shift_admin(...)`
- `list_shift_users_for_branch(...)`
- `get_user_open_shift_conflict(...)`
- `open_cash_shift_with_tables(...)`
- `close_cash_shift_with_tables(...)`
- `configure_shift_active_tables(...)`
- `list_branch_cancel_policy_nodes(...)`
- `save_branch_cancel_policy(...)`
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
- `20260426143000_harden_shift_user_capability_check_for_stale_clients.sql`
- `20260426150000_supervisor_turno_only_access.sql`
- `20260426151500_allow_turno_users_to_view_cash_shifts.sql`
- `20260426153000_allow_turno_users_to_list_cancel_policy_nodes.sql`

### Pagos y anulaciones
- `20260409170000_secure_payment_void_same_shift_supervisor.sql`
- `20260409213000_fix_voided_payment_reopens_order_state.sql`
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
- `20260414123000_ignore_empty_draft_orders_in_tables_overview.sql`
- `20260414133000_align_additional_table_order_permissions_with_shift_gate.sql`
- `20260414143000_align_delete_table_order_permissions_with_shift_gate.sql`
- `20260418130000_list_pending_order_cancellation_requests.sql`
- `20260418143000_align_pending_cancellation_request_visibility.sql`
- `20260418213017_guard_add_dine_in_order_item_null_menu_node.sql`

## Reglas de integridad
1. No asumir que `menu_nodes` ya reemplazo la FK de `order_items.product_id`.
2. No confundir cierre de caja con cierre de turno.
3. Si se toca anulacion de pagos, revisar consistencia entre `payments`, `payment_items`, `payment_void_requests`, `cash_shift_denoms`, `cash_movements` y estado de `orders`.
4. Si se toca `Unir/Dividir`, no romper cantidades pagadas, historial `READY` / `DISPATCHED` ni numeracion operativa.
5. Si se toca `Editar Orden`, revisar consistencia entre `orders.locked_for_editing`, anulaciones resultantes y despacho directo de items nuevos.
6. Los resets SQL limpian metadata de comprobantes, pero no Storage; el bucket `payment-proofs` se limpia aparte.
7. No reintroducir `admin_sucursal` al supervisor por defecto para resolver acceso a Turno; corregir la RPC/policy para usar `can_manage_shift_admin(...)`.
8. Si se toca `cash_shift_users.can_use_caja`, mantener la regla de un cajero activo por turno y la confirmacion de cambio en turno abierto.
