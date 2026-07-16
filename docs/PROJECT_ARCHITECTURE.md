# Project Architecture

## Vista general
- Frontend principal: React + TypeScript + React Query.
- Backend principal: Supabase (PostgreSQL, Auth, Storage, Realtime, RPCs, Edge Functions).
- Backend auxiliar: `proof_capture_backend` (Python/FastAPI) para captura y OCR basico de comprobantes.
- Estrategia arquitectonica: migracion incremental desde modelo legacy hacia `menu_nodes`, sin romper la operacion diaria.

## Regla canonica de flujo de orden
- `DRAFT`/Borrador: la orden tiene al menos un item agregado y todavia no se envio a Caja.
- `SENT_TO_KITCHEN`/En Caja: la orden fue enviada a Caja y ya tiene `order_code` / `order_number`.
- `PAID`/Pagada: Caja cubrio la orden; este es el unico estado elegible para aparecer en el modulo `Despacho`.
- `KITCHEN_DISPATCHED`/Despachada: la orden ya fue despachada y deja de ser pendiente de Despacho.
- `PAID` y `KITCHEN_DISPATCHED` son etapas visibles excluyentes: una orden despachada no debe seguir listada como pagada.
- En `Despacho`, una orden pagada se muestra una sola vez por `orders.id` / `order_code`; los items enviados en momentos distintos se agregan dentro de la misma tarjeta/fila.
- La anulacion de pago solo aplica sobre una orden pagada no despachada; al anular, la misma orden se reabre en `SENT_TO_KITCHEN`/En Caja con el mismo numero para re-cobrar (sin sucesora, desde 2026-07-14).

## Capas funcionales

### 1. Identidad y contexto
- Auth: Supabase Auth.
- Perfil operativo: `profiles`.
- Sucursal activa: `profiles.active_branch_id`.
- Modos de flujo operativo: configurables por sucursal (`branches.workflow_mode`): Primero a caja (`CASH_THEN_DISPATCH`) o Primero a despacho (`DISPATCH_THEN_CASH`).
- El frontend no debe asumir permisos solo por layout; la validacion final vive en BD/RPCs.

### 2. Permisos y gate operativo
- Capa 1: permisos efectivos por modulo/sucursal.
- Capa 2: capacidades por turno en `cash_shift_users`.
- `get_my_branch_shift_gate(...)` sigue siendo el gate principal para habilitar vistas operativas.
- El campo `caja_status` de ese gate es **por usuario** (`get_user_caja_status`), no el estado global del turno.
- `profiles.current_app_session_id` y `cash_shift_users.last_session_id` agregan control de sesion activa. (Utilizado tambien en `Monitoreo Global` para ver quien esta operando en linea y en caja).
- `cash_shift_users.caja_session_slots` y `cash_shifts.max_caja_sessions` limitan terminales simultaneas; varios usuarios pueden tener `can_use_caja` en el mismo turno.
- `cash_shift_users.can_double_session` (**Sesión doble** en Admin > Turno) permite una segunda sesion de app para el **mismo** usuario en otro dispositivo; se registra en `profiles.current_app_secondary_session_id`. No requiere `can_use_caja`.
- Cliente: `AuthContext` + `localStorage` key `authOwnedSingleSession`; RPC `register_my_single_session` / `clear_my_single_session`; validacion ~15 s con select directo a slots en `profiles`.
- Al abrir turno, `open_cash_shift_with_tables` debe persistir el flag sin exigir `can_use_caja` (`20260714230000`). Tras aplicar caja, `ShiftSetupAdmin.restoreDoubleSessionFlags` reaplica el flag. Registro endurecido en `20260714240000`.
- **No** limpiar `authOwnedSingleSession` cuando el usuario auth parpadea a `null` (refresh de token); solo en `signOut` / kick por sesion concurrente.
- `cash_shift_users.can_pack_orders` permite el acceso exclusivamente a crear y cobrar Ordenes Extra, restringiendo visualmente Mesas, Para Llevar, Express y Especial.
- `cash_shift_users.can_serve_plates` delega el despacho de la categoría PLATOS al módulo Servir, ocultando estos productos en Despacho.
- Cada cajero abre/cierra su propia `cash_register_openings` y mantiene `cash_shift_denoms` separadas por `cashier_id`.
- Por turno puede configurarse un **cajero principal opcional** (`primary_cashier_id`) solo para defaults de UI; operativamente las cajas son unificadas.
- En `Recaudar` (Caja) existe un combo para filtrar qué órdenes ver (todas / mías / por usuario); el principal por defecto ve todas.
- **Monitoreo Global (`/admin/monitoreo-global`)**: Interfaz para Administradores Generales que consolida todos los turnos abiertos en tiempo real usando subscripciones a PostgreSQL (`supabase_realtime`) y un intervalo de respaldo (fallback) de 15s.

### 3. Catalogo
- Fuente visual principal: `menu_nodes`.
- Alcances operativos:
  - `TABLE`
  - `TAKEOUT`
  - `BULK`
- Ordenes `EXPRESS` usan el mismo arbol de menu que para llevar pero con flujo **despacho -> cobro** (ver `src/lib/orderFlow.ts`).
- Ordenes `EXTRA` usan menu mesa (`TABLE`) sin PLATOS, requieren mesa fisica (`table_id` obligatorio), flujo **caja -> despacho manual** (como mesa). Tras cobrar quedan `PAID` hasta despacho en modulo Despacho (pestañas Mesa/Todos); cierre con `close_extra_order`. Las órdenes desaparecen automáticamente del módulo Extra al ser despachadas. **Solo aplica en sucursales `CASH_THEN_DISPATCH`:** en `DISPATCH_THEN_CASH` el modulo Extra no aparece en navegacion y `/extra` redirige a Mesas.
- **Productos frecuentes:** configuracion en `extra_frequent_products` por `context` (`MESA`, `TAKEOUT`, `EXPRESS`, `EXTRA`); UI operativa `FrequentProductCards`, admin `FrequentProductsAdmin`; menú compuesto Para llevar/Express via `buildCompositeMenuNodes` (`src/lib/compositeMenuTree.ts`).
- Fuente transaccional legacy que sigue viva:
  - `categories`
  - `subcategories`
  - `products`
- Regla clave:
  - la navegacion ocurre sobre `menu_nodes`
  - la venta sigue cerrando sobre `products` mientras `order_items.product_id` mantenga esa FK

