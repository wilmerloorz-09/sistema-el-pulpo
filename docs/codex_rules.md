# Codex Rules

## Objetivo
Preservar continuidad tecnica y funcional del POS sin revertir decisiones operativas ya consolidadas.

## Reglas obligatorias vigentes

### 0. Estado canonico de orden
- No reinterpretar `READY` ni `KITCHEN_DISPATCHED` como "pagado".
- El flujo correcto es `DRAFT`/Borrador -> `SENT_TO_KITCHEN`/En Caja -> `PAID`/Pagada -> `KITCHEN_DISPATCHED`/Despachada.
- `Despacho` solo debe listar y operar ordenes `PAID` con cantidades activas pendientes de despacho.
- `dispatch_order_quantities(...)` debe rechazar cualquier orden que no este `PAID`.
- Al anular un pago, la orden original queda historica `CANCELLED` con `VOID_SUCCESSOR_ORDER`; la sucesora activa queda con numero nuevo en `SENT_TO_KITCHEN`/En Caja.

### 1. Refactor incremental
- No abrir un modelo nuevo si el flujo actual ya existe y puede extenderse.
- Si convive legacy con modelo nuevo, documentar claramente que parte ya migro y que parte no.

### 2. Seguridad en backend/BD primero
- La UI no define seguridad.
- Validar permisos reales por sucursal/modulo y, cuando aplique, por turno.
- Las reglas de flujo global deben vivir en BD/RPC y no solo en texto/botones del frontend.
- Si se toca bloqueo de sesion, revisar tanto la sesion principal como la sesion secundaria autorizada por `cash_shift_users.can_double_session`.

### 2.1 Flujo global Caja - Despacho
- Todas las sucursales trabajan con el mismo flujo: cobro primero y despacho despues.
- El CRUD de sucursales no debe mostrar un campo de flujo ni un check `Mesero-Cajero`.
- `branches.workflow_mode` queda como compatibilidad interna y debe estar forzado a `CASH_THEN_DISPATCH`.
- Mesa, para llevar y orden especial pasan primero a Caja; una vez pagadas pasan a Despacho.
- Si se toca envio de ordenes, revisar `submit_order_draft_items(...)`.
- Si se toca cobro o estado post-pago, revisar `sync_order_payment_state_internal(...)` y `useCaja`.
- Las políticas RLS deben permitir que usuarios operativos asignados a un turno activo accedan a `cash_register_templates`.

### 3. Catalogo
- `menu_nodes` es la fuente principal de estructura.
- Mantener soporte para `TABLE`, `TAKEOUT` y `BULK`.
- Mientras `order_items.product_id` apunte a `products`, toda venta debe preservar puente legacy.
- `manual_price_enabled` sigue viviendo en `menu_nodes`, no en `products`.

### 4. Caja y turno no son lo mismo
- No mezclar cierre de caja con cierre de turno.
- `close_cash_register(...)` puede cerrar solo la caja.
- `close_cash_shift_with_tables(...)` es cierre de turno. Si el flujo UI debe resolver ordenes especiales `$0`, debe hacerlo con confirmacion explicita antes de llamar al cierre.
- Antes de bloquear cierre por borradores, usar la logica central que cancela borradores no enviados sin cobros ni items operativos.
- Un `DRAFT` vacio o con solo items `DRAFT` no debe impedir cerrar turno.
- Para ordenes especiales `$0`, no inflar conteos con borradores vacios ni pagadas historicas: contar solo `SENT_TO_KITCHEN`, `READY` y `KITCHEN_DISPATCHED` sin `paid_at`.
- Respetar:
  - `cash_shifts` como turno
  - `cash_shifts.opened_at` como fecha/hora visible de apertura del turno abierto en `Admin > Turno`
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
- Las vistas de pagos del turno deben usar el rango real del turno (`cash_shifts.opened_at` a cierre/ahora), no el inicio del dia calendario.

### 6. Anulacion de pagos
- El flujo oficial es:
  - solicitud con `request_void_payment(...)`
  - autorizacion/ejecucion con Edge Function `void-payment`
  - cierre transaccional con `approve_and_void_payment(...)`
- Preservar siempre:
  - anulacion total y parcial
  - devolucion por denominacion
  - `replacement_payment_id`
  - **Auditoría de Anulación (2026-05-06):** No anular pagos sin dejar rastro en `order_cancellations` y `orders.notes`. La anulación debe registrar el supervisor responsable y el motivo.
  - separacion historica cuando un pago anulado deja una cuenta activa: orden original `CANCELLED` con `VOID_SUCCESSOR_ORDER`, y orden sucesora activa con nuevo numero y `SUCCESSOR_OF_VOIDED_ORDER`.
  - la orden historica por pago anulado nunca debe quedar `PAID`, aparecer en `Por cobrar`, ocupar mesa ni reactivarse por `recalculate_check_balance(...)`.
