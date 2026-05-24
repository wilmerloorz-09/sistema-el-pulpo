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
- La anulacion de pago solo aplica sobre una orden pagada no despachada; al anular, la orden original queda historica `CANCELLED` con `VOID_SUCCESSOR_ORDER` y la sucesora queda con numero nuevo en `SENT_TO_KITCHEN`/En Caja.

## Capas funcionales

### 1. Identidad y contexto
- Auth: Supabase Auth.
- Perfil operativo: `profiles`.
- Sucursal activa: `profiles.active_branch_id`.
- Flujo operativo global: todas las sucursales cobran primero en Caja y luego pasan a Despacho.
- El frontend no debe asumir permisos solo por layout; la validacion final vive en BD/RPCs.

### 2. Permisos y gate operativo
- Capa 1: permisos efectivos por modulo/sucursal.
- Capa 2: capacidades por turno en `cash_shift_users`.
- `get_my_branch_shift_gate(...)` sigue siendo el gate principal para habilitar vistas operativas.
- El campo `caja_status` de ese gate es **por usuario** (`get_user_caja_status`), no el estado global del turno.
- `profiles.current_app_session_id` y `cash_shift_users.last_session_id` agregan control de sesion activa. (Utilizado tambien en `Monitoreo Global` para ver quien esta operando en linea y en caja).
- `cash_shift_users.caja_session_slots` y `cash_shifts.max_caja_sessions` limitan terminales simultaneas; varios usuarios pueden tener `can_use_caja` en el mismo turno.
- `cash_shift_users.can_double_session` permite una segunda sesion de app para el **mismo** usuario con Caja; se registra en `profiles.current_app_secondary_session_id`.
- Cada cajero abre/cierra su propia `cash_register_openings` y mantiene `cash_shift_denoms` separadas por `cashier_id`.
- Por turno puede configurarse **caja principal** (`primary_cashier_id`) y **cajas secundarias** con plantilla de arqueo (`apply_shift_caja_configuration`). Ya no se utiliza `register_role` en `cash_shift_users`.
- Cajeros secundarios filtran `Por cobrar` con `orderVisibleToSecondaryCashier` (`src/lib/secondaryCajaPayable.ts`): solo ordenes propias; Extra siempre; Para llevar/Express segun `secondary_caja_takeout_enabled` / `secondary_caja_express_enabled`.
- `useBranchShiftGate` expone `isSecondaryCashier` para elegir UI de cobro secundaria.
- **Monitoreo Global (`/admin/monitoreo-global`)**: Interfaz para Administradores Generales que consolida todos los turnos abiertos en tiempo real usando subscripciones a PostgreSQL (`supabase_realtime`) y un intervalo de respaldo (fallback) de 15s.

### 3. Catalogo
- Fuente visual principal: `menu_nodes`.
- Alcances operativos:
  - `TABLE`
  - `TAKEOUT`
  - `BULK`
- Ordenes `EXPRESS` usan el mismo arbol de menu que para llevar pero con flujo **despacho -> cobro** (ver `src/lib/orderFlow.ts`).
- Ordenes `EXTRA` usan menu mesa (`TABLE`) sin PLATOS, sin mesa fisica, flujo **caja -> despacho manual** (como mesa). Tras cobrar quedan `PAID` hasta despacho en modulo Despacho (pestañas Mesa/Todos); cierre con `close_extra_order` desde `/extra`.
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
- Disponibilidad por nodo: `menu_node_modifiers`.
- Seleccion real del item: `order_item_modifiers`.

### 5. Ordenes
- `useOrder`, `useOrdersByStatus` y `get_order_operational_snapshot(...)` sostienen la lectura operativa comun.
- Las lecturas de orden deben incluir `orders.created_by` cuando la pantalla visualiza ordenes.
- El nombre del creador se resuelve con `src/lib/userDisplay.ts` desde `profiles.first_name`, `full_name`, `username`, `email` o `Usuario`.
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