### 4. Modificadores
- Catalogo base: `modifiers`.
- Disponibilidad por nodo: `menu_node_modifiers` (puede asignarse a categoria o producto; los hijos heredan en operacion).
- Seleccion real del item: `order_item_modifiers`.
- **Resolucion en POS (`Ordenes.tsx`, 2026-07-07):**
  - Catalogo en memoria por sucursal: query key `branch-modifiers-catalog` (`fetchBranchModifiersCatalog`).
  - Estructura: `links` (`menu_node_modifiers` activos), `modifiersById`, `parentByNodeId` (todos los `menu_nodes.id` + `parent_id` de la sucursal).
  - `resolveModifierNodeIds(node, catalog)` arma `[producto, padre, abuelo, ...]` sin depender de `node.ancestor_ids` (obligatorio para nodos crudos de `extra_frequent_products`).
  - `buildModifiersForProductNode` deduplica por `modifier_id` respetando `display_order`.
  - Consultas `.in(...)` troceadas en bloques de 200 IDs (evita fallos en movil con catalogos grandes).
  - `handleSelectMenuProduct`: secuencia `productSelectSeqRef` anti-carrera; lookup de producto sin cache de 60 s.
  - UI: `AddItemDialog` renderiza la seccion **Modificaciones** solo si la lista resuelta tiene elementos; orden bandeja tipo A oculta modificadores por diseno.
  - Admin: invalidar `branch-modifiers-catalog` al mutar asignaciones (`useNodeModifiers`, `MenuNodesCrud`).

### 5. Ordenes
- `useOrder`, `useOrdersByStatus` y `get_order_operational_snapshot(...)` sostienen la lectura operativa comun.
- Las lecturas de orden deben incluir `orders.created_by` cuando la pantalla visualiza ordenes.
- El identificador del creador se resuelve con `src/lib/userDisplay.ts`: **`profiles.alias`** en operacion (sin `@`); fallback a `username`. No usar `first_name` / `full_name` en tarjetas, caja ni reportes.
- El envio de borradores usa `submit_order_draft_items(...)`; mesa, para llevar y orden especial quedan primero cobrables en Caja.
- Despacho recibe la orden despues del pago.
- Despacho no debe dividir una misma orden por marcas de tiempo de `order_items.sent_to_kitchen_at`; la unidad visible es la orden completa con cantidades pendientes agregadas.
- En `Despacho`, las ordenes `TAKEOUT`, `EXPRESS` (misma pestaña unificada **Para llevar / Express**) y las ordenes especiales se despachan como orden completa; el detalle puede expandirse para consulta, pero no debe exponer botones de despacho por item.
- Las ordenes `EXTRA` pagadas se listan en pestañas **Mesa** y **Todos**; comparten despacho por item como mesa (no como Express).
- Pestañas de `Despacho`: `Todos`, `Mesa` (`DINE_IN`/`TABLE`/`EXTRA`), `Para llevar / Express` (`TAKEOUT`+`EXPRESS`), `Orden especial`. Vista guardada `EXPRESS` en `localStorage` se mapea a `TAKEOUT`.
- `Ordenes` usa lista expandible y detalle inline.
- **Entradas dedicadas en navegación lateral (2026-05-08):**
  - Existen rutas dedicadas con pantalla principal propia:
    - `Para llevar`: `"/para-llevar"` muestra tarjetas dinamicas de ordenes TAKEOUT.
    - `Orden especial`: `"/orden-especial"` muestra tarjetas dinamicas de ordenes especiales.
  - La tarjeta `+` siempre existe y crea una nueva orden del modulo.
  - Solo se muestran borradores con al menos un item activo; los borradores vacios quedan ocultos. Las ordenes no borrador siguen visibles hasta despacho aplicado/cancelacion.
  - Las tarjetas de Mesa, Para llevar y Orden especial comparten formato; solo cambia el icono/logo. El numero superior es visual y consecutivo, y el codigo/numero real de orden se muestra completo una sola vez junto al usuario creador.
  - El `origin` debe preservarse en redirecciones internas (fallbacks, cambio de pestaña, etc.) para que el Sidebar/BottomNav mantenga el resaltado correcto.
- Las pestanas visibles del modulo `Ordenes` son etapa-dependientes y deben mostrarse en este orden:
  - `Borrador`
  - `En Caja`
  - `Pagada`
  - `Despachada`
  - `Anulada`
- Reglas vigentes de clasificacion:
  - `Borrador` muestra ordenes con al menos un item activo agregado que aun no fue enviado a Caja. Si una orden no tiene `order_code` / `order_number`, debe tratarse como borrador mientras tenga items activos no pagados ni anulados.
  - `En Caja` muestra solo ordenes numeradas/codificadas, enviadas a Caja (`SENT_TO_KITCHEN` o `READY`), con items no `DRAFT` y saldo/cantidad pendiente de cobro.
  - `En Caja` nunca debe mostrar lineas `DRAFT` ni ordenes pagadas completas.
  - `Pagada` muestra solo ordenes con estado `PAID`; estas ordenes son las unicas candidatas para `Despacho`.
  - `Despachada` muestra ordenes cuya etapa final visible sea `KITCHEN_DISPATCHED` y tambien ordenes `PAID` con despacho aplicado (`order_dispatch_events.status = 'APPLIED'`) mientras la cabecera aun no se haya sincronizado.
  - `Anulada` muestra ordenes canceladas o historicas de anulacion.
  - `Pendiente de anulacion` se conserva como estado/marca operacional, pero no como pestana principal.
- Una misma orden no debe aparecer simultaneamente en `Pagada` y `Despachada`.
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
- **Agrupamiento Visual de Ítems:**
  - La UI de `OrderItemsList` agrupa automáticamente los ítems por `description_snapshot` y `unit_price`.
  - Esta consolidación es solo visual para mejorar la legibilidad; la base de datos conserva los registros individuales para auditoría y trazabilidad.
  - Al agrupar, se suman las cantidades y totales, y se combinan los modificadores únicos.
- `Eliminar orden` en una orden activa es una accion directa con confirmacion simple; no usa el selector de anulacion por cantidades.
- La accion solo esta disponible si todos los items estan en `DRAFT` o `En caja`.
- La UI unifica esta acción para evitar duplicados en el menú de acciones, independientemente del origen de los items (borrador o enviados).
- La eliminacion completa valida nuevamente esa regla antes de ejecutar para evitar borrar ordenes con items despachados, pagados o con anulacion pendiente.
- **Despacho primero — vista de orden (2026-07-08):**
  - `OrderItemsList` con `splitDispatchSections` muestra bloques **En despacho** y **Despachados** en flujo `DISPATCH_THEN_CASH`.
  - Cambios locales en lineas En despacho quedan en staging (`kitchenBaselineItems` vs `stagedItems`) hasta **Enviar a cocina**; Despacho no se actualiza antes.
  - Boton **Enviar a cocina** con delta monetario (`formatKitchenSendMoneyDelta`); al confirmar: `applyKitchenPendingItemChanges` + `submit_order_draft_items`.
  - Aumentos de cantidad en lineas ya enviadas crean borrador con la diferencia (`add_dine_in_order_item`), no actualizan la linea enviada in place.
  - `reconcileKitchenStagedItems` elimina ids `temp-*` huerfanos tras `addItem` con staging.
  - Archivos: `src/lib/kitchenPendingChanges.ts`, `src/pages/Ordenes.tsx`, `src/hooks/useOrder.ts`.

