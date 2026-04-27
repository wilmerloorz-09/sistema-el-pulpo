# Project Architecture

## Vista general
- Frontend principal: React + TypeScript + React Query.
- Backend principal: Supabase (PostgreSQL, Auth, Storage, Realtime, RPCs, Edge Functions).
- Backend auxiliar: `proof_capture_backend` (Python/FastAPI) para captura y OCR basico de comprobantes.
- Estrategia arquitectonica: migracion incremental desde modelo legacy hacia `menu_nodes`, sin romper la operacion diaria.

## Capas funcionales

### 1. Identidad y contexto
- Auth: Supabase Auth.
- Perfil operativo: `profiles`.
- Sucursal activa: `profiles.active_branch_id`.
- El frontend no debe asumir permisos solo por layout; la validacion final vive en BD/RPCs.

### 2. Permisos y gate operativo
- Capa 1: permisos efectivos por modulo/sucursal.
- Capa 2: capacidades por turno en `cash_shift_users`.
- `turno` es modulo propio para administrar el turno operativo sin exponer todo `admin_sucursal`.
- El rol `supervisor` por defecto debe tener `turno: MANAGE` y no `admin_sucursal`.
- El helper backend comun para la superficie Turno es `can_manage_shift_admin(...)`; incluye global admin, `turno: MANAGE`, `admin_sucursal: MANAGE` y `admin_global: MANAGE`.
- `get_my_branch_shift_gate(...)` sigue siendo el gate principal para habilitar vistas operativas.
- `cash_shift_users.last_session_id` agrega control de sesion activa y toma de control para Caja.

### 3. Catalogo
- Fuente visual principal: `menu_nodes`.
- Alcances operativos:
  - `TABLE`
  - `TAKEOUT`
  - `BULK`
- Fuente transaccional legacy que sigue viva:
  - `categories`
  - `subcategories`
  - `products`
- Regla clave:
  - la navegacion ocurre sobre `menu_nodes`
  - la venta sigue cerrando sobre `products` mientras `order_items.product_id` mantenga esa FK

### 4. Modificadores
- Catalogo base: `modifiers`.
- Disponibilidad por nodo: `menu_node_modifiers`.
- Seleccion real del item: `order_item_modifiers`.

### 5. Ordenes
- `useOrder`, `useOrdersByStatus` y `get_order_operational_snapshot(...)` sostienen la lectura operativa comun.
- `Ordenes` usa lista expandible y detalle inline.
- Las pestanas del modulo `Ordenes` son etapa-dependientes:
  - `Borradores`
  - `Enviadas`
  - `Despachadas`
  - `Pendiente de anulacion`
  - `Anuladas`
  - `Pagadas`
- Regla vigente:
  - una linea `DRAFT` no debe aparecer en etapas posteriores
- `Orden Especial` es metadata de `orders` (`is_special`, `special_total_manual`), no un `order_type` nuevo.
- En ordenes especiales, `special_total_manual` es el valor manual visible/cobrable; puede diferir de `orders.total` y de la suma real de `order_items.total`.
- La pestana `Pagadas` debe incluir ordenes especiales con `status = 'PAID'` aun si no existen cantidades cobradas por item en `payment_items`; la UI debe usar los items reales para poder mostrarlas.
- La solicitud pendiente de anulacion ya tiene arquitectura propia:
  - escritura: `create_pending_order_cancellation_request(...)`
  - marcado oficial: `request_order_cancellation(...)`
  - limpieza al resolver: `clear_pending_order_cancellation_request(...)`
  - lectura oficial del tab: `list_pending_order_cancellation_requests(...)`
- Regla de interfaz consolidada:
  - los items con solicitud pendiente deben mostrar `Pendiente anulacion`
  - si existe al menos un item pendiente, la orden entra en modo bloqueado para agregar/editar items, `Cerrar orden` y `Anular orden`

### 6. Editar Orden
- `Editar Orden` es una arquitectura buffered, no una mutacion inline sobre la orden activa.
- El modulo trabaja con `stagedItems` en memoria.
- La orden se protege con `orders.locked_for_editing` para evitar carreras con Cocina y Despacho.
- Los items originales despachados o cerrados permanecen sin controles directos de cantidad.
- Los items nuevos agregados dentro de la sesion si pueden usar `+/-`, eliminar e input de cantidad.
- Al pulsar `Aceptar cambios`:
  - se comprometen los diffs en batch
  - se registran las anulaciones derivadas del buffer
  - los items nuevos pasan directo a estado operativo, no vuelven a mesa
- El modulo usa `Aceptar cambios` como accion principal; `Enviar` no debe mostrarse ahi.

### 7. Mesas y divisiones
- `restaurant_tables` sigue siendo la entidad fisica real.
- `table_splits` queda como soporte legacy, pero ya no es la base principal para visualizacion de cuentas activas.
- El orden visible actual de cuentas de mesa vive en `orders.table_order_position`.
- `Mesas` usa `get_branch_tables_overview(...)` como lectura consolidada.
- Esa lectura ya ignora borradores vacios al resolver ocupacion operativa de mesa.
- `orders.table_name_snapshot` es el respaldo visual para listados historicos o desacoplados de mesa.
- `Cerrar orden` para cuentas de mesa suelta `table_id` / `split_id` y mantiene la orden cobrable en `Caja`.
- El flujo `Unir/Dividir` vive sobre `move_dine_in_order_items_between_orders(...)`.

### 8. Caja
- `Caja` se divide en:
  - apertura/resumen del turno
  - ordenes por cobrar
  - pagos realizados
  - movimientos de caja
  - anulacion de pagos
