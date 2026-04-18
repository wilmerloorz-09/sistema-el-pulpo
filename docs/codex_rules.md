# Codex Rules

## Objetivo
Preservar continuidad tecnica y funcional del POS sin revertir decisiones operativas ya consolidadas.

## Reglas obligatorias vigentes

### 1. Refactor incremental
- No abrir un modelo nuevo si el flujo actual ya existe y puede extenderse.
- Si convive legacy con modelo nuevo, documentar claramente que parte ya migro y que parte no.

### 2. Seguridad en backend/BD primero
- La UI no define seguridad.
- Validar permisos reales por sucursal/modulo y, cuando aplique, por turno.

### 3. Catalogo
- `menu_nodes` es la fuente principal de estructura.
- Mantener soporte para `TABLE`, `TAKEOUT` y `BULK`.
- No reintroducir CRUD principal separado de `Categorias/Subcategorias/Productos`.
- Mientras `order_items.product_id` apunte a `products`, toda venta debe preservar puente legacy.
- `manual_price_enabled` sigue viviendo en `menu_nodes`, no en `products`.

### 4. Modificadores
- Catalogo base: `modifiers`.
- Disponibilidad: `menu_node_modifiers`.
- Seleccion real: `order_item_modifiers`.
- No volver a concatenar modificadores como texto libre.

### 5. Caja y turno no son lo mismo
- No mezclar cierre de caja con cierre de turno.
- `close_cash_register(...)` ya puede cerrar solo la caja.
- Cualquier cambio debe respetar:
  - `cash_shifts` como turno
  - `cash_register_openings` como historial de aperturas
  - `cash_shift_denoms` como caja fisica real
- Si se toca apertura de caja, mantener soporte para:
  - `cash_register_templates`
  - `cash_register_template_denoms`
  - `capture_user_id`
  - `capture_device_label`

### 6. Anulacion de pagos
- El flujo oficial es:
  - solicitud con `request_void_payment(...)`
  - autorizacion/ejecucion con Edge Function `void-payment`
  - cierre transaccional con `approve_and_void_payment(...)`
- Preservar siempre:
  - anulacion total y parcial
  - devolucion por denominacion
  - `replacement_payment_id` cuando queda saldo remanente
  - reapertura correcta de orden/mesa/division cuando aplique
- No permitir atajos frontend que marquen un pago como anulado sin pasar por el flujo seguro.
- Si el pago ya fue anulado, la apertura fue cerrada/anulada o no hay supervisor valido del turno, el flujo debe bloquearse.

### 7. Mesas / Unir / Dividir
- Si se implementa o ajusta `Cerrar orden` para una cuenta de mesa:
  - debe liberar la mesa removiendo el vinculo operativo de la orden con `table_id` / `split_id`
  - la orden debe seguir activa para cobro en `Caja`
  - si existen otras divisiones activas, la mesa no debe quedar libre por completo
- No asumir que `table_splits` siga siendo la fuente principal de tabs/cuentas activas:
  - la numeracion/orden visible vigente vive en `orders.table_order_position`
  - los labels historicos o desacoplados deben poder caer a `orders.table_name_snapshot`
- `MergeSplitOrdersDialog` debe seguir apoyandose en `move_dine_in_order_items_between_orders(...)`.
- Esa operacion debe mantener:
  - solo `DINE_IN`
  - exclusion de ordenes especiales
  - preservacion de modificadores
  - redistribucion de historial `READY` / `DISPATCHED`
  - restriccion de mover solo cantidad no pagada disponible
- Si el movimiento vuelve operativa una orden destino sin numeracion, respetar la asignacion de `order_number` y `order_code`.
- Si el dialogo se abre desde una orden activa:
  - la primera columna debe iniciar con esa orden seleccionada
  - esa preseleccion solo aplica al arranque; luego filtros/cambios del usuario no deben ser sobreescritos
  - los combos deben usar labels compactos tipo `Mesa X (0002)` en movil
- `create_additional_dine_in_order(...)` y `delete_dine_in_table_order(...)` deben seguir alineados con el shift gate vigente.

### 8. Anulacion de ordenes / items
- El flujo oficial de solicitud pendiente ya es parte base del sistema:
  - `create_pending_order_cancellation_request(...)`
  - `request_order_cancellation(...)`
  - `clear_pending_order_cancellation_request(...)`
  - `list_pending_order_cancellation_requests(...)`
- No dar exito en frontend si la base no dejo al menos una marca real:
  - `orders.cancel_requested_at`
  - o cabecera `[PENDING_REQUEST]` en `order_cancellations`
- No asumir que `order_item_cancellations` siempre existe o siempre persiste detalle completo:
  - si falta, la autorizacion debe poder reconstruir desde `notes` + snapshot operativo
- Regla UX obligatoria:
  - si existe al menos un item con anulacion pendiente, la orden no debe permitir agregar items, editar items, `Cerrar orden` ni `Anular orden`
  - el item afectado debe mostrarse como `Pendiente anulacion`
- La pestaña `Pendiente de anulacion` debe priorizar lectura directa desde base/RPC, no fallback optimista como fuente final.

### 9. Snapshot operativo compartido y Transaccionalidad
- Si una pantalla clasifica estados, usar `get_order_operational_snapshot(...)`.
- No reconstruir cantidades criticas con formulas ad hoc si ya existe snapshot comun.
- Regla explicita para el modulo `Ordenes`:
  - una linea `DRAFT` no debe aparecer en pestañas operativas posteriores (`Enviadas`, `Despachadas`, `Pendiente de anulacion`, `Pagadas`)
  - `Borradores` debe ser la unica pestaña que muestre lineas aun no enviadas