### 6. Editar Orden
- `Editar Orden` es una arquitectura buffered y **In-Situ**.
- El boton `Editar orden` solo debe estar activo para ordenes en `SENT_TO_KITCHEN`/En Caja **en flujo Caja primero** (`CASH_THEN_DISPATCH`).
- **Excepcion — Despacho primero (`DISPATCH_THEN_CASH`):** no hay boton `Editar orden` ni flujo `from=editar`; las lineas En despacho se editan en vista normal con staging de cocina; las Despachadas no son editables.
- En `DRAFT` de Mesa, Para llevar y Orden especial, el menu de productos se mantiene activo mientras la orden siga siendo editable; eliminar un item no debe bloquear el catalogo. En `PAID`, `KITCHEN_DISPATCHED` y `CANCELLED`, el menu puede permanecer visible pero desactivado.
- El módulo trabaja con `stagedItems` en memoria y mantiene el contexto de navegación original (`origin`).
- La orden se protege con `orders.locked_for_editing` para evitar carreras con Cocina, Despacho y Caja.
- Los items originales despachados o cerrados permanecen sin controles directos de cantidad.
- Los items nuevos agregados dentro de la sesion si pueden usar `+/-`, eliminar e input de cantidad.
- Al pulsar `Aceptar cambios`:
  - se comprometen los diffs en batch
  - se registran las anulaciones derivadas del buffer
  - los items nuevos pasan directo a estado operativo (Despachado o "En Caja"), no vuelven a mesa
- El modulo usa `Aceptar cambios` como accion principal; `Enviar` no debe mostrarse ahi.
- El Sidebar preserva su estado resaltado (ej. "Mesas") mediante el parámetro de URL `origin`.

### 7. Mesas y órdenes
- `restaurant_tables` sigue siendo la entidad fisica real.
- El concepto de "divisiones" (`table_splits`) queda como soporte legacy.
- La arquitectura actual trata cada cuenta como una orden independiente vinculada a la mesa.
- El orden visible actual de órdenes de mesa vive en `orders.table_order_position`.
- `Mesas` usa `get_branch_tables_overview(...)` como lectura consolidada.
- Esa lectura ya ignora borradores vacios al resolver ocupacion operativa de mesa.
- `orders.table_name_snapshot` es el respaldo visual para listados historicos o desacoplados de mesa.
- Al mover una orden entre mesas, las vistas activas deben resolver primero `restaurant_tables.name` desde `orders.table_id`; `orders.table_name_snapshot` es solo fallback historico.
- **Gestión de Mesas con Pagos Anulados (2026-05-06):** Las mesas con pagos anulados mantienen su estado de ocupación y permiten el re-cobro directo desde el detalle de la orden.
- `Cerrar orden` para cuentas de mesa suelta `table_id` y mantiene la orden cobrable en `Caja`.
- El movimiento de items entre órdenes vive sobre `move_dine_in_order_items_between_orders(...)`.

### 8. Caja
- `Caja` se divide en:
  - apertura de **mi caja** (arqueo propio por cajero habilitado)
  - resumen/cierre de la apertura del usuario logueado
  - ordenes por cobrar (incluye Express despachadas pendientes de pago)
  - pagos realizados
  - movimientos de caja
  - anulacion de pagos
- **Ordenes por cobrar — Despacho primero (2026-07-10):**
  - `PayableOrdersList` recibe `PayableOrder` con `ready_to_collect` y `undispatched_units` desde `useCaja`.
  - Boton **Cobrar** verde solo si `ready_to_collect`; si no, boton rojo + `AlertDialog` sin abrir pago.
  - Regla uniforme para todas las filas de la lista cuando `workflow_mode = DISPATCH_THEN_CASH`.
  - `computeUndispatchedQuantity` en `src/lib/orderOperational.ts`; test `src/test/orderOperationalUndispatched.test.ts`.
- Si el usuario no tiene caja abierta (`userCajaIsOpen` / `shiftGate.cajaStatus !== OPEN`), la pagina muestra `OpenShiftForm` aunque otro cajero del turno ya haya abierto la suya.
- Navegacion: subitem deshabilitado `Abrir mi caja...` / `Reabrir mi caja...` segun `computeCajaAbrirTerminalState` en `src/components/nav/cajaTerminalNav.ts` (ya no redirige a `claim-terminal`).
-- **Modal de pago (unificado):**
  - `PaymentDialogV2`: UI estándar para cobrar (misma UI para todos los cajeros).
  - `PaymentDialogSecondary`: layout vertical para caja secundaria; comparte `usePaymentChargeFlow`.
  - **Transferencia bancaria (2026-07-12):** `TransferenciaPagoSection` abre `TransferenciaPagoDialog` con banco, numero de comprobante y valor; input principal de monto en solo lectura. Catalogo via `useBancosActivos`; admin en `BancosCrud`.
  - **Foto comprobante (opcional, 2026-07-14):** camara en el modal; subida a Storage `comprobantes-pago` + tabla `comprobantes_pago` en `payOrder` (`src/lib/comprobantePagoTransferencia.ts`).
  - **Denominaciones en cobro:** “Efectivo entregado” usa el catálogo global `denominations` activas (independiente de plantilla); el cálculo de cambio usa el inventario del cajero (`shift.denoms`).
  - Recibo: `PaymentReceipt` + `window.print`; estilos en `src/index.css`.
- **Capa de datos en cobro (`useCaja.payOrder`):**
  - Lecturas: `dbSelect` opción `skipLocalCache` para no persistir cada lectura en Dexie durante el cobro.
  - Escrituras: `dbInsert` / `dbInsertMany` opción `hotPath` (sin `.select()` ni cache local inmediato) en filas generadas con UUID en cliente (`payments`, `payment_items`, `cash_movements` en fallback).
  - Optimización BD (batch RPC): `register_payment_with_items` + `registrar_movimientos_caja_operativos_batch` reducen roundtrips.
  - Tras inserts, no se llama al RPC `sync_order_payment_state` desde el cliente: los triggers en `payments` / `payment_items` ya invocan `sync_order_payment_state_internal`.
  - Requiere migración `20260509180000_payment_items_sync_once_per_statement.sql` para que la sincronización por inserción en `payment_items` sea por **sentencia**, no por fila (evita N ejecuciones costosas por un solo cobro).
- Diferencia de arquitectura vigente:
  - el turno puede seguir abierto aunque la caja se cierre
  - `close_cash_register(...)` no equivale a cierre de turno