- Diferencia de arquitectura vigente:
  - el turno puede seguir abierto aunque la caja se cierre
  - `close_cash_register(...)` no equivale a cierre de turno
- En Turno abierto, cambiar el usuario con `can_use_caja` es una accion sensible:
  - el frontend debe advertir el cambio de cajero actual/nuevo
  - debe pedir la contrasena del usuario logueado
  - solo debe guardar si la validacion confirma que la contrasena pertenece al mismo usuario autenticado
- Cierre de turno desde `Admin > Turno`:
  - si hay ordenes especiales pendientes con valor operativo `$0`, la UI debe pedir confirmacion antes de cerrar
  - si el usuario continua, esas ordenes se marcan `PAID` y despues se invoca `close_cash_shift_with_tables(...)`
  - el conteo debe limitarse a ordenes que realmente bloquean cierre (`SENT_TO_KITCHEN`, `READY`, `KITCHEN_DISPATCHED` sin `paid_at`)
- La caja fisica se compone desde `cash_shift_denoms.qty_current`.
- Las plantillas de apertura viven en:
  - `cash_register_templates`
  - `cash_register_template_denoms`
- El resumen ya usa efectivo neto aplicado, no `tendered` bruto.

### 9. Reportes de caja
- La generacion del reporte vive en `src/pages/Caja.tsx`.
- Existen dos modos:
  - `shift`: reporte consolidado del turno
  - `opening`: reporte por apertura de caja
- El reporte consolidado:
  - consolida aperturas cerradas del turno
  - conserva la tabla `Historial de aperturas`
- El reporte por apertura:
  - filtra pagos y movimientos por rango temporal de la apertura
  - sube el detalle de la apertura al encabezado
  - agrega una segunda hoja con detalle de monedas y billetes al cierre
  - incluye fila total en la tabla de denominaciones
- La UI expone:
  - boton global de consolidado
  - boton de reimpresion por apertura cerrada

### 10. Anulacion de pagos
- Flujo de dos pasos:
  - solicitud: `request_void_payment(...)`
  - autorizacion + ejecucion: Edge Function `void-payment` -> RPC `approve_and_void_payment(...)`
- La arquitectura actual soporta:
  - anulacion total
  - anulacion parcial por `payment_items`
  - devolucion en efectivo por denominacion
  - `replacement_payment_id` cuando queda parte activa del pago
  - reapertura de orden / mesa si el saldo vuelve a estar pendiente

### 11. Comprobantes de transferencia
- `PaymentDialog` puede preparar una sesion provisional de pago con comprobante.
- Persistencia:
  - `payment_capture_requests`
  - `payment_proofs`
- Procesamiento:
  - Storage privado `payment-proofs`
  - OCR basico opcional con `tesseract`
- `proof_capture_backend` concentra captura, subida, analisis y aprobacion/rechazo.

## Componentes y hooks clave
- Catalogo:
  - `src/hooks/useMenuTree.ts`
  - `src/components/order/MenuNavigator.tsx`
  - `src/components/admin/MenuNodesCrud.tsx`
- Ordenes y mesas:
  - `src/hooks/useOrder.ts`
  - `src/hooks/useOrdersByStatus.ts`
  - `src/hooks/useCancellation.ts`
  - `src/hooks/useTablesWithStatus.ts`
  - `src/components/order/OrderItemsList.tsx`
  - `src/components/order/OrderDetailPanel.tsx`
  - `src/components/order/MergeSplitOrdersDialog.tsx`
  - `src/components/order/CancelOrderDialog.tsx`
  - `src/pages/Ordenes.tsx`
  - `src/pages/Mesas.tsx`
- Caja:
  - `src/hooks/useCaja.ts`
  - `src/components/caja/PaymentDialog.tsx`
  - `src/components/caja/CompletedPaymentsList.tsx`
  - `src/components/caja/PaymentReversalModal.tsx`
  - `src/components/caja/ShiftSummary.tsx`
  - `src/components/caja/CashRegisterOpeningHistory.tsx`
  - `src/components/caja/OpenShiftForm.tsx`
  - `src/pages/Caja.tsx`
- Shell y gate:
  - `src/components/AppLayout.tsx`
  - `src/components/BottomNav.tsx`
  - `src/hooks/useBranchShiftGate.ts`
- Turno:
  - `src/components/admin/ShiftSetupAdmin.tsx`
  - `src/components/admin/BranchCancelPolicyEditor.tsx`
  - `src/hooks/usePreferredHomePath.ts`
  - `src/components/nav/useVisibleNavItems.tsx`
  - `src/components/ProtectedRoute.tsx`

## Principios vigentes
1. Refactor incremental, no corte brusco del modelo legacy.
2. Seguridad y reglas operativas en backend/BD primero.
3. `menu_nodes` manda la estructura; `products` sigue cerrando la transaccion.
4. Si una regla cruza `Ordenes`, `Despacho`, `Caja` y `Mesas`, debe apoyarse en snapshot operativo comun.
5. Si se toca anulacion de pagos, revisar tambien reapertura de ordenes, stock de denominaciones y estado visible de mesa.
6. Si se toca `Unir/Dividir`, preservar pagos, historial y numeracion operativa.
7. Si se toca `Editar Orden`, revisar juntos buffer UI, `locked_for_editing`, visibilidad de controles y compromiso final.
8. Si se toca reporteria de caja, revisar juntos filtrado temporal, `cash_register_openings`, `cash_shift_denoms` y reimpresion por apertura/turno.
9. Si se toca Turno, no devolver `admin_sucursal` al supervisor por defecto; usar `turno` + `can_manage_shift_admin(...)`.
10. Si se toca cambio de cajero en turno abierto, mantener confirmacion con contrasena del usuario logueado.
