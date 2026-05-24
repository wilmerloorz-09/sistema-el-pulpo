# Database Architecture

## Resumen
- Motor: PostgreSQL sobre Supabase.
- PKs tecnicas: UUID.
- Identificadores operativos legibles:
  - `orders.order_number`
  - `orders.order_code`

## Regla canonica de estados operativos
- `DRAFT`: borrador con al menos un item agregado y no enviado a Caja.
- `SENT_TO_KITCHEN`: En Caja; `submit_order_draft_items(...)` genera `order_code` / `order_number` y deja la orden cobrable.
- `PAID`: Pagada; `sync_order_payment_state_internal(...)` debe usar este estado cuando Caja cubre la orden completa.
- `KITCHEN_DISPATCHED`: Despachada; `dispatch_order_quantities(...)` solo puede ejecutarse sobre ordenes `PAID`.
- `CANCELLED`: anulada o historica. Las historicas por anulacion de pago con `VOID_SUCCESSOR_ORDER` nunca deben volver a `SENT_TO_KITCHEN`, `PAID` ni `KITCHEN_DISPATCHED`.
- `PAID` y `KITCHEN_DISPATCHED` son estados finales visibles mutuamente excluyentes para clasificacion; una orden no debe aparecer en ambas pestanas.
- Para clasificacion visual, `Despachada` incluye cabecera `KITCHEN_DISPATCHED` y tambien cabecera `PAID` con despacho aplicado (`order_dispatch_events.status = 'APPLIED'`) mientras la sincronizacion final de cabecera no haya corrido.
- Las lecturas de `Despacho` deben agrupar por `orders.id` / `order_code`; `order_items.sent_to_kitchen_at` no debe crear tarjetas operativas separadas para la misma orden.
- En Despacho, `TAKEOUT`, `EXPRESS` (pestaña unificada **Para llevar / Express**) y `orders.is_special = true` se procesan como despacho total de la orden; no deben dividirse por botones de item en la UI.
- Las ordenes `EXTRA` pagadas se agrupan en pestañas **Mesa** y **Todos**; el listado no exige `sent_to_kitchen_at` en lineas Extra (a diferencia de mesa clasica).
- Cuando se anula un pago, la sucesora activa queda con nuevo numero en `SENT_TO_KITCHEN`/En Caja.

## Dominios principales

### 0. Sucursales
- `branches`
- `branches.workflow_mode`: compatibilidad interna forzada a `CASH_THEN_DISPATCH`; el CRUD de sucursales no expone flujo.

### 1. Identidad y acceso
- `profiles`
  - `first_name`: nombres, campo visible principal del sistema.
  - `last_name`: apellidos, usado en administracion/busqueda.
  - `full_name`: compatibilidad legacy; debe reflejar `first_name` por `sync_profile_full_name()`.
- `user_branches`
- `user_branch_roles`
- `user_branch_modules`
- `cash_shift_users`
  - capacidades operativas por turno (`can_serve_tables`, `can_use_caja`, etc.)
  - `secondary_caja_takeout_enabled`: cajero secundario puede cobrar sus TAKEOUT.
  - `secondary_caja_express_enabled`: cajero secundario puede cobrar sus EXPRESS despachadas.
// Removed WebAuthn tables from active operation


### 2. Catalogo
- Modelo principal:
  - `menu_nodes` (alcances: `TABLE`, `TAKEOUT`, `BULK`; opcional `EXTRA` en BD para arbol dedicado)
  - `menu_node_modifiers`
  - `bulk_included_products`
  - `bulk_included_product_ranges`
  - `extra_frequent_products` (accesos rapidos por sucursal y contexto)
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

### 4. Mesas y órdenes
- `restaurant_tables`
- `table_splits` (legacy)
- `orders.table_order_position` (fuente actual para orden visual de cuentas)
- `orders.table_name_snapshot`
- `branches.reference_table_count`
- `cash_shifts.active_tables_count`

