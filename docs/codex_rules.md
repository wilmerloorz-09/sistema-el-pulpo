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
- Para la superficie Turno, usar `turno` + `can_manage_shift_admin(...)`.
- No resolver problemas de acceso del supervisor devolviendole `admin_sucursal` por defecto.

### 3. Catalogo
- `menu_nodes` es la fuente principal de estructura.
- Mantener soporte para `TABLE`, `TAKEOUT` y `BULK`.
- Mientras `order_items.product_id` apunte a `products`, toda venta debe preservar puente legacy.
- `manual_price_enabled` sigue viviendo en `menu_nodes`, no en `products`.

### 4. Caja y turno no son lo mismo
- No mezclar cierre de caja con cierre de turno.
- `Turno` es modulo propio; supervisor por defecto solo debe tener acceso a Turno, no a Administracion.
- `close_cash_register(...)` puede cerrar solo la caja.
- `close_cash_shift_with_tables(...)` es cierre de turno. Si el flujo UI debe resolver ordenes especiales `$0`, debe hacerlo con confirmacion explicita antes de llamar al cierre.
- Si se cambia el usuario con permiso de cajero (`cash_shift_users.can_use_caja`) en un turno abierto, el frontend debe pedir confirmacion con la contrasena del usuario logueado antes de guardar.
- Para ordenes especiales `$0`, no inflar conteos con borradores vacios ni pagadas historicas: contar solo `SENT_TO_KITCHEN`, `READY` y `KITCHEN_DISPATCHED` sin `paid_at`.
- Respetar:
  - `cash_shifts` como turno
  - `cash_register_openings` como historial de aperturas
  - `cash_shift_denoms` como caja fisica real
- Si se toca apertura de caja, mantener soporte para:
  - `cash_register_templates`
  - `cash_register_template_denoms`
  - `capture_user_id`
  - `capture_device_label`

### 5. Reportes de caja
- Distinguir siempre entre:
  - reporte consolidado por turno
  - reporte por apertura de caja
- El consolidado puede mostrar `Historial de aperturas`.
- El reporte por apertura debe:
  - filtrar pagos y movimientos por rango de la apertura
  - mostrar el detalle de la apertura en el encabezado
  - incluir una hoja aparte con detalle de monedas y billetes al cierre
- El resumen de caja debe usar efectivo neto aplicado, no monto bruto recibido antes del cambio.

### 6. Anulacion de pagos
- El flujo oficial es:
  - solicitud con `request_void_payment(...)`
  - autorizacion/ejecucion con Edge Function `void-payment`
  - cierre transaccional con `approve_and_void_payment(...)`
- Preservar siempre:
  - anulacion total y parcial
  - devolucion por denominacion
  - `replacement_payment_id`
  - reapertura correcta de orden/mesa/division cuando aplique
- No permitir atajos frontend que marquen un pago como anulado sin pasar por el flujo seguro.

### 7. Mesas / Unir / Dividir
- No asumir que `table_splits` siga siendo la fuente principal de tabs/cuentas activas.
- La numeracion/orden visible vigente vive en `orders.table_order_position`.
- `MergeSplitOrdersDialog` debe seguir apoyandose en `move_dine_in_order_items_between_orders(...)`.
- Esa operacion debe mantener:
  - solo `DINE_IN`
  - exclusion de ordenes especiales
  - preservacion de modificadores
  - redistribucion de historial `READY` / `DISPATCHED`
  - restriccion de mover solo cantidad no pagada disponible

### 8. Anulacion de ordenes / items
- El flujo oficial de solicitud pendiente ya es parte base del sistema:
  - `create_pending_order_cancellation_request(...)`
  - `request_order_cancellation(...)`
  - `clear_pending_order_cancellation_request(...)`
  - `list_pending_order_cancellation_requests(...)`
- No dar exito en frontend si la base no dejo una marca real de pendiente.
- Regla UX obligatoria:
  - si existe al menos un item con anulacion pendiente, la orden no debe permitir agregar items, editar items, `Cerrar orden` ni `Anular orden`
  - el item afectado debe mostrarse como `Pendiente anulacion`

