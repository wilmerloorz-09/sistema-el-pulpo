# System Context

## Resumen ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- Frontend principal: React + TypeScript.
- Backend principal: Supabase/PostgreSQL con RLS, RPCs y Edge Functions.
- Backend auxiliar: `proof_capture_backend` para comprobantes de transferencia.
- La sucursal activa sale de `profiles.active_branch_id`.
- La operacion diaria sigue gobernada por permisos efectivos por modulo/sucursal y, cuando aplica, por `cash_shift_users`.
- La navegacion del catalogo ya usa `menu_nodes`, pero la persistencia operativa de venta sigue dependiendo de `products`.

## Estado operativo vigente (2026-05-01)

### 1. Catalogo y venta
- `menu_nodes` es la fuente principal de navegacion para `TABLE`, `TAKEOUT` y `BULK`.
- `products` sigue siendo obligatorio mientras `order_items.product_id` mantenga la FK legacy.
- `manual_price_enabled` vive en ramas de `menu_nodes`, no en `products`.
- `BULK` ya es parte estable del sistema:
  - puede tener productos incluidos desde `TABLE`
  - puede resolver entrega por monto
  - persiste instrucciones en `order_items.item_note`
  - usa `tray_item_type = 'C'` para que UI compartida no lo trate como unidades
- `TAKEOUT` y `Orden Bandeja` comparten base operativa; visualmente deben presentarse como `Para llevar`.

### 2. Turno, caja y acceso operativo
- `Admin > Turno` sigue siendo la superficie para configurar y abrir el turno.
- Cuando existe un turno `OPEN`, `Admin > Turno` debe mostrar la fecha y hora de apertura tomada de `cash_shifts.opened_at`.
- Los usuarios con rol operativo ya no requieren sucursal fija asignada para ingresar al sistema.
- Los usuarios operativos se validan contra la habilitacion del turno abierto:
  - deben estar en `cash_shift_users`
  - el turno debe estar `OPEN`
  - sus capacidades visibles salen del turno, no solo de permisos estaticos de sucursal
- Los usuarios con rol supervisor si requieren sucursal asignada obligatoriamente.
- Un usuario solo puede estar habilitado en un turno abierto a la vez.
- En `Admin > Turno`, el combo puede mostrar usuarios que ya estan habilitados en otro turno, pero al pulsar `Agregar` debe validarse y mostrar una ventana indicando la sucursal donde ya esta habilitado.
- La BD mantiene la restriccion final mediante trigger/RPC para impedir que se guarde un usuario en dos turnos abiertos.
- No se puede abrir ni guardar un turno sin al menos un usuario habilitado con rol operativo.
- `cash_shift_users` define capacidades operativas reales dentro del turno:
  - `can_serve_tables`
  - `can_dispatch_orders`
  - `can_use_caja`
  - `can_authorize_order_cancel`
  - `can_double_session`
  - `is_supervisor`
- `profiles.current_app_session_id` y `cash_shift_users.last_session_id` sostienen el session lock principal de la app.
- Si un usuario del turno tiene `cash_shift_users.can_double_session = true` y `can_use_caja = true`, puede conservar una segunda sesion simultanea mediante:
  - `profiles.current_app_secondary_session_id`
  - `profiles.current_app_secondary_session_started_at`
  - `profiles.current_app_secondary_session_device`
- La doble sesion solo aplica para usuarios habilitados en un turno abierto y pensada para caja/operacion controlada; fuera de ese caso, el bloqueo sigue siendo de una sola sesion.
- Administrador general y supervisor de sucursal mantienen override administrativo para operar caja.
- Cerrar caja ya no implica cerrar turno.
- Todas las sucursales trabajan con el mismo flujo: mesa, para llevar y orden especial pasan primero a Caja; luego de pagar pasan a Despacho.
- El CRUD de sucursales no expone campo de flujo ni check `Mesero-Cajero`.
- `branches.workflow_mode` se conserva solo como compatibilidad interna y queda forzado a `CASH_THEN_DISPATCH`.
- Al cerrar turno, el sistema limpia borradores no enviados que no tengan cobros ni items operativos; esto evita que una entrada abandonada en `Para llevar`, mesa u orden especial bloquee el cierre.
- Una orden `DRAFT` solo debe bloquear cierre si tiene pagos o items no `DRAFT`.
- Al cerrar turno, si existen ordenes especiales pendientes con valor operativo `$0`, el sistema debe mostrar una confirmacion:
  - `Cancelar`
  - `Continuar cierre`
- Al confirmar, esas ordenes especiales `$0` se marcan como `PAID` y luego continua el cierre normal del turno.
- El conteo de esa confirmacion solo debe incluir ordenes especiales `$0` que realmente bloquean cierre:
  - `SENT_TO_KITCHEN`
  - `READY`
  - `KITCHEN_DISPATCHED` sin `paid_at`