### 5. Caja y pagos
- `cash_shifts`
  - `max_caja_sessions`: cupo de usuarios/terminales Caja habilitados simultaneos en el turno (1–10).
  - `caja_status`: resumen agregado del turno (alguna apertura abierta/cerrada); no sustituye el estado por cajero en UI.
  - `primary_cashier_id`: cajero de la caja principal del turno.
  - `secondary_cajas_enabled`, `secondary_caja_template_id`: cajas secundarias y plantilla de arqueo inicial.
- `denominations`: catalogo global de tipos de moneda/billete activos (`is_active`); **independiente** de la plantilla de apertura.
- `cash_shift_denoms`
  - `cashier_id`, `opening_id`: particion por cajero y apertura dentro del turno.
  - indice unico: `(shift_id, cashier_id, denomination_id)` cuando `cashier_id` no es null.
  - refleja inventario/arqueo del cajero; al cobrar, `PAYMENT_IN` puede **crear** fila con `qty_initial = 0` si el cliente entrega una denominacion no incluida en la plantilla.
- `cash_register_openings`
  - una fila `abierta` maxima por `(shift_id, cashier_id)`.
  - `register_role`: `primary` | `secondary` | `standard` (legacy).
- `cash_register_movements`
- `cash_movements`
- `payments`
- `payment_items`
- `payment_void_requests`
- `cash_register_templates`
- `cash_register_template_denoms`

#### Sincronización de estado de orden tras pagos (`payment_items`)
- `sync_order_payment_state_internal(order_id)` recalcula cabecera y pagos de la orden.
- Los triggers `trg_sync_order_payment_state_on_payments` (por fila en `payments`) y los de `payment_items` deben invocar esa lógica cuando cambian cobros.
- **Migración `20260509180000_payment_items_sync_once_per_statement.sql`:** los triggers sobre `payment_items` pasan a ser **AFTER INSERT/UPDATE/DELETE … FOR EACH STATEMENT** con tablas de transición (`REFERENCING NEW TABLE` / `OLD TABLE`), de modo que un **único** `INSERT` por lotes de muchas filas dispara **una** pasada de sincronización por `order_id` afectado, en lugar de N pasadas (una por fila). Esto es crítico para latencia de cobro en POS.
- El cliente **no** debe depender de llamar `sync_order_payment_state(...)` inmediatamente después de cada cobro si los triggers ya cubren el caso; evita trabajo duplicado.

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
- `orders.created_by` es la fuente del usuario que genero la orden y debe acompañar las lecturas operativas visibles.
- Para mostrar el nombre, resolver contra `profiles.first_name`, luego `profiles.full_name`, luego `profiles.username`, luego `profiles.email`, con fallback `Usuario`.
- `orders.menu_scope` conserva el arbol visual usado por la orden.
- `orders.is_special` y `orders.special_total_manual` modelan `Orden Especial`.
- En `Orden Especial`, `special_total_manual` es el valor manual visible/cobrable. No asumir que coincide con `orders.total` ni con `sum(order_items.total)`.
- Las ordenes especiales con `status = 'PAID'` deben considerarse pagadas aunque el detalle de cobro por item no exista o no represente cantidades visibles en `payment_items`.
- `orders.is_tray_order` sigue modelando `Orden Bandeja`.
- `order_items.tray_item_type` distingue `A/B/C`.
- `get_order_operational_snapshot(...)` sigue siendo la lectura principal de cantidades operativas en pantallas que clasifican despachos y listos (Cocina, Despacho, listados complejos).
- En el **cobro en caja** (`useCaja.payOrder`), con flujo global `CASH_THEN_DISPATCH`, la validación de cantidad cobrable puede basarse en `order_items` + cancelaciones aplicadas (`order_item_cancellations` / `order_cancellations`) **sin** llamar a `get_order_operational_snapshot` por orden, reduciendo latencia; no extrapolar esa simplificación a otros módulos sin revisar reglas de despacho.
- `orders.locked_for_editing` modela exclusividad transaccional para `Editar Orden`. Impide el cobro en Caja mientras la orden está siendo modificada.
- `submit_order_draft_items(...)` debe dejar cualquier orden enviada en estado cobrable por Caja antes de Despacho.
- `sync_order_payment_state_internal(...)` debe considerar toda orden como cobrable por cantidad ordenada activa antes de despacho.
- Los nuevos ítems añadidos durante una edición de una orden "En caja" se marcan para seguir el flujo de cobro correcto.
- La clasificacion visible del modulo `Ordenes` debe derivarse de `orders`, `order_items`, pagos activos y snapshot/eventos operativos:
  - `Borrador`: items activos agregados y no enviados a Caja. Las ordenes sin `order_code` / `order_number` deben permanecer en esta clasificacion mientras tengan items activos no pagados ni anulados.
  - `En Caja`: `orders.status IN ('SENT_TO_KITCHEN', 'READY')`, con `order_code` / `order_number`, items no `DRAFT` y saldo/cantidad pendiente de cobro. Excluir ordenes pagadas completas.
  - `Pagada`: cabecera `PAID` sin despacho aplicado visible; es el unico estado elegible para `Despacho`.
  - `Despachada`: cabecera `KITCHEN_DISPATCHED` o cabecera `PAID` con evento aplicado de despacho.
  - `Anulada`: `CANCELLED` e historicas con marcadores de anulacion.