### 9. Editar Orden
- `Editar Orden` es buffered, no inline.
- Debe seguir aplicando `orders.locked_for_editing` en DB.
- No exponer controles directos de cantidad para items originales despachados/cerrados en ese modulo.
- Los controles `+/-`, eliminar e input de cantidad solo deben existir para items nuevos agregados durante la sesion de edicion.
- La accion principal del modulo es `Aceptar cambios`.
- Al aceptar cambios:
  - se registran anulaciones derivadas del buffer
  - los items nuevos no vuelven a mesa
  - los items nuevos pasan directo a estado operativo

### 10. Snapshot operativo compartido
- Si una pantalla clasifica estados, usar `get_order_operational_snapshot(...)`.
- No reconstruir cantidades criticas con formulas ad hoc si ya existe snapshot comun.
- Una linea `DRAFT` no debe aparecer en pestanas operativas posteriores.
- En `Pagadas`, las ordenes especiales `PAID` deben seguir visibles aunque no tengan cantidades cobradas por item; usar `special_total_manual` como valor visible de la orden y los items reales como detalle.
- No asumir que `orders.total` de una orden especial coincide con `special_total_manual` o con `sum(order_items.total)`.

### 11. Comprobantes de transferencia
- No romper separacion entre captura, almacenamiento, OCR/analisis y aprobacion/rechazo posterior.
- Si no hay OCR disponible, el flujo debe degradar a revision manual.
- La limpieza de metadata SQL y la limpieza del bucket `payment-proofs` son procesos separados.

## Convenciones de implementacion

### Frontend
- Si tocas `ShiftSetupAdmin`, validar:
  - supervisor con modulo `Turno` sin Administracion
  - visualizacion de turno abierto
  - guardado de usuarios del turno
  - confirmacion con contrasena del usuario logueado cuando cambia `can_use_caja`
  - politica de anulacion directa desde Turno
- Si tocas catalogo, validar `Ordenes`, `Despacho`, `Caja`, ticket y vistas derivadas.
- Si tocas anulacion de pagos, validar `CompletedPaymentsList`, `PaymentReversalModal`, `useCaja`, `Mesas` y estado visible de la orden reabierta.
- Si tocas `Unir/Dividir`, validar `MergeSplitOrdersDialog`, `Ordenes`, `Mesas` y cantidades movibles vs cantidades pagadas.
- Si tocas `Editar Orden`, validar:
  - buffer temporal
  - bloqueo `locked_for_editing`
  - visibilidad de controles
  - compromiso final con `Aceptar cambios`
- Si tocas reportes de caja, validar:
  - consolidado por turno
  - reporte por apertura
  - reimpresion
  - hoja de denominaciones al cierre

### Backend / BD
- Toda regla de caja, turno, anulacion de pago y movimiento entre ordenes debe vivir en RPC/BD, no solo en cliente.
- Si cambias una RPC critica, revisar firmas legacy si el frontend todavia tiene compatibilidad temporal.
- Toda tabla nueva o cambio de acceso requiere revisar RLS/policies.
- Las RPC/policies relacionadas con Turno deben aceptar `can_manage_shift_admin(...)` cuando correspondan al modulo `turno`.
- `list_branch_cancel_policy_nodes(...)`, `save_branch_cancel_policy(...)`, `cash_shift_users`, `cash_shifts` y configuracion de despacho ligada a Turno no deben bloquear al supervisor solo por no tener `admin_sucursal`.

## Checklist minimo antes de cerrar una tarea
1. Si hubo cambio de codigo, correr verificacion tecnica adecuada.
2. Si se toco caja, validar apertura, cobro, cierre o anulacion segun corresponda.
3. Si se toco Turno, validar supervisor con permiso `turno`, administrador, apertura/guardado/cierre, cambio de cajero y politicas de anulacion.
4. Si se toco reporteria de caja, validar consolidado y por apertura.
5. Si se toco anulacion de pagos, validar total y parcial.
6. Si se toco `Unir/Dividir`, validar que no mueva cantidades pagadas y que preserve historial operativo.
7. Si se toco `Editar Orden`, validar:
   - `Aceptar cambios`
   - estado final de items nuevos
   - anulaciones derivadas del buffer
   - bloqueo/desbloqueo correcto
8. Actualizar estos docs cuando cambie la regla base:
   - `docs/system_context.md`
   - `docs/PROJECT_ARCHITECTURE.md`
   - `docs/database_architecture.md`
   - `docs/codex_rules.md`
9. Si se tocan resets, actualizar tambien sus comentarios para reflejar las reglas base vigentes.