### 3. Caja y pagos
- `Caja` trabaja con:
  - `PayableOrdersList`
  - `CompletedPaymentsList`
  - `ShiftSummary`
  - `CashRegisterMovementsDialog`
  - `PaymentReversalModal`
- La caja fisica se reconstruye desde `cash_shift_denoms` + `cash_movements`.
- El resumen de caja ya debe mostrar efectivo neto aplicado, no efectivo bruto recibido antes del cambio.
- Caja debe considerar cobrable la cantidad ordenada activa completa, no solo la cantidad despachada, incluso para ordenes de mesa.
- Existen plantillas persistentes para apertura de caja:
  - `cash_register_templates`
  - `cash_register_template_denoms`
- El flujo de cobro por transferencia prepara captura previa de comprobante antes del cierre final.
- El modal no debe dar por confirmado un pago de transferencia solo por el monto digitado.
- El cierre de caja ya genera reporte imprimible.
- Existen dos tipos de reporte vigentes:
  - consolidado por turno
  - por apertura de caja
- El reporte por apertura:
  - filtra pagos y movimientos por `opened_at` / `closed_at`
  - muestra el detalle de la apertura en el encabezado
  - imprime en hoja aparte el detalle de monedas y billetes al cierre
  - agrega fila total en el detalle de denominaciones
- El reporte consolidado del turno mantiene la tabla `Historial de aperturas`.
- `Caja` ya permite reimpresion:
  - boton global para reporte consolidado del turno
  - boton por apertura cerrada para reimprimir solo esa apertura

### 4. Anulacion de pagos
- El sistema soporta anulacion segura de pagos con supervisor.
- Flujo vigente:
  - cajero solicita anulacion con `request_void_payment(...)`
  - supervisor autoriza y ejecuta via Edge Function `void-payment`
  - backend cierra la anulacion con `approve_and_void_payment(...)`
- El flujo soporta:
  - anulacion total
  - anulacion parcial por cantidades pagadas (`payment_items`)
  - desglose de devolucion en efectivo por denominacion
  - `replacement_payment_id` cuando queda saldo activo remanente
  - bloqueo si la apertura de caja del pago ya fue cerrada/anulada o si el pago ya fue anulado
- Una anulacion de pago puede reabrir el estado operativo de la orden o liberar la mesa visualmente segun el saldo restante.

### 5. Ordenes, mesas y unir/dividir
- `Ordenes` mantiene la vista de lista expandible.
- El orden visible de cuentas dentro de una mesa ya no depende operativamente de `table_splits`:
  - la UI usa `orders.table_order_position`
  - cuando ya existe numeracion operativa, debe prevalecer `order_code` / `order_number`
- Las pestanas del modulo `Ordenes` deben respetar etapas operativas reales:
  - `Borradores`
  - `Enviadas`
  - `Despachadas`
  - `Pendiente de anulacion`
  - `Anuladas`
  - `Pagadas`
- La pestana `Pagadas` debe mostrar ordenes especiales `PAID` aunque no tengan cantidades cobradas visibles por `payment_items`; en ese caso usa los items reales como detalle visual y `special_total_manual` como valor presentado de la orden.
- En toda superficie donde se visualicen ordenes, debe mostrarse el usuario que genero la orden a partir de `orders.created_by`.
- El nombre visible del generador se resuelve desde `profiles.full_name`, luego `profiles.username`, luego `profiles.email`; si no hay datos disponibles, usar `Usuario`.
- Esta visibilidad aplica a Ordenes, detalle de orden, Cocina, Despacho, Caja, pagos completados, Mesas/Editar Orden y Reportes.
- `CancelOrderDialog` sigue el modelo de doble lista.
- La solicitud de anulacion pendiente ya es parte base del flujo operativo:
  - `create_pending_order_cancellation_request(...)`
  - `request_order_cancellation(...)`
  - `clear_pending_order_cancellation_request(...)`
  - `list_pending_order_cancellation_requests(...)`
- Regla visible base:
  - si un item tiene solicitud pendiente, debe mostrarse como `Pendiente anulacion`
  - mientras exista al menos un item con anulacion pendiente, la orden no debe permitir agregar items, editar items, cerrar orden ni anular orden completa
- `MergeSplitOrdersDialog` ya opera con `move_dine_in_order_items_between_orders(...)`.
- El flujo `Unir/Dividir` vigente:
  - solo aplica entre ordenes `DINE_IN`
  - no aplica a ordenes especiales
  - puede mover cantidades operativamente activas entre ordenes/mesas/divisiones
  - preserva historial `READY` y `DISPATCHED`
  - solo permite mover cantidad no pagada remanente
- Si una orden origen queda sin items despues del movimiento, vuelve a `DRAFT`.