- `Pendiente de anulacion` no es pestana principal de `Ordenes`; se determina por `orders.cancel_requested_at` y/o cabecera `[PENDING_REQUEST]` en `order_cancellations`.
- La anulacion pendiente por item/orden usa dos marcas complementarias:
  - `orders.cancel_requested_at` / `orders.cancel_requested_by`
  - cabecera en `order_cancellations` con `status = 'VOIDED'` y `notes` tipo `[PENDING_REQUEST] ...`
- La eliminacion completa de orden desde mesa/orden activa solo puede aplicarse si todos los items estan en `DRAFT` o en estado operativo `En caja`.
- Si la orden mezcla items `DRAFT` y `En caja`, los `DRAFT` se eliminan como borrador y los enviados se anulan por cantidades operativas.
- Esta acción se unifica en la UI para evitar duplicados, resolviendo internamente si se borra el borrador o se anula la orden enviada.
- No se permite esa eliminacion si hay items despachados, pagados o con solicitud de anulacion pendiente.
- **Regla de Agrupamiento:** Las consultas que alimentan `OrderItemsList` y `PayableOrdersList` deben permitir la consolidación lógica en el cliente por `description_snapshot` y `unit_price`.
- **Acceso Operativo:** La visibilidad del botón "Editar orden" y la búsqueda en el módulo de Órdenes se extiende a perfiles con `can_operate_orders` activo en el turno.
- El cálculo de cambio en el cobro debe centralizarse para evitar discrepancias entre distintos métodos de pago.

### Mesas / Múltiples órdenes
- `orders.table_order_position` es la base vigente para ordenar visualmente las cuentas activas.
- El concepto de "divisiones" (`table_splits`) queda como soporte legacy; cada cuenta es una orden independiente vinculada a la mesa.
- `orders.table_name_snapshot` conserva el nombre de la mesa cuando una orden se desacopla de `table_id`.
- `get_branch_tables_overview(...)` ignora borradores vacios al calcular ocupacion operativa.
- `get_branch_tables_overview(...)` debe mantener ordenes `PAID` como ocupacion visible de mesa hasta que pasen a `KITCHEN_DISPATCHED`; pagar no libera la mesa.
- En vistas activas, el nombre de mesa debe resolverse desde `restaurant_tables.name` cuando `orders.table_id` existe; `orders.table_name_snapshot` es fallback historico.
- `move_dine_in_order_items_between_orders(...)` es la RPC actual para mover items entre órdenes de mesa.
- **Gestión de Mesas con Pagos Anulados (2026-05-09):** Las mesas con pagos anulados mantienen su estado de ocupación. El sistema garantiza que la orden original (histórica) no bloquee el re-cobro de la nueva orden sucesora.

