# System Context

## Resumen ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- Frontend principal: React + TypeScript.
- Backend principal: Supabase/PostgreSQL con RLS, RPCs y Edge Functions.
- Backend auxiliar: `proof_capture_backend` para comprobantes de transferencia.
- La sucursal activa sigue saliendo de `profiles.active_branch_id`.
- La operacion diaria sigue gobernada por permisos efectivos por modulo/sucursal y, cuando aplica, por `cash_shift_users`.
- La navegacion del catalogo ya usa `menu_nodes`, pero la persistencia operativa de venta sigue dependiendo de `products`.

## Estado operativo vigente (2026-04-15)

### 1. Catalogo y venta
- `menu_nodes` es la fuente principal de navegacion para `TABLE`, `TAKEOUT` y `BULK`.
- `products` sigue siendo obligatorio mientras `order_items.product_id` mantenga la FK legacy.
- `manual_price_enabled` vive en ramas de `menu_nodes`; no en `products`.
- `BULK` ya es parte estable del sistema:
  - puede tener productos incluidos desde `TABLE`
  - puede resolver entrega por monto
  - persiste instrucciones en `order_items.item_note`
  - usa `tray_item_type = 'C'` para que UI compartida no lo trate como unidades
- `TAKEOUT` y `Orden Bandeja` siguen compartiendo base operativa; visualmente deben presentarse como `Para llevar`.

### 2. Turno, caja y acceso operativo
- `Admin > Turno` sigue siendo la superficie para configurar y abrir el turno.
- `cash_shift_users` define capacidades operativas reales dentro del turno:
  - `can_serve_tables`
  - `can_dispatch_orders`
  - `can_use_caja`
  - `can_authorize_order_cancel`
  - `is_supervisor`
- `cash_shift_users.last_session_id` se usa para session lock / toma de control vigente en Caja.
- Administrador general y supervisor de sucursal mantienen override administrativo para operar caja.
- Diferencia importante vigente:
  - cerrar caja ya no implica cerrar turno
  - `close_cash_register(...)` puede cerrar solo la caja del turno abierto
  - el cierre de turno sigue siendo una frontera operativa distinta

### 3. Caja y pagos
- `Caja` ya trabaja con:
  - `PayableOrdersList`
  - `CompletedPaymentsList`
  - `ShiftSummary`
  - `CashRegisterMovementsDialog`
  - `PaymentReversalModal`
- La caja fisica se sigue reconstruyendo desde `cash_shift_denoms` + `cash_movements`.
- Existen plantillas persistentes para apertura de caja:
  - `cash_register_templates`
  - `cash_register_template_denoms`
- El flujo de cobro por transferencia prepara captura previa de comprobante antes del cierre final.
- El modal no debe dar por confirmado un pago de transferencia solo por el monto digitado.

### 4. Anulacion de pagos
- El sistema ya soporta anulacion segura de pagos con supervisor.
- Flujo vigente:
  - cajero solicita anulacion con `request_void_payment(...)`
  - supervisor autoriza y ejecuta via Edge Function `void-payment`
  - backend cierra la anulacion con `approve_and_void_payment(...)`
- El flujo ya soporta:
  - anulacion total
  - anulacion parcial por cantidades pagadas (`payment_items`)
  - desglose de devolucion en efectivo por denominacion
  - `replacement_payment_id` cuando queda saldo activo remanente
  - bloqueo si la apertura de caja del pago ya fue cerrada/anulada o si el pago ya fue anulado
- Una anulacion de pago puede reabrir el estado operativo de la orden o liberar la mesa visualmente segun el saldo restante.
- `Mesas` ya contempla ordenes con pagos anulados para no dejarlas bloqueando la mesa equivocadamente.

### 5. Ordenes, Mesas y Unir/Dividir
- `Ordenes` mantiene la vista de lista expandible, no mosaico de cards.
- El orden visible de cuentas dentro de una mesa ya no depende operativamente de `table_splits`:
  - la UI usa `orders.table_order_position`
  - la etiqueta visible de tabs/botones sigue el patron `Orden N` mientras no exista `order_number`
  - cuando ya existe numeracion operativa, debe prevalecer `order_code` / `order_number`
- Las pestañas del modulo `Ordenes` deben respetar etapas operativas reales:
  - `Borradores` solo muestra lineas `DRAFT`
  - `Enviadas`, `Despachadas`, `Pendiente de anulacion` y `Pagadas` no deben mezclar lineas que sigan en `DRAFT`
- En listados historicos u ordenes desacopladas de mesa, el nombre visible de la mesa debe poder resolverse desde `orders.table_name_snapshot`.
- `CancelOrderDialog` sigue el modelo de doble lista y no debe volver al esquema antiguo de inputs por fila.
- En la vista de detalle de una orden de mesa existe tambien `Cerrar orden`:
  - libera la mesa soltando `table_id` / `split_id`
  - deja la orden activa para cobro en `Caja`
  - si la mesa tiene otras divisiones activas, esas divisiones siguen ocupando la mesa
- `MergeSplitOrdersDialog` ya opera con la RPC `move_dine_in_order_items_between_orders(...)`.
- El flujo `Unir/Dividir` vigente:
  - solo aplica entre ordenes `DINE_IN`
  - no aplica a ordenes especiales
  - puede mover cantidades operativamente activas entre ordenes/mesas/divisiones
  - preserva historial `READY` y `DISPATCHED` redistribuyendolo
  - desde 2026-04-11 solo permite mover cantidad no pagada remanente
  - si la orden destino deja de ser borrador operativo, puede recibir `order_number` y `order_code` en ese momento