- El cálculo de cambio (`changeAmount`) en el diálogo de pago se unifica para agregar excedentes de todos los métodos de pago (efectivo, transferencia, etc.).
- **Transferencia — unicidad de comprobante:** `banco_id` + `numero_transferencia` no puede repetirse en todo el sistema (incluye pagos anulados). Validacion en modal (inline) y en `payOrder` / RPC.
- **Feedback sin popups:** Sonner esta silenciado (`src/lib/sonner-stub.ts` via alias Vite). No reintroducir toasts flotantes; usar mensajes inline en dialogos y estados de validacion existentes.
- **Consolidación en Caja:**
  - `PayableOrdersList` y `PaymentDialog` presentan los ítems agrupados por descripción y precio.
  - Esto facilita el cobro rápido al mostrar totales consolidados por producto idéntico.
- Cierre de turno desde `Admin > Turno`:
  - si el turno esta abierto, el encabezado visible muestra la apertura del turno usando `cash_shifts.opened_at`
  - antes de bloquear por borradores, se cancelan automaticamente borradores vacios/no enviados mediante `cancel_empty_draft_orders_for_branch(...)`
  - `list_branch_closure_blocking_orders(...)` no debe tratar como bloqueante un `DRAFT` sin pagos ni items operativos
  - si hay ordenes especiales pendientes con valor operativo `$0`, la UI debe pedir confirmacion antes de cerrar
  - si el usuario continua, esas ordenes se marcan `PAID` y despues se invoca `close_cash_shift_with_tables(...)`
  - el conteo debe limitarse a ordenes que realmente bloquean cierre (`SENT_TO_KITCHEN`, `READY`, `KITCHEN_DISPATCHED` sin `paid_at`)
- La caja fisica se compone desde `cash_shift_denoms.qty_current`.
- `Pagos del turno` se calcula con el rango real del turno (`cash_shifts.opened_at` hasta `closed_at` o ahora). No debe cortarse por medianoche, porque un turno abierto puede cruzar de dia.
- Las plantillas de apertura viven en:
  - `cash_register_templates`
  - `cash_register_template_denoms`
- El resumen ya usa efectivo neto aplicado, no `tendered` bruto.
- **Integridad Financiera (2026-05-09):**
  - **Redondeo:** Todas las operaciones monetarias aplican `round(val, 2)` de forma centralizada.
  - **Validación de Apertura:** El cajero debe tener caja abierta (`shiftGate.cajaStatus === OPEN`). El cobro lista todas las `denominations` activas; al registrar efectivo, `registrar_movimiento_caja_operativo` actualiza o crea filas en `cash_shift_denoms` del cajero autenticado.
  - **Exclusión de Cancelados:** Los ítems anulados o en proceso de anulación no suman al saldo de la orden ni al resumen de caja.
  - Se aplica redondeo financiero centralizado para evitar errores de punto flotante en el "Cuadre de caja".

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
  - **Trazabilidad y Auditoría (2026-05-09):** Cada anulación de pago (parcial o total) inserta un registro en `order_cancellations` y actualiza `orders.notes` con un marcador de rastro `VOIDED_PAYMENT`, el ID del supervisor y el motivo.
  - re-cobro sobre la misma orden tras anular (mismo `order_code` / `order_number`); marcador `VOIDED_PAYMENT_REOPEN`. Historicas legacy con `VOID_SUCCESSOR_ORDER` siguen preservadas como `CANCELLED`.
  - En Pagos del Turno: Anular si pagado, Cobrar si anulado (misma orden).
  - `recalculate_check_balance(...)` sigue preservando historicas legacy `VOID_SUCCESSOR_ORDER` como `CANCELLED`.
- No se debe permitir anulacion operativa de pago sobre una orden `KITCHEN_DISPATCHED`.

### 11. Despacho
- Pagina: `src/pages/Despacho.tsx`; acceso: `src/hooks/useDispatchAccess.ts`; datos: `src/hooks/useDispatchOrders.ts`; tarjetas: `src/components/dispatch/DispatchCardBase.tsx`.
- Solo ordenes elegibles con cobro activo y cantidades pendientes de despacho; Express usa criterio distinto (despacho antes de cobro) pero comparte pestaña con Para llevar.
- **Consolidacion visual de lineas (2026-07-08):** items identicos (producto, precio, modificadores, nota) se agrupan en una fila con cantidad sumada (`src/lib/dispatchItemConsolidation.ts`). Despacho parcial reparte cantidades entre lineas `order_items` originales via `buildDispatchAllocations`.
- **Despachar todo:** `dispatchOrder` con `operation_type: 'total'` y `p_items: []`.
- **Rendimiento:** `get_batch_order_operational_snapshots` (migracion `20260602140000`) + actualizacion optimista e invalidacion diferida de React Query.
- Modo `SPLIT`: filtro por `dispatch_assignments`; `EXTRA` cuenta como `TABLE` en asignaciones.

### 12. Comprobantes de transferencia
- `PaymentDialog` puede preparar una sesion provisional de pago con comprobante.
- Los pagos por transferencia en caja persisten `payments.banco_id` y `payments.numero_transferencia` ademas del monto (`amount`); ver `TransferenciaPagoDialog` y migraciones `20260712220000`, `20260713050000`.
- Persistencia:
  - `payment_capture_requests`
  - `payment_proofs`
- Procesamiento:
  - Storage privado `payment-proofs`
  - OCR basico opcional con `tesseract`
- `proof_capture_backend` concentra captura, subida, analisis y aprobacion/rechazo.

### 13. Clientes, campañas y promociones (2026-06-11+)

#### Clientes (comensales)
- Tabla `clientes` independiente de `profiles` / Auth.
- Rutas admin: `/clientes` (CRUD con validación en `src/lib/clientesValidacion.ts`).
- Vinculo transaccional: `orders.cliente_id` (nullable), asignado en cobro o al confirmar promoción.

#### Cobro — selección de cliente
- Hook compartido: `usePaymentClienteSelection` (`OrdenClienteVinculable`: `id` + `cliente` opcional).
- UI compartida: `PaymentClienteCard` en `PaymentDialogV2` (opcional) y en `PrediccionOrdenDialog` (requerido).
- Búsqueda en catálogo por cédula, nombre o correo; alta con `ClienteFormulario`.

#### Campañas (administración)
- Rutas: `/campanas`, `/campanas/:campanaId` (redirección legacy `/admin/campanas` → `/campanas`).
- Servicios: `campanasPromocionalesDb.ts`; validación: `campanasValidacion.ts`.
- Modelo: `campanas_promocionales` con `cartelera_ofertas` (JSON: `id_oferta`, `descripcion`, `bloqueo_at`, `cuota`, `resultado`) y `ofertas_cumplidas`.
- Varias campañas pueden tener `activa = true` a la vez.
- Cierre por oferta: RPC `cerrar_oferta_campana(campana_id, oferta_id, es_ganadora)`; permiso `puede_gestionar_campanas_promocionales` (admin global o admin sucursal con MANAGE en BD; menú Campañas: global admin o `admin_global` MANAGE).
- Legacy global `cerrar_ofertas_campana(jsonb)` sigue en BD; la UI operativa usa cierre individual.