### Caja
- `cash_shifts` representa el turno operativo.
- `cash_shifts.opened_at` es la fecha/hora de apertura del turno y se presenta en `Admin > Turno` mientras el turno esta `OPEN`.
- `cash_register_openings` representa historial real de aperturas, cierres y anulaciones **por cajero** dentro del turno.
- `cash_shift_denoms.qty_current` es la fuente real de composicion actual de caja **del cajero** (filtrar por `cashier_id` en RPCs y cliente).
- Varios cajeros pueden tener aperturas `abierta` en paralelo en el mismo `shift_id`.
- `get_user_caja_status(shift_id, user_id)` devuelve `UNOPENED` | `OPEN` | `CLOSED` segun la ultima apertura de ese cajero.
- `get_my_branch_shift_gate` expone ese estado en `caja_status` para el usuario autenticado. **No hacer DROP** de esta funcion en migraciones: politicas RLS de cancelaciones dependen de ella; usar solo `CREATE OR REPLACE` con la misma firma `RETURNS TABLE`.
- **Administrador general:** `set_my_active_branch` y `get_my_access_context` (`20260524120000_global_admin_free_branch_switch.sql`) permiten fijar cualquier sucursal activa sin redireccion por turno ni auto-reasignacion al refrescar contexto.
- `open_cash_register` retorna `uuid` (id de apertura). Si cambia el tipo de retorno, ejecutar antes `DROP FUNCTION open_cash_register(uuid, uuid, uuid, jsonb)`.
- `internal_open_cash_register_for_cashier(...)` abre caja secundaria al configurar turno; con plantilla inserta cantidades del template; el cobro no debe limitarse a esas filas en UI.
- `apply_shift_caja_configuration(..., p_secondary_caja_config jsonb)` persiste principal, secundarios, flags takeout/express y abre cajas secundarias.
- `open_cash_shift_with_tables(..., p_secondary_caja_config jsonb)` reenvia config secundaria a apply.
- `auto_finalize_extra_order_after_payment(p_order_id uuid)`
- `registrar_movimiento_caja_operativo`: movimientos `PAYMENT_IN` / `CHANGE_OUT` filtran por `shift_id`, `cashier_id = auth.uid()` y `denomination_id`. Si `PAYMENT_IN` no encuentra fila, inserta con apertura abierta del cajero y luego suma `qty_current`.
- `annul_cash_opening(p_opening_id, ...)` anula una apertura y borra solo sus `cash_shift_denoms` (no las de otros cajeros).
- `Pagos del turno` debe filtrar por el rango real de `cash_shifts.opened_at` a `cash_shifts.closed_at`/`now()`, no por inicio del dia calendario.
- `cash_register_templates` y `cash_register_template_denoms` guardan composiciones predefinidas de apertura.
- `cash_shift_users.can_double_session` habilita una segunda sesion de app solo para usuarios de caja en turno abierto.
- Las sesiones de app se registran en `profiles.current_app_session_id` y, cuando aplica doble sesion, en `profiles.current_app_secondary_session_id` con timestamp/dispositivo auxiliar.
- Cerrar caja y cerrar turno no son la misma operacion.
- La cantidad cobrable sale de la cantidad ordenada activa antes de despacho para mesa y para llevar; orden especial cobra su valor activo configurado.
- `close_cash_shift_with_tables(...)` sigue siendo el cierre final del turno. Antes de llamarlo desde UI, `Admin > Turno` puede resolver ordenes especiales pendientes con valor `$0` mediante confirmacion explicita, marcandolas `PAID`.
- Antes de cerrar turno, `cancel_empty_draft_orders_for_branch(...)` cancela borradores no enviados sin cobros ni items operativos.
- `list_branch_closure_blocking_orders(...)` solo debe reportar `DRAFT` como bloqueante si tiene pagos o items no `DRAFT`.
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
- **Integridad Financiera (2026-05-09):**
  - Todas las operaciones de cobro y movimiento de efectivo están vinculadas a un registro activo en `cash_shift_denoms`.
  - La anulación operativa de pagos solo aplica sobre ordenes `PAID` que aun no esten `KITCHEN_DISPATCHED`.
  - Se exige redondeo a 2 decimales en toda sumatoria de `payment_items` y `cash_movements` para garantizar el "Cuadre de caja".
  - Los ítems cancelados (`status = 'VOIDED'`) se excluyen de los cálculos de saldo de la orden en tiempo real.

