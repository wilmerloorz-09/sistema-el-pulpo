# Project Architecture

## Vista general
- Frontend principal: React + TypeScript + React Query.
- Backend principal: Supabase (PostgreSQL, Auth, Storage, Realtime, RPCs, Edge Functions).
- Backend auxiliar: `proof_capture_backend` (Python/FastAPI) para captura y OCR basico de comprobantes.
- Estrategia arquitectonica: migracion incremental desde modelo legacy hacia `menu_nodes`, sin romper operacion diaria.

## Capas funcionales

### 1. Identidad y contexto
- Auth: Supabase Auth.
- Perfil operativo: `profiles`.
- Sucursal activa: `profiles.active_branch_id`.
- El frontend no debe asumir permisos solo por layout; la validacion final vive en BD/RPCs.

### 2. Permisos y gate operativo
- Capa 1: permisos efectivos por modulo/sucursal.
- Capa 2: capacidades por turno en `cash_shift_users`.
- `get_my_branch_shift_gate(...)` sigue siendo el gate principal para habilitar vistas operativas.
- `cash_shift_users.last_session_id` agrega control de sesion activa/toma de control para Caja.

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
  - la navegacion ya ocurre sobre `menu_nodes`
  - la venta sigue cerrando sobre `products` mientras `order_items.product_id` mantenga esa FK

### 4. Modificadores
- Catalogo base: `modifiers`.
- Disponibilidad por nodo: `menu_node_modifiers`.
- Seleccion real del item: `order_item_modifiers`.
- `subcategory_modifiers` queda como herencia legacy, no como arquitectura objetivo.

### 5. Ordenes
- `useOrder`, `useOrdersByStatus` y `get_order_operational_snapshot(...)` sostienen la lectura operativa comun.
- `Ordenes` usa lista expandible y detalle inline.
- Las pestañas del modulo `Ordenes` son etapa-dependientes:
  - `Borradores`
  - `Enviadas`
  - `Despachadas`
  - `Pendiente de anulacion`
  - `Anuladas`
  - `Pagadas`
- Regla vigente:
  - una linea `DRAFT` no debe aparecer en pestañas operativas posteriores aunque la orden ya tenga historial enviado/despachado
- `CancelOrderDialog` y `PaymentDialog` comparten el patron de doble lista.
- `Orden especial` sigue siendo una variante de `orders`, no un modulo aparte.

### 6. Mesas y divisiones
- `restaurant_tables` sigue siendo la entidad fisica real.
- `table_splits` queda como soporte legacy / compatibilidad, pero ya no es la base principal para la visualizacion de cuentas activas dentro de una mesa.
- El orden visible actual de cuentas de mesa vive en `orders.table_order_position`.
- `Mesas` usa `get_branch_tables_overview(...)` como lectura consolidada.
- `Ordenes` usa una lectura separada por mesa para tabs/cuentas activas y ya no debe depender de snapshots cacheados embebidos en una sola orden.
- `orders.table_name_snapshot` es el respaldo visual para listados historicos o desacoplados de mesa.
- `Cerrar orden` para cuentas de mesa opera soltando la orden de `table_id` / `split_id` y manteniendola cobrable en `Caja`.
- El flujo `Unir/Dividir` ahora vive sobre `move_dine_in_order_items_between_orders(...)`.
- Esa RPC:
  - mueve items entre ordenes `DINE_IN`
  - preserva modificadores
  - redistribuye historial `READY` y `DISPATCHED`
  - desde la version actual solo mueve cantidades no pagadas
  - asigna `order_number` / `order_code` a destino si deja de ser borrador operativo

### 7. Caja
- `Caja` se divide en:
  - apertura/resumen del turno
  - ordenes por cobrar
  - pagos realizados
  - movimientos de caja
  - anulacion de pagos
- Diferencia de arquitectura vigente:
  - el turno puede seguir abierto aunque la caja se cierre
  - `close_cash_register(...)` ya no bloquea por ordenes pendientes
  - cerrar turno sigue siendo una decision operativa separada
- Plantillas de apertura:
  - `cash_register_templates`
  - `cash_register_template_denoms`

### 8. Anulacion de pagos
- Flujo de dos pasos:
  - solicitud: `request_void_payment(...)`
  - autorizacion + ejecucion: Edge Function `void-payment` -> RPC `approve_and_void_payment(...)`
- La arquitectura actual soporta:
  - anulacion total
  - anulacion parcial por `payment_items`
  - devolucion en efectivo por denominacion
  - `replacement_payment_id` cuando queda parte activa del pago
  - reapertura de orden / mesa si el saldo vuelve a estar pendiente
- `CompletedPaymentsList` y `PaymentReversalModal` son la superficie visible de este flujo.

### 9. Comprobantes de transferencia
- `PaymentDialog` puede preparar una sesion provisional de pago con comprobante.
- Persistencia:
  - `payment_capture_requests`
  - `payment_proofs`
- Procesamiento:
  - Storage privado `payment-proofs`
  - OCR basico opcional con `tesseract`
- `proof_capture_backend` concentra captura, subida, analisis y aprobacion/rechazo posterior.

## Componentes y hooks clave
- Catalogo:
  - `src/hooks/useMenuTree.ts`
  - `src/components/order/MenuNavigator.tsx`
  - `src/components/admin/MenuNodesCrud.tsx`
- Ordenes y mesas:
  - `src/hooks/useOrder.ts`
  - `src/hooks/useOrdersByStatus.ts`
  - `src/hooks/useTablesWithStatus.ts`
  - `src/components/order/OrderListRow.tsx`
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
  - `src/pages/Caja.tsx`
- Shell y gate:
  - `src/components/AppLayout.tsx`
  - `src/components/BottomNav.tsx`
  - `src/hooks/useBranchShiftGate.ts`
- Backend auxiliar:
  - `proof_capture_backend/app/...`

## Principios vigentes
1. Refactor incremental, no corte brusco del modelo legacy.
2. Seguridad y reglas operativas en backend/BD primero.
3. `menu_nodes` manda la estructura; `products` sigue cerrando la transaccion.
4. Si una regla cruza `Ordenes`, `Despacho`, `Caja` y `Mesas`, debe apoyarse en snapshot operativo comun.
5. Si se toca anulacion de pagos, revisar tambien reapertura de ordenes, stock de denominaciones y estado visible de mesa.
6. Si se toca `Unir/Dividir`, preservar pagos, historial y numeracion operativa.
7. Si se toca visualizacion de tabs/cuentas por mesa, revisar juntos `orders.table_order_position`, `useOrder`, `Ordenes.tsx`, `MergeSplitOrdersDialog` y fallbacks con `table_name_snapshot`.

## Notas de arquitectura actual
- `BULK` ya es parte de la base operativa y no un experimento de UI.
- El shell responsive (`sidebar` >= `768px`, `bottom nav` < `768px`) es solo frontend; no introduce persistencia.
- El ticket termico de 80mm y la permanencia del modal tras el pago exitoso siguen siendo comportamiento base esperado.