#### Promociones (operativo)
- Ruta: `/promociones` (`Promociones.tsx` + `PromocionesCrud`).
- Gate: `useBranchShiftGate().puedeRegistrarPromociones` ← RPC `usuario_puede_registrar_promociones`.
- Hook: `usePromociones` — `listarCampanasActivas`, campaña seleccionada, `listarOrdenesElegiblesPromociones`.
- Elegibilidad (`prediccionesClientesDb.ts` + `promocionesElegibilidad.ts`):
  - Turno: `cash_shift_id` o pagos con `payments.shift_id` del turno abierto.
  - Cobro total: `orders.paid_at IS NOT NULL` (no solo `status = 'PAID'`).
  - Consumo: `special_total_manual` → `orders.total` → suma pagos activos (excluye notas `VOIDED`/`REVERSED`/transfer pending).
  - Sin fila en `predicciones_clientes` para esa `campana_id`.
- Una orden puede participar en **cada** campaña activa como máximo una vez (`UNIQUE (orden_id, campana_id)` tras `20260611180000`).
- Etiquetas de tipo de orden en tarjetas: `getOrderTypeLabel` (`DINE_IN` → Mesa, etc.).

### 14. Usuarios
- Crear/editar usuario incluye datos de contacto extendidos: nombres, apellidos, **alias**, cedula, direccion, telefono.
- `profiles.alias`: identificador operativo unico (solo letras y numeros, sin `@`), visible en todo el sistema operativo.
- `profiles.username`: credencial de login interna; convive con `alias`.
- `profiles.first_name` y `profiles.last_name` son datos legales/administrativos.
- `profiles.full_name` queda como compatibilidad legacy y debe reflejar `first_name` mediante `sync_profile_full_name()`.
- Login: correo, `username` o `alias` (Edge Function `login-with-identifier`).
- En operacion y reportes mostrar **alias** (`getUserDisplayName`); en admin nombre real + alias; en menu/cuenta alias arriba y nombre real abajo.
- La sucursal es opcional para operativos (Sin sucursal es valido) y obligatoria para supervisores.
- El acceso se deriva del turno habilitado para operativos sin sucursal fija.

## Componentes y hooks clave
- Catalogo:
  - `src/hooks/useMenuTree.ts`
  - `src/hooks/useFrequentProducts.ts`
  - `src/components/order/MenuNavigator.tsx`
  - `src/components/order/FrequentProductCards.tsx`
  - `src/components/admin/MenuNodesCrud.tsx`
  - `src/components/admin/FrequentProductsAdmin.tsx`
  - `src/lib/compositeMenuTree.ts`
- Ordenes y mesas:
  - `src/hooks/useOrder.ts`
  - `src/hooks/useOrdersByStatus.ts`
  - `src/hooks/useCancellation.ts`
  - `src/hooks/useTablesWithStatus.ts`
  - `src/components/order/OrderItemsList.tsx`
  - `src/components/order/OrderDetailPanel.tsx`
  - `src/components/order/AddItemDialog.tsx`
  - `src/components/order/MergeSplitOrdersDialog.tsx`
  - `src/components/order/CancelOrderDialog.tsx`
  - `src/pages/Ordenes.tsx` (`fetchBranchModifiersCatalog`, `resolveModifierNodeIds`, `handleSelectMenuProduct`)
  - `src/hooks/useNodeModifiers.ts` (admin: herencia por nodo)
  - `src/pages/Mesas.tsx`
- Caja:
  - `src/hooks/useCaja.ts`
  - `src/lib/orderOperational.ts` (`computeUndispatchedQuantity`, snapshots batch)
  - `src/components/caja/PayableOrdersList.tsx` (boton Cobrar verde/rojo en Despacho primero)
  - `src/lib/cajaPaymentUi.ts` (flags UI de pago)
  - `src/lib/cajaDenominations.ts` (`catalogToPaymentDenoms`)
  - `src/components/caja/usePaymentChargeFlow.ts` (logica compartida V2/Secondary)
  - `src/components/caja/PaymentDialog.tsx`
  - `src/components/caja/PaymentDialogV2.tsx`
  - `src/components/caja/PaymentDialogSecondary.tsx`
  - `src/components/caja/TransferenciaPagoSection.tsx`
  - `src/components/caja/TransferenciaPagoDialog.tsx`
  - `src/lib/transferenciaPago.ts`
  - `src/lib/transferenciaDuplicada.ts`
  - `src/hooks/useBancosActivos.ts`
  - `src/components/admin/BancosCrud.tsx`
  - `src/lib/sonner-stub.ts` (toasts Sonner deshabilitados globalmente)
  - `src/components/caja/PaymentReceipt.tsx`
  - `src/hooks/useBranchShiftGate.ts` (`primaryCashierId`)
  - `src/components/admin/ShiftSetupAdmin.tsx` (config caja por turno)
  - `src/services/DatabaseService.ts` (`dbSelect` `skipLocalCache`, `dbInsert`/`dbInsertMany` `hotPath`)
  - `src/components/caja/CompletedPaymentsList.tsx`
  - `src/components/caja/PaymentReversalModal.tsx`
  - `src/components/caja/ShiftSummary.tsx`
  - `src/components/caja/CashRegisterOpeningHistory.tsx`
  - `src/components/caja/OpenShiftForm.tsx`
  - `src/pages/Caja.tsx`
- Despacho:
  - `src/pages/Despacho.tsx`
  - `src/hooks/useDispatchAccess.ts`
  - `src/hooks/useDispatchOrders.ts`
  - `src/components/dispatch/DispatchCard.tsx`
  - `src/components/dispatch/DispatchCardBase.tsx`
  - `src/lib/orderOperational.ts` (snapshots batch)
- Extra:
  - `src/pages/Extra.tsx`
  - `src/lib/extraOrders.ts`
- Clientes y promociones:
  - `src/services/clientesDb.ts`
  - `src/services/campanasPromocionalesDb.ts`
  - `src/services/prediccionesClientesDb.ts`
  - `src/lib/promocionesRecibo.ts` (QR condicional en ticket)
  - `src/lib/campanasValidacion.ts` (`ofertaDisponibleParaRegistro`, `campanaTieneOfertasRegistrables`)
  - `src/hooks/usePromociones.ts`
  - `src/hooks/usePaymentClienteSelection.ts`
  - `src/components/caja/PaymentClienteCard.tsx`
  - `src/components/promociones/PromocionesCrud.tsx`
  - `src/components/promociones/PrediccionOrdenDialog.tsx`
  - `src/components/campanas/*`
  - `src/lib/promocionesElegibilidad.ts`