### Anulacion de pagos
- `payment_void_requests` concentra la solicitud y el ciclo de autorizacion/ejecucion.
- Campos relevantes:
  - `payment_item_selections`
  - `refund_amount`
  - `cash_refund_detail`
  - `replacement_payment_id`
- La anulacion parcial genera un `replacement_payment_id` para la parte que sigue activa.
- **Trazabilidad de Anulación (2026-05-09):**
  - Cada anulación de pago (parcial o total) inserta un registro en `order_cancellations` (tipo `partial` para pagos).
  - Se actualiza `orders.notes` con un marcador de rastro `VOIDED_PAYMENT`, el ID del supervisor y el motivo de la anulación.
- Las devoluciones en efectivo disminuyen `cash_shift_denoms.qty_current` y registran `cash_movements`.
- Al anular un pago, la orden original conserva `order_code` / `order_number` y queda como historica:
  - `orders.status = 'CANCELLED'`
  - `orders.table_id`, `split_id`, `table_order_position` en `NULL`
  - `orders.paid_at = NULL`
  - `orders.cancelled_at` definido
  - `orders.notes` incluye `VOID_SUCCESSOR_ORDER:<new_order_id>` y `VOIDED_PAYMENT_HISTORICAL:<payment_id>`
- La orden activa se recrea como sucesora:
  - nuevo `order_code` / `order_number`
  - `orders.notes` incluye `SUCCESSOR_OF_VOIDED_ORDER:<old_order_id>`
  - recibe items/modificadores y pagos activos no anulados.
- `recalculate_check_balance(...)` debe revisar `VOID_SUCCESSOR_ORDER` antes de invocar sincronizaciones que puedan recalcular estado, para no revivir historicas anuladas.
- La anulacion operativa de pago solo debe proceder para ordenes `PAID` que aun no esten `KITCHEN_DISPATCHED`.

### Express (`order_type = EXPRESS`)
- Enum `order_type` incluye `EXPRESS` (migracion `20260516000000_add_express_order_type.sql`).
- Flujo: borrador -> envio a despacho (`SENT_TO_KITCHEN` / En despacho) -> despacho total -> `KITCHEN_DISPATCHED` -> cobro total en Caja -> `PAID`.
- `orderIsPayableInCaja` en cliente solo incluye Express en `KITCHEN_DISPATCHED`.
- `dispatch_config.takeout_enabled` y/o `dispatch_config.express_enabled` habilitan la pestaña unificada **Para llevar / Express** en Despacho (una sola pestaña para ambos tipos).
- RPC `create_express_order(...)` crea la orden ligada al turno abierto.

### Productos frecuentes
- Tabla `extra_frequent_products`:
  - `branch_id`, `menu_node_id`, `context`, `display_order`, `created_at`
  - `context` ∈ `MESA`, `TAKEOUT`, `EXPRESS`, `EXTRA`
  - unique `(branch_id, context, menu_node_id)` y `(branch_id, context, display_order)`
  - sin limite de cantidad (el check `display_order <= 10` fue eliminado en `20260531140000`)
- RLS: SELECT usuarios con `active_branch_id`; INSERT/UPDATE/DELETE admins de sucursal.
- Reordenar en cliente: fase staging con `display_order` alto (≥ 100001) antes de asignar orden final 1..N (respeta check `display_order >= 1`).

### Extra (`order_type = EXTRA`)
- Enum `order_type` incluye `EXTRA` (migracion `20260527120000_add_extra_order_type.sql`).
- Sin `table_id`; `menu_scope = TABLE` sin categoria PLATOS.
- Flujo: borrador -> envio a caja -> pago (`PAID`) -> despacho manual -> cierre.
- Tras pago total, `sync_order_payment_state_internal` **no** invoca `auto_finalize_extra_order_after_payment` (`20260602120000_extra_flow_like_table_orders.sql`). La funcion legacy puede existir en BD pero queda fuera del sync de pagos.
- Despacho: ordenes `EXTRA` en `PAID` aparecen en pestañas Mesa/Todos del modulo Despacho; asignacion SPLIT las trata como `TABLE`.
- Cierre operativo desde UI Extra: `close_extra_order(p_order_id)` (`20260602130000_close_extra_order.sql`) cuando la orden esta despachada y sin `closed_at`.