- En detalles de pagos anulados/reversados, no mostrar lo recibido por el cliente; mostrar solo anulacion/devolucion.
- No permitir atajos frontend que marquen un pago como anulado sin pasar por el flujo seguro.

### 7. Mesas y órdenes independientes
- No asumir que `table_splits` siga siendo la fuente principal de tabs/cuentas activas.
- El concepto de "divisiones" se reemplaza por "múltiples órdenes dentro de una mesa".
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
- `Eliminar orden` completa desde mesa/orden activa es un flujo distinto al selector de anulacion por cantidades.
- Debe mostrar confirmacion simple antes de ejecutar.
- **Unificación de UI:** No mostrar opciones duplicadas de "Eliminar orden" en el menú de acciones; unificar la lógica para que el botón resuelva si borra borrador o anula orden enviada.
- Solo se permite si todos los items estan en `DRAFT` o `En caja`; si hay items despachados, pagados o pendientes de anulacion, no debe mostrarse ni ejecutarse.
- La validacion debe repetirse justo antes de ejecutar, no confiar solo en el estado visual.

### 9. Editar Orden e In-Situ
- `Editar Orden` es buffered, no inline y opera de manera **In-Situ**.
- Debe seguir aplicando `orders.locked_for_editing` en DB.
- **Contexto de Navegación:** El flujo de edición y la navegación desde Mesas deben preservar el contexto original. Usar el parámetro `origin=mesas` para que el Sidebar y el BottomNav mantengan su estado resaltado.
- **Resaltado Manual:** Usar `forceActive` y `suppressActive` en `NavLink` y `BottomNav` para anular la lógica automática basada solo en la URL técnica.
- **Bloqueo en Caja:** Mientras una orden esté en edición (`locked_for_editing`), el botón "Cobrar" en el módulo de Caja debe estar deshabilitado automáticamente.
- No exponer controles directos de cantidad para items originales despachados/cerrados en ese modulo.
- Los controles `+/-`, eliminar e input de cantidad solo deben existir para items nuevos agregados durante la sesion de edicion.
- Al aceptar cambios:
  - se registran anulaciones derivadas del buffer
  - los items nuevos no vuelven a mesa
  - los items nuevos pasan directo a estado operativo (Despachado o "En caja")
- La accion principal del modulo es `Aceptar cambios`.

### 10. Snapshot operativo compartido
- Si una pantalla clasifica estados, usar `get_order_operational_snapshot(...)`.
- No reconstruir cantidades criticas con formulas ad hoc si ya existe snapshot comun.
- Toda pantalla que visualiza ordenes debe mostrar el usuario creador desde `orders.created_by`.
- Resolver nombres de usuario con el helper central (`first_name`, `full_name`, `username`, `email`, `Usuario`) y no duplicar fallbacks distintos por pantalla.
- El modulo `Ordenes` debe mantener las pestanas visibles en este orden exacto: `Borrador`, `En Caja`, `Pagada`, `Despachada`, `Anulada`.
- `Pendiente de anulacion` no debe reintroducirse como pestana principal; es un estado/marca operativa que bloquea acciones y se muestra en el detalle.
- `Borrador` debe listar ordenes con al menos un item activo agregado y no enviado a Caja; si una orden aun no tiene `order_code` / `order_number`, debe permanecer en `Borrador` mientras sus items no esten pagados ni anulados.
- `En Caja` debe listar solo ordenes numeradas/codificadas, enviadas a Caja, con items no `DRAFT` y saldo/cantidad pendiente de cobro; no debe incluir ordenes pagadas completas.
- `Despachada` debe aceptar cabecera `KITCHEN_DISPATCHED`, item `DISPATCHED` o cantidades/eventos reales de despacho.
- Una linea `DRAFT` no debe aparecer en pestanas operativas posteriores.
- En `Pagadas`, las ordenes especiales `PAID` deben seguir visibles aunque no tengan cantidades cobradas por item; usar `special_total_manual` como valor visible de la orden y los items reales como detalle.
- El cálculo de cambio (`changeAmount`) debe realizarse de manera unificada, agregando los excedentes de todos los métodos de pago en una sola cifra coherente.
- No asumir que `orders.total` de una orden especial coincide con `special_total_manual` o con `sum(order_items.total)`.
- **Agrupamiento UI Obligatorio:** Toda lista de ítems de orden (Caja y Resumen) debe implementar agrupamiento por descripción y precio unitario para evitar redundancia visual y facilitar la lectura operativa.
- **Flexibilidad en Edición:** El acceso a la edición de órdenes debe estar permitido para usuarios operativos (`canOperateOrders`) siempre que el turno esté abierto, asegurando que la gestión de mesas no dependa exclusivamente de supervisores.

### 11. Comprobantes de transferencia
- No romper separacion entre captura, almacenamiento, OCR/analisis y aprobacion/rechazo posterior.
- Si no hay OCR disponible, el flujo debe degradar a revision manual.
- La limpieza de metadata SQL y la limpieza del bucket `payment-proofs` son procesos separados.