### 6. Editar Orden
- `Editar Orden` es una arquitectura buffered y **In-Situ**.
- El boton `Editar orden` solo debe estar activo para ordenes en `SENT_TO_KITCHEN`/En Caja.
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
- Si el usuario no tiene caja abierta (`userCajaIsOpen` / `shiftGate.cajaStatus !== OPEN`), la pagina muestra `OpenShiftForm` aunque otro cajero del turno ya haya abierto la suya.
- Navegacion: subitem deshabilitado `Abrir mi caja...` / `Reabrir mi caja...` segun `computeCajaAbrirTerminalState` en `src/components/nav/cajaTerminalNav.ts` (ya no redirige a `claim-terminal`).
- **Modal de pago (tres variantes):**
  - `PaymentDialog`: selección de líneas/cantidades, splits por método, comprobante de transferencia preparado, confirmación y recibo.
  - `PaymentDialogV2`: caja **principal** (tablet/escritorio); total a cobrar, efectivo por denominaciones, transferencia; **Cobrar** → `payOrder.mutateAsync`.
  - `PaymentDialogSecondary`: cajeros **secundarios**; layout vertical compacto (móvil/tablet); sin dividir pago; misma lógica de cobro vía `usePaymentChargeFlow`.
  - **Denominaciones en cobro:** `paymentDenominations` = catálogo global `denominations` (`catalogToPaymentDenoms`); `drawerDenoms` = `shift.denoms` del cajero para calcular cambio. La plantilla de apertura solo define el arqueo inicial, no limita lo que el cliente puede entregar.
  - Flags en `src/lib/cajaPaymentUi.ts`: `USE_PAYMENT_DIALOG_V2`, `shouldUseSecondaryPaymentDialog`, `canOpenPaymentUiOnDevice` (secundaria cobra en teléfono sin exigir `isTablet10`).
  - `PayableOrdersList` y `Ordenes` eligen Secondary / V2 / V1 según rol.
  - Recibo: `PaymentReceipt` + `window.print`; estilos en `src/index.css`.
- **Capa de datos en cobro (`useCaja.payOrder`):**
  - Lecturas: `dbSelect` opción `skipLocalCache` para no persistir cada lectura en Dexie durante el cobro.
  - Escrituras: `dbInsert` / `dbInsertMany` opción `hotPath` (sin `.select()` ni cache local inmediato) en filas generadas con UUID en cliente (`payments`, `payment_items`, `cash_movements` en fallback).
  - Tras inserts, no se llama al RPC `sync_order_payment_state` desde el cliente: los triggers en `payments` / `payment_items` ya invocan `sync_order_payment_state_internal`.
  - Requiere migración `20260509180000_payment_items_sync_once_per_statement.sql` para que la sincronización por inserción en `payment_items` sea por **sentencia**, no por fila (evita N ejecuciones costosas por un solo cobro).
- Diferencia de arquitectura vigente:
  - el turno puede seguir abierto aunque la caja se cierre
  - `close_cash_register(...)` no equivale a cierre de turno
- El cálculo de cambio (`changeAmount`) en el diálogo de pago se unifica para agregar excedentes de todos los métodos de pago (efectivo, transferencia, etc.).
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
  - separacion de orden despues de anular pago: la orden original queda como historica `CANCELLED` con su numero original y marcador `VOID_SUCCESSOR_ORDER:<new_order_id>`, y la operacion activa pasa a una sucesora con nuevo numero y marcador `SUCCESSOR_OF_VOIDED_ORDER:<old_order_id>`.
  - la orden historica por anulacion no debe aparecer en Caja, Mesas ni Despacho como flujo activo; la sucesora es la unica cobrable.
  - `recalculate_check_balance(...)` debe preservar primero las historicas `VOID_SUCCESSOR_ORDER` como `CANCELLED`.
- No se debe permitir anulacion operativa de pago sobre una orden `KITCHEN_DISPATCHED`.