### Monitoreo Global
- `profiles.current_app_session_id`, `cash_shifts`, `cash_shift_users`, y `orders` son monitoreados vía subscripción en tiempo real (`supabase_realtime`) por el modulo `/admin/monitoreo-global`.
- El Administrador general tiene vista global de turnos sin importar la sucursal, requiriendo que la publicación de Supabase incluya estas tablas.
- Caja: cobro total obligatorio (sin parcial); visibilidad creador o cajero principal del turno.
- RPC `create_extra_order(...)`; en listados de caja, `table_name` solo para `DINE_IN` con `table_id`.

### Para llevar (TAKEOUT) y Orden especial como tarjetas dinamicas
- El listado principal de tarjetas `Para llevar` se filtra por:
  - `orders.order_type = 'TAKEOUT'`
  - `is_tray_order = false`
  - `is_special = false`
- El listado principal de tarjetas `Orden especial` se filtra por:
  - `orders.is_special = true`
- Reglas operativas de visibilidad:
  - La tarjeta `+` es UI-only y siempre existe aunque no haya ordenes.
  - Una orden `DRAFT` solo se muestra si tiene al menos un item activo agregado.
  - Una orden `TAKEOUT` o especial puede permanecer visible aunque este `PAID`; pagar no debe sacarla del modulo.
  - Debe excluirse cuando exista un despacho aplicado (por ejemplo, via `order_dispatch_events` con `status = 'APPLIED'`) o cancelacion.
- La numeracion superior de tarjeta es visual y consecutiva; no debe depender de huecos en `orders.order_number`.
- El codigo/numero real (`order_code` / `order_number`) debe mostrarse completo una sola vez y acompanado por el usuario creador (`orders.created_by` resuelto contra `profiles`).
- La navegacion de UI usa `origin=para-llevar` y `origin=orden-especial` para preservar el resaltado del menu lateral aun cuando la vista final sea detalle de `Ordenes`.

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
- `get_batch_order_operational_snapshots(p_order_ids uuid[])` — lectura batch para Despacho (`20260602140000_batch_operational_snapshots.sql`); 16 columnas alineadas al snapshot individual.
- `close_extra_order(p_order_id uuid)`
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
- `sync_order_payment_state(...)` (RPC con comprobación de permisos; expone `sync_order_payment_state_internal`)
- `sync_order_payment_state_internal(...)` (invocado por triggers en `payments` / `payment_items` y por otras RPCs)
- `get_user_caja_status(shift_id, user_id)`
- `open_cash_register(...)` → `RETURNS uuid`
- `close_cash_register(...)` (solo apertura abierta del cajero autenticado)
- `sync_shift_caja_status_from_openings(shift_id)`
- `cancel_empty_draft_orders_for_branch(...)`
- `list_branch_closure_blocking_orders(...)`
- `anular_apertura_caja(...)` (legacy por turno; preferir `annul_cash_opening` por apertura)
- `annul_cash_opening(p_opening_id, p_admin_id, p_reason)`
- `list_cash_register_openings(...)`
- `registrar_movimiento_caja(...)`
- `registrar_movimiento_caja_operativo(...)` (`PAYMENT_IN` upsert por cajero autenticado)
- `apply_shift_caja_configuration(...)`
- `internal_open_cash_register_for_cashier(...)`
- `template_denoms_to_jsonb(...)`
- `list_cash_register_movements(...)`
- `claim_cash_session_slot(...)` (sesion de terminal; no sustituye apertura de caja por cajero)
- `create_extra_order(...)`