### 6. Editar Orden (In-Situ)
- `Editar Orden` ya es un flujo base del sistema y ahora opera de manera **In-Situ**.
- Al editar desde el módulo de "Mesas" o "Ordenes", el usuario ya no es redirigido a la pantalla principal al aceptar o cancelar cambios, manteniendo el contexto visual del detalle de la orden.
- El Sidebar preserva su estado resaltado (ej. "Mesas") mediante el parámetro de URL `origin`.
- Usa buffer temporal en UI (`stagedItems`).
- Bloquea la orden en DB con `orders.locked_for_editing`.
- El bloqueo se propaga a Caja, donde el botón "Cobrar" se deshabilita automáticamente mientras la edición esté activa para evitar conflictos transaccionales.
- Los items originales despachados o cerrados no exponen controles directos de cantidad en este modulo.
- Los items nuevos agregados durante la sesion si pueden exponer `+/-`, eliminar e input de cantidad.
- Al aceptar cambios:
  - se registran y aplican automaticamente las anulaciones derivadas del buffer
  - los items nuevos no vuelven a mesa
  - los items nuevos pasan directo a `Despachado` o al flujo de orden cerrada ("En caja"), segun el estado actual de la orden
- La accion principal del modulo es `Aceptar cambios`, no `Enviar`.

### 7. Orden especial
- `Orden Especial` sigue siendo metadata sobre `orders`, no un `order_type` nuevo.
- Usa `orders.is_special` y `orders.special_total_manual`.
- Para ordenes especiales, `special_total_manual` es el valor manual visible/cobrable aunque `orders.total` o la suma de `order_items.total` difieran.
- Una orden especial `$0` puede quedar como flujo operativo valido hasta despacho; si bloquea cierre de turno, se resuelve por confirmacion explicita en `Admin > Turno`.

### 8. Comprobantes de transferencia
- El backend dedicado `proof_capture_backend` sigue vigente.
- Persistencia base:
  - `payment_capture_requests`
  - `payment_proofs`
- OCR basico sin IA sigue disponible cuando el entorno tiene `tesseract`.
- Si no hay `tesseract`, el comprobante se guarda y queda en revision manual.

### 9. Usuarios
- Crear/editar usuario incluye datos de contacto extendidos:
  - nombre de usuario
  - cedula
  - nombre completo
  - direccion domiciliaria
  - correo
  - telefono
  - contrasena / confirmacion
  - tipo de usuario
  - sucursal
- Validaciones vigentes:
  - nombre de usuario: solo letras y numeros
  - cedula: solo numeros, exactamente 10 digitos
  - nombre completo: solo letras y espacios
  - correo: formato valido
  - telefono: solo numeros, exactamente 10 digitos
  - contrasena: minimo 6 caracteres
- El combo de sucursal permite `Sin sucursal` para usuarios operativos.
- La sucursal solo es obligatoria para usuarios con rol supervisor.

## Cambios recientes que ya deben considerarse base

### 2026-04-11 / 2026-04-25
- Caja:
  - la caja puede cerrarse sin cerrar el turno
  - el resumen usa efectivo neto aplicado en vez de monto bruto recibido
  - el cierre genera reporte imprimible
  - el reporte puede regenerarse por apertura o en modo consolidado del turno
  - el reporte por apertura incluye una segunda hoja con detalle de denominaciones al cierre
- Pagos:
  - anulacion parcial por cantidades
  - devolucion en efectivo por denominacion
  - `replacement_payment_id` para saldo remanente
- Mesas / Ordenes:
  - `Unir/Dividir` ya mueve items reales entre ordenes `DINE_IN`
  - `table_splits` deja de ser la fuente principal para tabs/cuentas activas de mesa
  - `table_name_snapshot` es parte base del fallback visual cuando una orden ya no tiene `table_id`
  - `get_branch_tables_overview(...)` ignora borradores vacios
  - crear/eliminar cuentas adicionales ya respeta el shift gate operativo
  - `Editar Orden` usa buffer temporal, `locked_for_editing` y confirma con `Aceptar cambios`
  - los items nuevos aceptados desde `Editar Orden` pasan directo a estado operativo
  - las ordenes especiales pagadas aparecen en `Pagadas` aunque el pago no tenga cantidades por item visibles
  - el cierre de turno puede confirmar y autopagar ordenes especiales pendientes con valor `$0`
- Caja / seguridad operativa:
  - session lock por `last_session_id` en `cash_shift_users`

### 2026-04-26
- Usuarios:
  - cedula, direccion y telefono forman parte del perfil administrable.
  - sucursal deja de ser obligatoria para usuarios operativos.
  - supervisor requiere sucursal obligatoria.
  - `Sin sucursal` es opcion valida para operativos en crear/editar usuario.