### 12. Integridad Financiera y Caja
- **Inicialización Obligatoria:** El diálogo de pago (`PaymentDialog`) requiere estrictamente una "Caja abierta" (denominaciones inicializadas) para renderizarse; de lo contrario, debe mostrar un aviso instructivo para prevenir descuadres.
- **Integridad Financiera:** Las operaciones de cobro están vinculadas a la existencia de un registro activo en `cash_shift_denoms`; sin esta inicialización, el flujo de pago se bloquea preventivamente. Los cálculos de saldo y totales de turno aplican redondeo financiero para asegurar la consistencia del "Cuadre de caja". La anulación de pagos es condicional al estado de despacho de los ítems de la orden.
- **Optimización UI:** El módulo de Despacho debe estar optimizado para resoluciones de tablet (1280px), ajustando proporciones de rejilla y tipografía para máxima visibilidad operativa.

## Convenciones de implementacion

### Frontend
- **Manejo de Feedback:** Usar `sonner` toasts para todas las notificaciones operativas y errores de validación, garantizando una experiencia de usuario consistente y no intrusiva.
- En usuarios, no reintroducir `Nombre completo` como campo principal; usar `Nombres` (`profiles.first_name`) y `Apellidos` (`profiles.last_name`).
- En listados compactos de usuarios, mostrar `Nombres` y nombre de usuario; no agregar cedula/telefono fuera de administracion o detalle.
- Si tocas catalogo, validar `Ordenes`, `Despacho`, `Caja`, ticket y vistas derivadas.
- Si tocas anulacion de pagos, validar `CompletedPaymentsList`, `PaymentReversalModal`, `useCaja`, `Mesas`, `order_cancellations`, orden historica `CANCELLED` con `VOID_SUCCESSOR_ORDER` y orden sucesora activa con `SUCCESSOR_OF_VOIDED_ORDER`.
- Si tocas `Unir/Dividir`, validar `MergeSplitOrdersDialog`, `Ordenes`, `Mesas` y cantidades movibles vs cantidades pagadas.
- Si tocas `Editar Orden`, validar:
  - buffer temporal
  - bloqueo `locked_for_editing`
  - visibilidad de controles
  - compromiso final con `Aceptar cambios`
  - persistencia del parámetro `origin` en Sidebar
  - bloqueo automático del botón "Cobrar" en Caja
- Si tocas reportes de caja, validar:
  - consolidado por turno
  - reporte por apertura
  - reimpresion
  - hoja de denominaciones al cierre

### Backend / BD
- Toda regla de caja, turno, anulacion de pago y movimiento entre ordenes debe vivir en RPC/BD, no solo en cliente.
- Toda regla de flujo debe respetar el flujo global Caja - Despacho; no reintroducir decisiones por sucursal.
- Si cambias una RPC critica, revisar firmas legacy si el frontend todavia tiene compatibilidad temporal.
- Toda tabla nueva o cambio de acceso requiere revisar RLS/policies.
- Si agregas columnas de sesion/perfil operativo, actualiza los resets para limpiar valores efimeros.
- Si cambias columnas de perfil, preservar `profiles.first_name`, `profiles.last_name` y la compatibilidad legacy de `profiles.full_name`.

## Checklist minimo antes de cerrar una tarea
1. Si hubo cambio de codigo, correr verificacion tecnica adecuada.
2. Si se toco caja, validar apertura, cobro, cierre o anulacion segun corresponda.
3. Si se toco reporteria de caja, validar consolidado y por apertura.
4. Si se toco anulacion de pagos, validar total y parcial.
5. Si se toco `Unir/Dividir`, validar que no mueva cantidades pagadas y que preserve historial operativo.
6. Si se toco `Editar Orden`, validar:
   - `Aceptar cambios`
   - estado final de items nuevos (deben ser cobrables si la orden está en caja)
   - anulaciones derivadas del buffer
   - bloqueo/desbloqueo correcto
   - bloqueo del botón "Cobrar" en Caja
7. Actualizar estos docs cuando cambie la regla base:
   - `docs/system_context.md`
   - `docs/PROJECT_ARCHITECTURE.md`
   - `docs/database_architecture.md`
   - `docs/codex_rules.md`
8. Si se tocan resets, actualizar tambien sus comentarios para reflejar las reglas base vigentes y asegurar que:
   - **Flujo Global:** El sistema impone un flujo estricto de Caja antes de Despacho. Las órdenes (Mesa, Para Llevar, Especial) deben pagarse para ser elegibles para despacho. La anulación de pagos requiere autorización de supervisor solo si al menos un ítem ha sido despachado; de lo contrario, se permite anulación directa.
9. Si se toco flujo de ordenes, validar que mesa, para llevar y orden especial pasen primero por Caja y luego a Despacho.
10. Si se toca el diálogo de pago, validar que exija la inicialización de caja y maneje correctamente el redondeo financiero.
11. Si se toca Despacho, validar la visualización en 1280px para asegurar la experiencia en tablet.