### Anulacion de pagos
- `can_void_payment(...)`
- `request_void_payment(...)`
- `approve_and_void_payment(...)`
- `create_successor_order_after_payment_void(...)`
- `recalculate_check_balance(...)`
- `sync_order_payment_state(...)`
- Edge Function relacionada:
  - `void-payment`

## Migraciones relevantes del estado actual

### Base catalogo / turnos / menus
- `20260430130000_add_branch_workflow_mode.sql`
- `20260501123000_enforce_cash_then_dispatch_globally.sql`
- `20260312110000_add_menu_nodes_tree.sql`
- `20260313143000_move_modifier_assignments_to_menu_nodes.sql`
- `20260315090000_branch_reference_tables_and_shift_active_count.sql`
- `20260323213000_dual_menu_trees_table_takeout.sql`
- `20260326190000_add_manual_price_enabled_to_menu_nodes.sql`
- `20260329134000_add_bulk_included_products.sql`

### Caja / apertura / movimientos
- `20260521100000_allow_multiple_shift_caja_users.sql` (varios `can_use_caja` por turno; `open_cash_register` sin cupo de un solo UUID)
- `20260522120000_per_cashier_caja_register.sql` (denoms por cajero, apertura independiente, gate por usuario, `annul_cash_opening`)
- `20260524120000_global_admin_free_branch_switch.sql` (admin global: cambio libre de sucursal activa)
- `20260525120000_shift_caja_structure.sql` (principal/secundarias, `register_role`, `apply_shift_caja_configuration`)
- `20260526150000_remove_max_caja_sessions_cap.sql`
- `20260528130000_payment_in_upsert_per_cashier.sql` (cobro: crear fila en `cash_shift_denoms` si el cliente paga con denominacion no en plantilla)
- `20260317124500_cash_register_opening_annulment.sql`
- `20260317133000_cash_register_movements.sql`
- `20260317143000_apply_cash_register_movement_to_denoms.sql`
- `20260404153000_require_capture_user_on_cash_open.sql`
- `20260410190000_cash_register_templates.sql`
- `20260411100000_allow_cash_close_with_pending_orders.sql`
- `20260411103000_allow_reopen_cash_register_in_open_shift.sql`

### Pagos y anulaciones
- `20260509180000_payment_items_sync_once_per_statement.sql` (sincronización de estado de orden una vez por sentencia en `payment_items`)
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
- `20260507033000_split_order_after_payment_void.sql`
- `20260507120000_define_paid_before_dispatch_flow.sql`
- `20260507123000_keep_paid_orders_on_tables_until_dispatch.sql`

### Express y flujo despacho-cobro
- `20260516000000_add_express_order_type.sql`
- `20260527120000_add_extra_order_type.sql`
- `20260529120000_secondary_caja_order_scope.sql`
- `20260530120000_extra_auto_dispatch_on_payment.sql` (historica; el sync vigente ya no la invoca — ver `20260602120000`)
- `20260602120000_extra_flow_like_table_orders.sql`
- `20260602130000_close_extra_order.sql`
- `20260602140000_batch_operational_snapshots.sql`
- `20260531120000_add_extra_menu_scope.sql` (opcional; `menu_scope` acepta `EXTRA`)
- `20260531130000_extra_frequent_products.sql`
- `20260531140000_frequent_products_multi_context.sql`

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
- `20260428100000_support_double_app_session_for_cash_users.sql`
- `20260428104000_centralize_shift_close_unsubmitted_draft_cleanup.sql`
- `20260501100000_apply_branch_workflow_to_order_submission.sql`
- `20260502100000_split_profile_names.sql`
- `20260502103000_profile_full_name_reflects_first_name.sql`
- `20260502104500_reload_postgrest_schema.sql`