- Shell y gate:
  - `src/components/AppLayout.tsx`
  - `src/components/BottomNav.tsx`
  - `src/hooks/useBranchShiftGate.ts`
  - `src/components/nav/useVisibleNavItems.tsx` (grupo PROMOCIONES)
  - `src/lib/benignAsyncErrors.ts` (abortos benignos de auth/Web Locks en tablet)
  - `src/integrations/supabase/client.ts` (`auth.lock` no-op en Capacitor/WebView)
  - `src/contexts/AuthContext.tsx`
- Usuarios e identidad:
  - `src/lib/userDisplay.ts` (`getUserAlias`, `getUserDisplayName`, `getUserRealName`, `buildUserDisplayMap`)
  - `src/components/admin/UsersCrud.tsx`, `AddUserDialog.tsx`, `EditUserDialog.tsx`
  - `supabase/functions/login-with-identifier`, `create-user`, `void-payment`

### 15. Autopedidos QR en mesa (2026-07-16)

Permite que el comensal escanee un QR en la mesa y pida desde el celular. El pedido entra como borrador pendiente de aprobación del personal.

#### Arquitectura por capas

| Capa | Responsabilidad |
|------|-----------------|
| **BD / RPC** | Tokens, validación turno `OPEN`, creación orden+ítems, aprobación/rechazo |
| **Admin** | Generar QR por sucursal (cantidad configurable), imprimir |
| **Web pública** | Menú TABLE, carrito, envío anónimo |
| **POS** | Badge pendientes, panel aprobar/rechazar |

#### Ruta pública del cliente
- URL: `/qr-pedido/:token_seguro` (definida en `App.tsx` fuera de `AuthGate`).
- Página: `src/pages/QrPedido.tsx`.
- Mismo cliente Supabase (`integrations/supabase/client.ts`); sesión `anon` implícita.
- `InstallPrompt` omitido en `/qr-pedido` (como `/promociones/registro`).
- Layout: standalone mobile-first (`max-w-md`, `pt-safe`, `safe-bottom`).

#### Flujo UI del comensal (`QrPedido.tsx`)
1. `resolver_contexto_token_qr_mesa` — valida token, resuelve sucursal/mesa/turno.
2. **Identidad** (opcional): cédula → buscar/registrar en `clientes`.
3. **Menú:** categorías raíz `TABLE`; productos por categoría; **sin** pestañas Con envase / A granel.
4. **Producto:** cantidad, modificadores heredados, nota opcional.
5. **Carrito** → `crear_orden_autopedido_qr`.
6. **Éxito:** mensaje inline; puede pedir de nuevo en la misma sesión.

#### Admin — generación QR
- `src/components/admin/QrMesasAdmin.tsx` — pestaña **Mesas QR** en `Admin.tsx`.
- Input **Cantidad de mesas** (1–100) + botones Generar / Imprimir.
- Flujo: `ensure_branch_table_capacity` → `generar_tokens_qr_mesas_sucursal`.
- QR renderizado con librería `qrcode` (data URL); no `qrcode.react` en runtime admin.
- URL impresa: `{origin}/qr-pedido/{token_seguro}`.

#### POS — aprobación operativa
- `src/hooks/useAutopedidosQrPendientes.ts` — `contar_autopedidos_pendientes`, `listar_autopedidos_pendientes`.
- `src/components/autopedidos/AutopedidosQrPanel.tsx` — Sheet lateral; agrupa por mesa.
- `AutopedidosQrBadgeButton` en `AppLayout` (móvil) y `SidebarNav` (desktop).
- **Aprobar:** `aprobar_autopedido_qr` → asigna `created_by` al aprobador → `submit_order_draft_items`.
- **Rechazar:** `rechazar_autopedido_qr` → cancela ítems y orden.

#### Servicio frontend
- `src/services/autopedidosQrDb.ts` — wrappers RPC para cliente anónimo y staff autenticado.

#### Integración con flujo canónico de orden
- Pre-aprobación: `DRAFT` + `estado_aprobacion_qr = 'PENDIENTE'` (no visible en pestañas operativas normales hasta aprobar).
- Post-aprobación: `SENT_TO_KITCHEN` (En Caja) — mismo flujo que mesa creada por mesero.
- `created_by` se asigna al usuario que aprueba (no al comensal anónimo).

### Actualizacion Jul 15–16, 2026
- **Autopedidos QR:** implementación completa cliente + admin + POS. Migraciones `20260716000000`, `20260716010000`. Ver sección **15. Autopedidos QR en mesa**.

## Principios vigentes
1. Refactor incremental, no corte brusco del modelo legacy.
2. Seguridad y reglas operativas en backend/BD primero.
3. `menu_nodes` manda la estructura; `products` sigue cerrando la transaccion.
4. Si una regla cruza `Ordenes`, `Despacho`, `Caja` y `Mesas`, debe apoyarse en snapshot operativo comun.
5. Si se toca anulacion de pagos, revisar tambien reapertura de ordenes, stock de denominaciones y estado visible de mesa.
6. Si se toca `Unir/Dividir`, preservar pagos, historial y numeracion operativa.
7. Si se toca `Editar Orden`, revisar juntos buffer UI, `locked_for_editing`, visibilidad de controles y compromiso final (Aceptar cambios).
8. Si se toca reporteria de caja, revisar juntos filtrado temporal, `cash_register_openings`, `cash_shift_denoms` y reimpresion por apertura/turno.
9. Si una vista muestra ordenes, debe mostrar tambien el usuario creador de `orders.created_by` resolviendo **`profiles.alias`** via `src/lib/userDisplay.ts` (no nombre real).
10. Si se toca session lock / sesion doble:
    - Revisar `cash_shift_users.can_double_session`, `user_has_double_app_session_permission`, `register_my_single_session`.
    - Revisar slots `profiles.current_app_session_id` y `current_app_secondary_session_id`.
    - No borrar `authOwnedSingleSession` en parpadeos de auth (solo signOut / kick concurrente).
    - Reservar id local antes del RPC; validar slots sin depender de cache offline/`dbSelect`.
    - Tras `apply_shift_caja_configuration`, reaplicar flags de sesion doble si el cliente los gestiona aparte de caja.