- Acceso operativo:
  - operativos sin sucursal ingresan si estan habilitados en un turno abierto.
  - `get_my_access_context(...)`, `set_my_active_branch(...)` y el gate de frontend deben considerar sucursales derivadas de turno abierto.
  - la navegacion operativa se calcula desde roles del turno cuando existe habilitacion.
- Turno:
  - un turno abierto debe conservar al menos un usuario operativo habilitado.
  - un usuario no puede estar habilitado en mas de un turno abierto.
  - el combo de `Agregar usuario al turno` muestra usuarios disponibles para elegir, pero valida al agregar y avisa si el usuario ya esta habilitado en otra sucursal.
  - la BD conserva la defensa final con `assert_user_single_open_shift(...)` y `get_user_open_shift_conflict(...)`.

### 2026-04-28
- Sesiones:
  - existe soporte de segunda sesion de app para usuarios de caja habilitados con `cash_shift_users.can_double_session = true`.
  - las columnas secundarias de sesion viven en `profiles` y deben limpiarse en resets operativos.
- Cierre de turno:
  - `cancel_empty_draft_orders_for_branch(...)` centraliza la limpieza de borradores vacios/no enviados.
  - `list_branch_closure_blocking_orders(...)` solo reporta `DRAFT` como bloqueante si tiene pagos o items operativos no `DRAFT`.
  - Las referencias de bloqueo distinguen `Orden especial`, `Bandeja`, `Para llevar`, mesa/division u orden generica.
- Ordenes:
  - todas las vistas de orden deben exponer el nombre del usuario creador sin depender del usuario conectado.
  - `src/lib/userDisplay.ts` centraliza la resolucion de nombre visible de perfil.

### 2026-05-01
- Sucursales:
  - El flujo ya no se configura por sucursal.
  - `branches.workflow_mode` queda forzado a `CASH_THEN_DISPATCH` por compatibilidad interna.
  - El CRUD no muestra campo de flujo ni check `Mesero-Cajero`.
- Ordenes / Caja:
  - `submit_order_draft_items(...)` deja toda orden enviada primero en Caja.
  - `sync_order_payment_state_internal(...)` y `useCaja` calculan cantidades cobrables completas antes de despacho.
  - **Edición In-Situ:** Los cambios en `Editar Orden` no rompen el contexto de navegación; el Sidebar mantiene el estado `origin`.
  - **Bloqueo de Caja:** La orden bloqueada (`locked_for_editing`) desactiva el botón de cobro en el módulo de Caja para prevenir conflictos transaccionales.
  - **Categorización "En Caja":** Los nuevos ítems aceptados en una edición de orden enviada a caja se marcan correctamente como "En caja" para el proceso de cobro.

## Riesgos que siguen vigentes
1. No asumir que `menu_nodes` ya reemplazo completamente a `products`.
2. No mezclar cerrar caja con cerrar turno.
3. Cualquier cambio en anulacion de pagos debe revisar `payments`, `payment_items`, `payment_void_requests`, `cash_shift_denoms`, `cash_movements` y estado visible de `Mesas` / `Ordenes`.
4. Cualquier cambio en `Unir/Dividir` debe preservar cantidades pagadas y redistribucion de historial `READY` / `DISPATCHED`.
5. Los resets SQL limpian datos transaccionales y metadata de comprobantes, pero los archivos del bucket `payment-proofs` se borran aparte.
6. La pestana `Pendiente de anulacion` depende de marcas reales en DB:
   - `orders.cancel_requested_at`
   - y/o cabecera `[PENDING_REQUEST]` en `order_cancellations`
7. Cualquier cambio en envio de ordenes o cobro debe respetar el flujo global Caja - Despacho; no codificar decisiones por sucursal.

## Checklist rapido para continuidad
1. Confirmar migraciones recientes de abril si se trabaja con una base remota.
2. Si falla anulacion de pago, revisar Edge Function `void-payment`, apertura de caja del pago y supervisor real del mismo turno.
3. Si falla `Unir/Dividir`, revisar cantidades pagadas, snapshot operativo y estado activo de ambas ordenes `DINE_IN`.
4. Si falla `Pendiente de anulacion`, revisar escritura RPC, policies y existencia real de marcas pendientes en DB.
5. Si falla un reporte de caja, revisar:
   - si el reporte pedido es por apertura o consolidado
   - `cash_register_openings.opened_at` / `closed_at`
   - filtrado de `completedPayments` y `cashRegisterMovements`
   - `cash_shift_denoms.qty_current`
6. Si falla acceso de usuario operativo, revisar:
   - que exista turno `OPEN`
   - que el usuario este en `cash_shift_users.is_enabled = true`
   - que tenga al menos una capacidad operativa
   - que no este intentando habilitarse en otro turno abierto
   - si usa doble sesion, que tenga `can_use_caja = true` y `can_double_session = true` en el turno abierto