## Reglas de integridad
1. No asumir que `menu_nodes` ya reemplazo la FK de `order_items.product_id`.
2. No confundir cierre de caja con cierre de turno.
3. Si se toca anulacion de pagos, revisar consistencia entre `payments`, `payment_items`, `payment_void_requests`, `cash_shift_denoms`, `cash_movements` y estado de `orders`; las ordenes historicas por pago anulado deben quedar `CANCELLED` con `VOID_SUCCESSOR_ORDER`, no `PAID`.
4. Si se toca `Unir/Dividir`, no romper cantidades pagadas, historial `READY` / `DISPATCHED` ni numeracion operativa.
5. Si se toca `Editar Orden`, revisar consistencia entre `orders.locked_for_editing`, anulaciones resultantes, despacho directo de items nuevos y el bloqueo del botón "Cobrar" en Caja.
6. Los resets SQL limpian metadata de comprobantes, pero no Storage; el bucket `payment-proofs` se limpia aparte.
7. Los resets operativos deben limpiar session locks en `profiles`, incluidas columnas de sesion secundaria, para evitar bloqueos heredados.
8. Si se cambia envio, cobro o despacho de ordenes, respetar el flujo global Caja - Despacho; no basar la regla en sucursal ni solo en `orders.order_type`.
10. La eliminacion completa de orden no puede saltarse la regla de estados: todos los items deben estar en borrador o en caja, con validacion inmediata antes de ejecutar.
11. Los cambios de perfil deben preservar `first_name`, `last_name` y la compatibilidad legacy de `full_name`.
9. Los cambios en `Editar Orden` o navegación desde Mesas deben preservar el contexto original del Sidebar y BottomNav mediante el parámetro `origin`.
12. El sistema de resaltado usa `forceActive` y `suppressActive` para garantizar que la sección de origen (Mesas u Ordenes) permanezca marcada correctamente.
13. Si se toca `Despacho`, preservar una sola tarjeta/fila por orden pagada; no partir la misma orden por tiempos de envio de items.
14. Si se toca Para llevar u Orden especial, preservar tarjetas dinamicas con `+` permanente, borradores vacios ocultos, orden visual consecutivo, codigo completo una sola vez y salida por despacho aplicado/cancelacion.
15. Si se modifican triggers de `payment_items` que llaman a `sync_order_payment_state_internal`, mantener sincronización **por sentencia** (como en `20260509180000`) o equivalente que evite invocar la función una vez por cada fila insertada en el mismo lote.
16. **Plantilla vs cobro:** `cash_register_template_denoms` define arqueo inicial; el cobro en UI usa `denominations` activas; `registrar_movimiento_caja_operativo` debe permitir `PAYMENT_IN` aunque la denominacion no estuviera en la plantilla.
17. **Extra:** no asignar `table_name` desde snapshot para `order_type` distinto de `DINE_IN` con `table_id`; post-pago queda `PAID` hasta despacho manual; cierre con `close_extra_order`, no auto-finalize en sync de pagos.
18. **Despacho UI:** pestaña unificada Para llevar/Express; Extra en Mesa/Todos; preferir `get_batch_order_operational_snapshots` cuando exista la migracion.
19. **Productos frecuentes:** reordenar con staging positivo; respetar unique por `(branch_id, context, display_order)`.
20. **Caja secundaria:** flags `secondary_caja_*` en `cash_shift_users`; filtro `created_by` en cliente para Por cobrar.

### Actualizacion May 23, 2026
- **Ordenes Especiales:** Se corrigio el trigger de pago para marcar como PAID a las ordenes especiales cuando alcanzan el monto manual configurado. Tambien se actualizo useReportesOnlineData.ts para que aparezcan bajo el tipo SPECIAL en los reportes y filtros, y dejen de estar ocultas como Mesa o Extra.
- **UI/UX Monitoreo y Tarjetas:** Ajustes en MonitoreoGlobal.tsx para hacer el embudo mutuamente excluyente en la columna Generadas. Se implemento grid de 2 columnas para tarjetas en vista de tablet y se corrigio el truncado de fecha/hora de los items.
- **Logo y PWA:** Se elimino el filtro CSS que ocultaba el color del logo en SidebarNav.tsx. Se aplico enmascarado circular (rounded-full object-cover) en Login, Sidebar y AppLayout. Se actualizaron los assets de PWA icon-192.png y icon-512.png con la nueva imagen cargada.