### 11. Despacho
- Pagina: `src/pages/Despacho.tsx`; acceso: `src/hooks/useDispatchAccess.ts`; datos: `src/hooks/useDispatchOrders.ts`; tarjetas: `src/components/dispatch/DispatchCardBase.tsx`.
- Solo ordenes elegibles con cobro activo y cantidades pendientes de despacho; Express usa criterio distinto (despacho antes de cobro) pero comparte pestaña con Para llevar.
- **Despachar todo:** `dispatchOrder` con `operation_type: 'total'` y `p_items: []`.
- **Rendimiento:** `get_batch_order_operational_snapshots` (migracion `20260602140000`) + actualizacion optimista e invalidacion diferida de React Query.
- Modo `SPLIT`: filtro por `dispatch_assignments`; `EXTRA` cuenta como `TABLE` en asignaciones.

### 12. Comprobantes de transferencia
- `PaymentDialog` puede preparar una sesion provisional de pago con comprobante.
- Persistencia:
  - `payment_capture_requests`
  - `payment_proofs`
- Procesamiento:
  - Storage privado `payment-proofs`
  - OCR basico opcional con `tesseract`
- `proof_capture_backend` concentra captura, subida, analisis y aprobacion/rechazo.

### 13. Usuarios
- Crear/editar usuario incluye datos de contacto extendidos: nombres, apellidos, cedula, direccion, telefono.
- `profiles.first_name` y `profiles.last_name` son los campos administrables para usuario.
- `profiles.full_name` queda como compatibilidad legacy y debe reflejar `first_name` mediante `sync_profile_full_name()`.
- En vistas compactas se muestra `Nombres` y nombre de usuario; cedula/telefono quedan para administracion o detalle.
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
  - `src/components/order/MergeSplitOrdersDialog.tsx`
  - `src/components/order/CancelOrderDialog.tsx`
  - `src/pages/Ordenes.tsx`
  - `src/pages/Mesas.tsx`
- Caja:
  - `src/hooks/useCaja.ts`
  - `src/lib/cajaPaymentUi.ts` (flags UI de pago y caja secundaria)
  - `src/lib/cajaDenominations.ts` (`catalogToPaymentDenoms`)
  - `src/components/caja/usePaymentChargeFlow.ts` (logica compartida V2/Secondary)
  - `src/components/caja/PaymentDialog.tsx`
  - `src/components/caja/PaymentDialogV2.tsx`
  - `src/components/caja/PaymentDialogSecondary.tsx`
  - `src/components/caja/PaymentReceipt.tsx`
  - `src/hooks/useBranchShiftGate.ts` (`isSecondaryCashier`, `primaryCashierId`)
  - `src/lib/secondaryCajaPayable.ts` (filtro Por cobrar caja secundaria)
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
- Shell y gate:
  - `src/components/AppLayout.tsx`
  - `src/components/BottomNav.tsx`
  - `src/hooks/useBranchShiftGate.ts`