11. Si se toca envio/cobro/despacho de ordenes, revisar `submit_order_draft_items(...)`, `sync_order_payment_state_internal(...)`, `useCaja` y la UI de `Ordenes`.
12. Si se toca eliminacion completa de orden, preservar confirmacion previa y validar que todos los items sigan en borrador o en caja.
13. **Agrupamiento Visual:** Toda modificación en la lógica de listado de ítems debe preservar la consolidación por descripción y precio para mantener la limpieza visual de la orden.
14. **Flujo Operativo Configurable:** Se define por sucursal (`branches.workflow_mode`): Primero a caja (`CASH_THEN_DISPATCH`), donde se debe pagar para despachar, o Primero a despacho (`DISPATCH_THEN_CASH`), donde se despacha antes de cobrar. La anulacion de pago solo aplica sobre ordenes no despachadas.
15. **Permisos Operativos:** El botón "Editar orden" y la barra de búsqueda de órdenes deben ser accesibles para usuarios con capacidad `canOperateOrders` para permitir flexibilidad en la gestión de mesas.
16. **Despacho sin duplicados:** Toda modificacion de `useDispatchOrders` debe conservar una sola tarjeta/fila por orden pagada; no separar la misma orden por tiempos de envio de items.
17. **Tarjetas Para llevar / Especial:** Toda modificacion de `ParaLlevar`, `OrdenEspecial` o `useOrder` debe preservar `+` permanente, borradores vacios ocultos, orden visual consecutivo, codigo completo una sola vez, usuario creador y formato compatible con Mesa.
18. **Cobro V2 y BD:** Cambios en `payOrder` o en triggers de `payment_items` deben mantener coherencia con `sync_order_payment_state_internal`; si se insertan muchos `payment_items` en un lote, la BD debe sincronizar la orden **una vez por sentencia** (migración `20260509180000`).
19. **`Ordenes.tsx`:** Usar lista de ítems defensiva (`order?.items ?? []`) en el contenido del detalle para tolerar órdenes parciales en caché.
20. **Plantilla vs cobro:** No usar solo `shift.denoms` para botones de monedas/billetes en cobro; usar catálogo `denominations`. No mezclar arqueo de plantilla con lo que puede pagar el cliente.
21. **Caja unificada:** No reintroducir UI/flags de “caja secundaria” ni filtros de alcance por `secondary_caja_*`.
22. **Extra:** Requiere mesa obligatoria al crear. Tras cobrar queda `PAID` y requiere despacho manual en Despacho (Mesa/Todos); cierre con `close_extra_order` o desaparece automáticamente al despacharse. No reactivar auto-despacho en `sync_order_payment_state_internal` sin acuerdo de producto.
23. **Despacho — pestañas:** Mantener pestaña unificada Para llevar/Express; Extra en Mesa y Todos; no reintroducir pestaña Express separada.
24. **Productos frecuentes:** Cambios en admin deben respetar `context` y unique `(branch_id, context, display_order)`; UI en caja usa 1 fila si cabe, max 2 filas con scroll.
25. **Promociones:** Mantener selector de campaña cuando hay varias activas; no volver a `obtenerCampanaActiva` con `limit 1` en operativo.
26. **Cliente en promociones/cobro:** Reutilizar `PaymentClienteCard`; no duplicar flujo solo por cédula de 10 dígitos.
27. **Elegibles:** Filtrar predicciones por `campana_id`; criterio de pago = `paid_at`, no solo cabecera `PAID`.
28. **Alias de usuario:** En operacion y reportes usar `profiles.alias` via `userDisplay.ts`; no reintroducir nombre real ni prefijo `@` en listados operativos.
29. **Modificadores en orden:** Resolver herencia con `parentByNodeId` del catalogo; no asumir `ancestor_ids` en nodos de frecuentes; invalidar `branch-modifiers-catalog` tras cambios en admin; preservar secuencia anti-carrera en `handleSelectMenuProduct`.
30. **Auth tablet:** Mantener supresion de `AbortError` benigno de locks; no mostrar overlays de debug globales por rechazos de `navigator.locks`.
31. **Despacho primero — cocina pendiente:** No invalidar `dispatch-orders` al editar lineas En despacho; solo al confirmar **Enviar a cocina**. Usar `kitchenPendingChanges.ts` y `applyKitchenPendingItemChanges`.
32. **Despacho — consolidacion:** Agrupar lineas identicas en tarjeta expandida con `consolidateDispatchOrderItems`; despacho parcial con `buildDispatchAllocations`.
33. **Extra vs workflow:** Ocultar `/extra` en nav cuando `workflow_mode = DISPATCH_THEN_CASH`.
34. **Caja Despacho primero:** Respetar `ready_to_collect`; no abrir cobro con items sin despachar; validar en `payOrder`.
35. **QR promocion:** No imprimir sin campaña activa y ofertas registrables; usar `promocionesRecibo.ts` y migraciones `20260709200000` / `20260709210000`.
36. **Staging cocina:** Reconciliar ids `temp-*`; aumentos en lineas enviadas → DRAFT con diferencia; migracion `20260709220000` para envio post-despacho.
37. **Transferencia bancaria:** Modal con banco/numero/valor; unicidad global; migraciones `20260712220000`, `20260713050000`; sin toasts Sonner.
39. **Autopedidos QR:** Menú cliente solo TABLE; aprobar vía `aprobar_autopedido_qr`; migraciones `20260716000000` + `20260716010000`; sin Sonner en `/qr-pedido`.

### Actualizacion Jul 15–16, 2026
- **Cobro por transferencia:** `TransferenciaPagoSection`, `TransferenciaPagoDialog`, tabla `bancos`, columnas en `payments`, Admin > Bancos.
- **Unicidad comprobante:** indice + validacion RPC + mensaje inline en modal.
- **Sin popups Sonner:** alias Vite a `src/lib/sonner-stub.ts`.

### Actualizacion Jul 9–10, 2026
- **Cobro bloqueado hasta despacho completo (DF):** `PayableOrdersList`, `useCaja`, `computeUndispatchedQuantity`.
- **QR ticket condicional:** `promocionesRecibo.ts`, `campanasValidacion.ts`, migraciones token promocion Jul 9.
- **Cocina post-despacho y staging:** `20260709220000`, `reconcileKitchenStagedItems`, diff de cantidad en lineas enviadas.
- **Monitoreo Global:** hooks/realtime/polling 60 s.

### Actualizacion Jul 8, 2026
- **Staging cocina en Despacho primero:** Ediciones locales no afectan Despacho hasta **Enviar a cocina**; boton con delta monetario vs ultimo envio.
- **Secciones En despacho / Despachados:** `OrderItemsList.splitDispatchSections` en vista de orden.
- **Sin Editar orden en `DISPATCH_THEN_CASH`:** boton oculto; redirect `from=editar`; items despachados bloqueados.
- **Consolidacion en Despacho:** `dispatchItemConsolidation.ts` + integracion en `useDispatchOrders.ts`, `Despacho.tsx`, `Servir.tsx`.
- **Extra oculto en Despacho primero:** `useVisibleNavItems`, `usePreferredHomePath`, redirect en `Extra.tsx`.
- **RPC `remove_order_item_line`:** migraciones `20260707240000`, `20260707241000`; usado al aplicar cambios de cocina pendientes.
- **Dev:** `showSystemAlert` en `src/lib/systemAlert.ts` (fix Fast Refresh).

### Actualizacion Jul 7, 2026
- **Modificaciones en modal de producto:** Catalogo con `parentByNodeId`, chunks de 200, `resolveModifierNodeIds`, secuencia `productSelectSeqRef`, sin cache `menu-product-lookup`, invalidacion de catalogo en admin.
- **Auth Web Locks en tablet:** `benignAsyncErrors.ts`, `auth.lock` no-op, silencio en `main.tsx`, `catch` en validacion de sesion.