- Regla especifica para la UI de Modificaciones (Buffered Edit):
  - No exponer botones de modificacion (+/- o eliminar) para items despachados de manera generalizada. Su exposicion sin restriccion pertenece *solo* al ambiente buffer del modulo `Editar Orden`.
  - Esta ventana debe seguir aplicando `lockOrder` en la DB para prevenir concurrencia y no mutar BD subyacente hasta el `Aceptar cambios`.

### 10. `BULK` / `A granel`
- No volver a tratar `A granel` como compra por unidades en UI operativa.
- Mantener:
  - `menu_scope = 'BULK'`
  - productos incluidos desde `TABLE`
  - instrucciones `Entregar: ...`
  - `tray_item_type = 'C'`

### 11. Comprobantes de transferencia
- No romper separacion entre:
  - captura
  - almacenamiento
  - OCR/analisis
  - aprobacion/rechazo posterior
- Si no hay OCR disponible, el flujo debe degradar a revision manual, no fallar.
- La limpieza de metadata SQL y la limpieza del bucket `payment-proofs` son procesos separados.

## Convenciones de implementacion

### Frontend
- Si tocas catalogo, validar `Ordenes`, `Despacho`, `Caja`, ticket y cualquier vista derivada.
- Si tocas anulacion de pagos, validar:
  - `CompletedPaymentsList`
  - `PaymentReversalModal`
  - `useCaja`
  - `Mesas`
  - estado visible de la orden reabierta
- Si tocas `Unir/Dividir`, validar:
  - `MergeSplitOrdersDialog`
  - `Ordenes`
  - `Mesas`
  - cantidades movibles vs cantidades pagadas
- Si tocas anulacion pendiente de ordenes/items, validar:
  - `useCancellation`
  - `useOrdersByStatus`
  - `useOrder`
  - `OrderItemsList`
  - `OrderDetailPanel`
  - `Ordenes`
  - visibilidad real en `Pendiente de anulacion` tras recargar
- En movil, no comprimir tablas hasta volverlas ilegibles; degradar a cards o listas compactas.

### Backend / BD
- Toda regla de caja, turno, anulacion de pago y movimiento entre ordenes debe vivir en RPC/BD, no solo en cliente.
- Si cambias una RPC critica, revisar firmas legacy si el frontend todavia tiene compatibilidad temporal.
- Toda tabla nueva o cambio de acceso requiere revisar RLS/policies.
- Si cambias lectura de pendientes de anulacion, documentar tambien:
  - la RPC fuente
  - la marca en `orders`
  - el formato de `notes` (`[PENDING_REQUEST]`)
  - el fallback de reconstruccion si falta `order_item_cancellations`

## Checklist minimo antes de cerrar una tarea
1. Si hubo cambio de codigo, correr verificacion tecnica adecuada (`tsc`, tests o compilacion relevante).
2. Si se toco catalogo, validar al menos un flujo de venta real.
3. Si se toco caja, validar apertura/cobro/cierre o anulacion segun corresponda.
4. Si se toco anulacion de pagos, validar total y parcial.
5. Si se toco `Unir/Dividir`, validar que no mueva cantidades pagadas y que preserve historial operativo.
6. Si se toco anulacion pendiente de orden/item, validar:
   - que la solicitud quede guardada en BD
   - que aparezca en `Pendiente de anulacion`
   - que el item muestre `Pendiente anulacion`
   - que la orden quede bloqueada para agregar/editar/cerrar/anular
7. Si se toco numeracion/tabs de mesa o labels visibles de orden, validar:
   - `orders.table_order_position`
   - `table_name_snapshot`
   - tabs de `Ordenes`
   - combos de `MergeSplitOrdersDialog`
   - `Mesas` / reingreso a una mesa
   - que `get_branch_tables_overview(...)` no vuelva a contar borradores vacios como ocupacion real
8. Actualizar estos docs cuando cambie la regla base:
   - `docs/system_context.md`
   - `docs/PROJECT_ARCHITECTURE.md`
   - `docs/database_architecture.md`
   - `docs/codex_rules.md`
9. Si se tocan resets, actualizar tambien sus comentarios para reflejar:
   - anulaciones de pago
   - solicitudes pendientes de anulacion por orden/item
   - `Unir/Dividir`
   - `table_order_position` / `table_name_snapshot` si cambia la base de ordenes de mesa
   - templates de caja
   - comprobantes de transferencia
   - diferencia entre cerrar caja y cerrar turno
   - overview de mesas ignorando borradores vacios
   - permisos alineados al shift gate para crear/eliminar cuentas adicionales

## Estado base que debe mantenerse
- Login con email o username.
- Sucursal activa como contexto operativo.
- Permisos efectivos por modulo/sucursal.
- Gate adicional por turno cuando aplique.
- Navegacion del menu sobre `menu_nodes`.
- Persistencia de venta todavia compatible con `products`.
- `BULK` operativo.
- `Orden Especial` como metadata sobre `orders`.
- `Orden Bandeja` como `is_tray_order`.
- Caja fisica basada en denominaciones.
- Flujo seguro de anulacion de pagos con supervisor.