## Principios vigentes
1. Refactor incremental, no corte brusco del modelo legacy.
2. Seguridad y reglas operativas en backend/BD primero.
3. `menu_nodes` manda la estructura; `products` sigue cerrando la transaccion.
4. Si una regla cruza `Ordenes`, `Despacho`, `Caja` y `Mesas`, debe apoyarse en snapshot operativo comun.
5. Si se toca anulacion de pagos, revisar tambien reapertura de ordenes, stock de denominaciones y estado visible de mesa.
6. Si se toca `Unir/Dividir`, preservar pagos, historial y numeracion operativa.
7. Si se toca `Editar Orden`, revisar juntos buffer UI, `locked_for_editing`, visibilidad de controles y compromiso final (Aceptar cambios).
8. Si se toca reporteria de caja, revisar juntos filtrado temporal, `cash_register_openings`, `cash_shift_denoms` y reimpresion por apertura/turno.
9. Si una vista muestra ordenes, debe mostrar tambien el usuario creador de `orders.created_by` usando la resolucion central de perfil.
10. Si se toca session lock, revisar la sesion principal y la secundaria permitida por `cash_shift_users.can_double_session`.
11. Si se toca envio/cobro/despacho de ordenes, revisar `submit_order_draft_items(...)`, `sync_order_payment_state_internal(...)`, `useCaja` y la UI de `Ordenes`.
12. Si se toca eliminacion completa de orden, preservar confirmacion previa y validar que todos los items sigan en borrador o en caja.
13. **Agrupamiento Visual:** Toda modificación en la lógica de listado de ítems debe preservar la consolidación por descripción y precio para mantener la limpieza visual de la orden.
14. **Flujo Global:** El sistema impone un flujo estricto de Caja antes de Despacho. Las ordenes (Mesa, Para Llevar, Especial) deben pagarse para ser elegibles para despacho. La anulacion de pago solo aplica sobre ordenes `PAID` no despachadas.
15. **Permisos Operativos:** El botón "Editar orden" y la barra de búsqueda de órdenes deben ser accesibles para usuarios con capacidad `canOperateOrders` para permitir flexibilidad en la gestión de mesas.
16. **Despacho sin duplicados:** Toda modificacion de `useDispatchOrders` debe conservar una sola tarjeta/fila por orden pagada; no separar la misma orden por tiempos de envio de items.
17. **Tarjetas Para llevar / Especial:** Toda modificacion de `ParaLlevar`, `OrdenEspecial` o `useOrder` debe preservar `+` permanente, borradores vacios ocultos, orden visual consecutivo, codigo completo una sola vez, usuario creador y formato compatible con Mesa.
18. **Cobro V2 y BD:** Cambios en `payOrder` o en triggers de `payment_items` deben mantener coherencia con `sync_order_payment_state_internal`; si se insertan muchos `payment_items` en un lote, la BD debe sincronizar la orden **una vez por sentencia** (migración `20260509180000`).
19. **`Ordenes.tsx`:** Usar lista de ítems defensiva (`order?.items ?? []`) en el contenido del detalle para tolerar órdenes parciales en caché.
20. **Plantilla vs cobro:** No usar solo `shift.denoms` para botones de monedas/billetes en cobro; usar catálogo `denominations`. No mezclar arqueo de plantilla con lo que puede pagar el cliente.
21. **Caja secundaria:** No alterar `PaymentDialogV2` para secundarios; usar `PaymentDialogSecondary` y `shouldUseSecondaryPaymentDialog`. Validar flags `secondary_caja_*` y `orderVisibleToSecondaryCashier`.
22. **Extra:** Tras cobrar queda `PAID` y requiere despacho manual en Despacho (Mesa/Todos); cierre con `close_extra_order`. No reactivar auto-despacho en `sync_order_payment_state_internal` sin acuerdo de producto.
23. **Despacho — pestañas:** Mantener pestaña unificada Para llevar/Express; Extra en Mesa y Todos; no reintroducir pestaña Express separada.
24. **Productos frecuentes:** Cambios en admin deben respetar `context` y unique `(branch_id, context, display_order)`; UI en caja usa 1 fila si cabe, max 2 filas con scroll.

### Actualizacion May 23, 2026
- **Ordenes Especiales:** Se corrigio el trigger de pago para marcar como PAID a las ordenes especiales cuando alcanzan el monto manual configurado. Tambien se actualizo useReportesOnlineData.ts para que aparezcan bajo el tipo SPECIAL en los reportes y filtros, y dejen de estar ocultas como Mesa o Extra.
- **UI/UX Monitoreo y Tarjetas:** Ajustes en MonitoreoGlobal.tsx para hacer el embudo mutuamente excluyente en la columna Generadas. Se implemento grid de 2 columnas para tarjetas en vista de tablet y se corrigio el truncado de fecha/hora de los items.
- **Logo y PWA:** Se elimino el filtro CSS que ocultaba el color del logo en SidebarNav.tsx. Se aplico enmascarado circular (rounded-full object-cover) en Login, Sidebar y AppLayout. Se actualizaron los assets de PWA icon-192.png y icon-512.png con la nueva imagen cargada.