### Actualizacion Jun 28, 2026
- **Alias de usuario:** Columna `profiles.alias`, migracion `20260628120000_add_profile_alias.sql`, helper `src/lib/userDisplay.ts`, login con correo/usuario/alias, reportes y caja muestran alias.

### Actualizacion May 23, 2026
- **Ordenes Especiales:** Se corrigio el trigger de pago para marcar como PAID a las ordenes especiales cuando alcanzan el monto manual configurado. Tambien se actualizo useReportesOnlineData.ts para que aparezcan bajo el tipo SPECIAL en los reportes y filtros, y dejen de estar ocultas como Mesa o Extra.
- **UI/UX Monitoreo y Tarjetas:** Ajustes en MonitoreoGlobal.tsx para hacer el embudo mutuamente excluyente en la columna Generadas. Se implemento grid de 2 columnas para tarjetas en vista de tablet y se corrigio el truncado de fecha/hora de los items.
- **Logo y PWA:** Se elimino el filtro CSS que ocultaba el color del logo en SidebarNav.tsx. Se aplico enmascarado circular (rounded-full object-cover) en Login, Sidebar y AppLayout. Se actualizaron los assets de PWA icon-192.png y icon-512.png con la nueva imagen cargada.

### Actualizacion May 31, 2026
- **Aplicacion Nativa y Nube:** La aplicacion ahora funciona mediante un contenedor nativo (Capacitor) instalado en las tablets, configurado (`capacitor.config.ts`) para consumir directamente la aplicacion desde Vercel (servidor en la nube).
- **Impresion Nativa ESC/POS:** Implementacion de un puente nativo de impresion termica usando `@deedarb/capacitor-tcp-socket`. Esto permite enviar comandos ESC/POS binarios directamente desde el telefono/tablet a la IP de la impresora en la red local (`192.168.1.100:9100`), resolviendo el bloqueo de mixed content y limitaciones de CORS de navegadores web. Se aplico un parche local al codigo Java del plugin para asegurar retrocompatibilidad con versiones de Android menores a la 8.0, y un retraso temporal de 500ms al cerrar el socket TCP para prevenir perdida de datos en procesadores ultrarrapidos.
- **Politicas de Seguridad (RLS):** Se introdujo la migracion `20260530204919_allow_caja_update_orders.sql` para permitir a los usuarios con rol de `caja` (cajeros sin capacidad de crear mesas) realizar actualizaciones en las ordenes (especificamente `orders.special_total_manual`), asegurando que puedan cobrar y manipular valores manuales en ordenes especiales sin requerir permisos de mesero.
- **Area Segura (Safe Area):** Ajustes en `AppLayout.tsx` usando `env(safe-area-inset-top)` y `viewport-fit=cover` en `index.html` para evitar que las pantallas modernas edge-to-edge superpongan la barra de estado de Android/iOS sobre la UI de la aplicacion movil.

### Actualizacion Jun 11, 2026
- **Consulta de Promociones:** Implementacion del modulo /promociones/consulta para auditar participaciones en campanas.
- **Auditoria Financiera de Promociones:** Se corrigio el origen de datos financieros, calculando el "Total de las Ordenes" sumando directamente los registros de payments en lugar de la columna desactualizada orders.total.
- **Nuevos KPIs y Exportacion:** Se integraron metricas dinamicas de "Total Consumo Recibido" y "Credito Potencial" en la UI (disposicion de 6 tarjetas en fila) y exportacion CSV granular (incluyendo filtrado combinado por campana y oferta).

### Actualizacion Jun 13, 2026
- **Configuración Dinámica de Impresoras:** Se migró la configuración de IP y puerto de la impresora de variables `.env` estáticas a campos editables en la tabla `public.branches` (`printer_ip`, `printer_port`). El frontend recupera esta información en el contexto global (`BranchContext.tsx`), la guarda en `localStorage` (`activePrinterIp`, `activePrinterPort`) y la consume dinámicamente en el helper de impresión nativa `thermalPrint.ts`, manteniendo el `.env` como fallback.
- **Formato de Ticket ESC/POS de Alto Rendimiento:** 
  - **Estructuración con Font B:** El cuerpo del ticket, detalle de productos, totales y promociones utilizan la fuente compacta Font B (activada combinando `ESC ! 0x01` y `ESC M 1` para soporte universal de impresoras genéricas de 80mm). Se implementó un espaciado vertical de 40 puntos para optimizar la legibilidad.
  - **Margen de Detalle e Indentación:** Todo el detalle de los productos y montos se desplaza a la derecha aplicando un margen izquierdo estático de 8 caracteres, limitando el ancho neto de impresión de productos a exactamente 40 caracteres.
  - **Prevención de Pérdida de QR y Atascamiento:** Para evitar cortes abruptos de imágenes de códigos QR y asegurar que el cortador actúe exactamente al terminar el ticket, el flujo cambia temporalmente la fuente a Font A y restaura el espaciado de línea por defecto (`lineSpacing(null)`) antes de emitir los comandos de avance (`feed`) y corte (`cut`).

### Actualizacion Jul 2, 2026
- **Cobro de Órdenes Especiales:** Se corrigió la lógica de cobro para permitir registrar transacciones de órdenes especiales que no tienen un total manual configurado (se calculan dinámicamente usando el total real de los ítems en su lugar). Se resolvieron errores de referencia de variables y se actualizó el mapeo de `payableOrder` tanto en el hook de Caja como en la vista de Órdenes.
- **Rediseño Móvil del Modal de Cobro (Dividir Pago):** Ajuste de altura dinámica a `94dvh` en móviles portrait, reducción de tipografías, reorientación dinámica de flechas arriba/abajo según viewport vertical, y eliminación de textos de instrucción redundantes.
- **Precio e Inputs de Items en Tiempo Real:** Implementación del componente `PriceInput` con debouncing de 500ms en `OrderItemsList.tsx` para sincronizar en tiempo real los cambios del precio con los totales del pedido sin sobrecargar la base de datos.
- **Cabecera Sticky y UI en Ordenes:** Se fijó la cabecera de la mesa/orden en la parte superior (`sticky top-[56px] md:top-0 z-20`) con un fondo opaco degradado para evitar que los elementos que hacen scroll se transparenten por detrás. Se eliminó la pestaña "A granel" en órdenes especiales y se removió el botón flotante inferior en móviles para delegar la interacción al icono de bandeja superior.
- **Limpieza de UI en Despacho:** Eliminación de los contadores detallados `Env:`, `Desp:`, `Falt:`, `Canc:` en las tarjetas de despacho de todas las categorías.
- **Persistencia de Sesión Ampliada:** Se extendió el tiempo de cierre de sesión por inactividad de 40 minutos a exactamente 1 hora (`60` minutos) en `AuthContext.tsx`.