- El dialogo `Mover Items/Mesa` ya debe iniciar con la orden activa seleccionada en la primera columna cuando se abre desde una orden de mesa.
- Esa preseleccion inicial solo aplica al arranque del dialogo:
  - despues el usuario puede cambiar filtro, origen y destino libremente
  - la UI no debe volver a forzar la orden inicial
- En los combos moviles de ese dialogo, la etiqueta compacta base esperada es `Mesa X (0002)`.
- Si una orden origen queda sin items despues del movimiento, vuelve a `DRAFT`.

### 6. Orden especial
- `Orden Especial` sigue siendo metadata sobre `orders`, no un `order_type` nuevo.
- Usa `orders.is_special` y `orders.special_total_manual`.
- Puede navegar ambos arboles (`TABLE` y `TAKEOUT`) sin romper el modelo actual.

### 7. Comprobantes de transferencia
- El backend dedicado `proof_capture_backend` sigue vigente.
- Persistencia base:
  - `payment_capture_requests`
  - `payment_proofs`
- OCR basico sin IA sigue disponible cuando el entorno tiene `tesseract`.
- Estados de analisis vigentes:
  - `match`
  - `mismatch`
  - `needs_review`
  - `unavailable`
  - `error`
- Si no hay `tesseract`, el comprobante se guarda y queda en revision manual.

## Cambios recientes que ya deben considerarse "base"

### 2026-04-11 / 2026-04-15
- Caja:
  - la caja puede cerrarse sin cerrar el turno
  - sigue existiendo historial de aperturas y anulaciones
- Pagos:
  - anulacion parcial por cantidades
  - devolucion en efectivo por denominacion
  - `replacement_payment_id` para saldo remanente
  - una anulacion puede reabrir ordenes `DINE_IN` y restaurar divisiones/mesa
- Mesas / Ordenes:
  - `Unir/Dividir` ya mueve items reales entre ordenes `DINE_IN`
  - el movimiento conserva modificadores e historial operativo
  - no puede mover cantidades ya comprometidas por pago
  - las ordenes activas de una mesa ahora se ordenan por `orders.table_order_position`
  - `table_splits` deja de ser la fuente principal para tabs/cuentas activas de mesa
  - `table_name_snapshot` es parte base del fallback visual cuando una orden ya no tiene `table_id`
  - `get_branch_tables_overview(...)` ya ignora borradores vacios para no seguir mostrando mesas ocupadas sin contenido operativo real
  - crear/eliminar cuentas adicionales de mesa ya debe respetar el mismo shift gate operativo de `Ordenes`
  - `MergeSplitOrdersDialog` ya arranca con la orden activa como origen visible y usa labels compactos `Mesa X (0002)` en combos
  - "Edición de Orden" (flujo buffered): El modulo operar modificaciones usa ahora una copia temporal en `stagedItems` y aplica bloqueos físicos (`locked_for_editing`) que deshabilitan la UI de Cocina/Despacho previniendo carreras de concurrencia. Una vez aceptados, los items nuevos ejecutan directamente el stored procedure `dispatch_order_quantities`.
- Caja / seguridad operativa:
  - session lock por `last_session_id` en `cash_shift_users`

### 2026-04-03 a 2026-04-09
- backend de comprobantes de transferencia
- OCR basico sin IA
- ticket termico 80mm
- mejoras responsive en `Ordenes`, `Caja`, `Admin`, `Mesas`
- modernizacion de usuarios y avatares
- `BULK` y productos incluidos estabilizados

## Riesgos que siguen vigentes
1. No asumir que `menu_nodes` ya reemplazo completamente a `products`.
2. No mezclar "cerrar caja" con "cerrar turno"; ahora son operaciones distintas.
3. Cualquier cambio en anulacion de pagos debe revisar:
   - `payments`
   - `payment_items`
   - `payment_void_requests`
   - `cash_shift_denoms`
   - `cash_movements`
   - estado visible de `Mesas` y `Ordenes`
4. Cualquier cambio en `Unir/Dividir` debe preservar cantidades pagadas y la redistribucion de historial `READY` / `DISPATCHED`.
5. No asumir que `table_splits` siga modelando la pestaña visible principal de una mesa; despues del rework de 2026-04-12 el orden operativo vive en `orders.table_order_position`.
6. Los resets SQL limpian datos transaccionales y metadata de comprobantes, pero los archivos del bucket `payment-proofs` se borran aparte.

## Checklist rapido para continuidad
1. Confirmar migraciones recientes de abril si se trabaja con una base remota:
   - `20260410183000_add_table_name_snapshot_to_orders.sql`
   - `20260409170000_secure_payment_void_same_shift_supervisor.sql`
   - `20260409213000_fix_voided_payment_reopens_order_state.sql`
   - `20260410180000_unassign_table_on_voided_payment.sql`
   - `20260411100000_allow_cash_close_with_pending_orders.sql`
   - `20260411161500_partial_void_payment_with_cash_refund_breakdown.sql`
   - `20260411213000_move_dine_in_order_items_between_orders.sql`
   - `20260411223000_allow_move_of_unpaid_remaining_item_quantity.sql`
   - `20260411233000_assign_order_number_when_move_creates_operational_destination.sql`
   - `20260412103000_rework_table_orders_without_splits.sql`
   - `20260414123000_ignore_empty_draft_orders_in_tables_overview.sql`
   - `20260414133000_align_additional_table_order_permissions_with_shift_gate.sql`
   - `20260414143000_align_delete_table_order_permissions_with_shift_gate.sql`
2. Si falla anulacion de pago, revisar primero:
   - Edge Function `void-payment`
   - apertura de caja del pago
   - supervisor real del mismo turno
3. Si falla `Unir/Dividir`, revisar primero:
   - cantidades pagadas del item
   - snapshot operativo
   - estado activo de ambas ordenes `DINE_IN`
