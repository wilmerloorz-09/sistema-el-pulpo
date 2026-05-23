# System Context

## Resumen ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- Frontend principal: React + TypeScript.
- Backend principal: Supabase/PostgreSQL con RLS, RPCs y Edge Functions.
- Backend auxiliar: `proof_capture_backend` para comprobantes de transferencia.
- La sucursal activa sale de `profiles.active_branch_id`.
- La operacion diaria sigue gobernada por permisos efectivos por modulo/sucursal y, cuando aplica, por `cash_shift_users`.
- La navegacion del catalogo ya usa `menu_nodes`, pero la persistencia operativa de venta sigue dependiendo de `products`.

## Estado operativo vigente (2026-06-02)

### Regla canonica de estado de orden
- El flujo base queda fijado como `DRAFT`/Borrador -> `SENT_TO_KITCHEN`/En Caja -> `PAID`/Pagada -> `KITCHEN_DISPATCHED`/Despachada.
- Una orden pasa a Borrador cuando tiene al menos un item agregado y todavia no se envio a Caja.
- Al enviar a Caja se genera `order_code` / `order_number` y la orden queda en `SENT_TO_KITCHEN`; ese estado significa `En Caja`, no despacho.
- Al cobrar en Caja, si la orden queda cubierta, `sync_order_payment_state_internal(...)` debe dejarla en `PAID`.
- El modulo `Despacho` solo debe listar y permitir despachar ordenes `PAID` con cantidades activas pendientes de despacho.
- En `Despacho`, una orden pagada debe representarse como una sola tarjeta/fila por `orders.id` / `order_code`; si sus items fueron enviados en momentos distintos, se agregan dentro de esa misma orden y no se generan tarjetas duplicadas con el mismo numero.
- Al despachar, la orden pasa a `KITCHEN_DISPATCHED` cuando ya no quedan cantidades activas pendientes de despacho.
- Los estados principales son exclusivos en las pestanas operativas: una orden `PAID` no debe aparecer como `KITCHEN_DISPATCHED`, y una orden `KITCHEN_DISPATCHED` no debe seguir apareciendo como `PAID`.
- Al anular un pago, la orden original queda historica `CANCELLED` con `VOID_SUCCESSOR_ORDER`, y la orden sucesora conserva nuevo numero en estado `SENT_TO_KITCHEN`/En Caja.

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
- **Navegación (Para llevar / Orden especial):**
  - `Para llevar` y `Orden especial` se exponen como opciones propias en el menú lateral (después de `Mesas`).
  - Sus pantallas principales muestran grillas de tarjetas dinamicas, no pestañas internas de orden ni redireccion automatica inmediata a detalle.
  - Cada modulo conserva siempre una tarjeta `+` para crear nueva orden.
  - Los borradores vacios no se muestran como tarjetas; los borradores con items y las ordenes activas posteriores permanecen visibles hasta que exista despacho aplicado o cancelacion.
  - Al entrar al detalle se conserva `origin` para preservar el resaltado del Sidebar/BottomNav:
    - `origin=para-llevar`
    - `origin=orden-especial`
  - Las tarjetas de `Mesas`, `Para llevar` y `Orden especial` comparten formato visual; solo cambia el icono/logo. El numero superior es el orden visual consecutivo, el codigo/numero de orden se muestra completo una sola vez y siempre debe aparecer el usuario creador.
- **Express (`order_type = EXPRESS`):**
  - Modulo propio en navegacion (`/express`) con grilla de tarjetas similar a Para llevar.
  - Comparte menu/catalogo operativo con para llevar; el flujo operativo es **despacho antes de cobro** (inverso al global Mesa/Para llevar/Especial).
  - Tras enviar, la orden queda `SENT_TO_KITCHEN` con etiqueta operativa **En despacho**; en `Despacho` aparece en la pestaña unificada **Para llevar / Express**.
  - Solo entra a `Caja > Por cobrar` cuando esta `KITCHEN_DISPATCHED` (despachada, pendiente de cobro total).
  - No admite cobro parcial en el flujo Express.
  - `dispatch_config.takeout_enabled` o `express_enabled` habilitan la pestaña unificada en Despacho (si cualquiera esta activo).
- **Extra (`order_type = EXTRA`):**
  - Modulo propio en navegacion (`/extra`) con grilla de tarjetas similar a Para llevar / Express.
  - Solo el **creador** ve sus ordenes Extra activas en `/extra`; al entrar sin ordenes propias se auto-abre/crea una; con ordenes existentes muestra tarjetas + boton **+**.
  - Sin mesa (`table_id` null); usa menu **Mesas** (`menu_scope = TABLE`) sin categoria raiz PLATOS ni pestañas Con envase / A granel.
  - Flujo operativo: **envio a caja → pago → despacho manual** (como mesa; no como Express).
  - Tras cobro total queda `PAID`; **no** hay auto-despacho ni cierre automatico al pagar (`20260602120000_extra_flow_like_table_orders.sql` retira `auto_finalize_extra_order_after_payment` del sync de pagos).
  - En `Despacho`, las ordenes Extra pagadas aparecen en pestañas **Mesa** y **Todos** (no requieren `sent_to_kitchen_at` en items para listarse).
  - Cierre desde `/extra`: boton **X** en ordenes despachadas ejecuta `close_extra_order(...)` (`20260602130000_close_extra_order.sql`); las ordenes cerradas no se muestran en Extra.
  - Caja: visible para el creador; si otro usuario cobra, solo el **cajero principal** del turno (`primary_cashier_id`). Sin pagos parciales en Extra.
  - Cajero secundario: sin imprimir comprobante en `PaymentDialogSecondary` / `PaymentDialogV2` cuando aplica dialogo secundario.
  - RPC `create_extra_order(...)`; en Caja el subtitulo debe mostrar **Extra**, no nombre de mesa.
  - Productos frecuentes operativos: contexto `EXTRA` en `extra_frequent_products`.
  - Migraciones: `20260527120000_add_extra_order_type.sql`, `20260602120000`, `20260602130000`.
- **Despacho (pestanas y rendimiento):**
  - Pestañas vigentes: **Todos**, **Mesa** (incluye `DINE_IN`, `TABLE` y `EXTRA`), **Para llevar / Express** (unifica `TAKEOUT` y `EXPRESS`), **Orden especial**.
  - Ya no existe pestaña Express separada; `localStorage` con vista `EXPRESS` se normaliza a `TAKEOUT`.
  - Modo `SPLIT`: asignacion `TAKEOUT` o `EXPRESS` en `dispatch_assignments` habilita la pestaña unificada.
  - Boton **Despachar todo** por orden en `DispatchCardBase` / `Despacho.tsx`.
  - Lecturas: RPC batch `get_batch_order_operational_snapshots(...)` (`20260602140000`) con fallback a `get_order_operational_snapshot` por orden.
  - Tras despachar: actualizacion optimista en cliente e invalidacion diferida de queries secundarias (~2,5 s).
- **Productos frecuentes ("Mas frecuentes"):**
  - Tabla `extra_frequent_products` con columna `context` ∈ `MESA`, `TAKEOUT`, `EXPRESS`, `EXTRA` (sin limite de cantidad; migraciones `20260531130000`, `20260531140000`).
  - Admin: pestaña **Mas frecuentes** en `/admin` (`FrequentProductsAdmin`) — selector de contexto, menu segun contexto, lista con agregar/eliminar/reordenar.
  - Caja/ordenes: tarjetas `FrequentProductCards` en `Ordenes.tsx` segun origen:
    - **Mesa:** encima de pestañas Menu Mesas / Con envase / A granel.
    - **Para llevar, Express, Extra:** debajo de pestañas.
  - Layout: 1 fila si caben todos los productos; maximo 2 filas con scroll horizontal tactil cuando hay mas.
  - Default: seccion expandida; click en titulo contrae/expande.

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
  - `can_access_orders`
  - `can_dispatch_orders`
  - `can_manage_products`
  - `can_use_caja`
  - `can_authorize_order_cancel`
  - `can_double_session`
  - `is_supervisor`
- **Varios cajeros por turno (2026-05-21+):**
  - Puede haber **varios** usuarios con `can_use_caja = true` en el mismo turno, hasta el cupo `cash_shifts.max_caja_sessions` (terminales configuradas en `Admin > Turno`).
  - Ya no existe restriccion de un solo cajero habilitado por turno (`ux_cash_shift_users_one_enabled_cashier_per_shift` eliminado).
  - Cada cajero habilitado debe **abrir su propia caja** con su propio arqueo; no comparten una sola apertura global del turno.
  - `cash_register_openings` permite una apertura `abierta` por par `(shift_id, cashier_id)`.
  - `cash_shift_denoms` se particiona por `cashier_id` y `opening_id`; el indice unico vigente es `(shift_id, cashier_id, denomination_id)`.
  - `get_my_branch_shift_gate(...)` devuelve `caja_status` **del usuario autenticado** via `get_user_caja_status(...)`, no el agregado de `cash_shifts.caja_status`.
  - `cash_shifts.caja_status` sigue existiendo como resumen agregado (hay alguna caja abierta en el turno), pero la UI de Caja y el menu lateral usan el estado por usuario.
  - No usar flujo de "conectar terminal" / `claim_cash_session_slot` para un segundo cajero: cada uno ve `Abrir mi caja` y completa su arqueo.
- **Caja principal vs secundarias por turno (2026-05-25+):**
  - `cash_shifts.primary_cashier_id`: cajero de la caja principal (arqueo en modulo `/caja`). En la UI se identifica como "Caja Principal".
  - `cash_shifts.secondary_cajas_enabled` + `secondary_caja_template_id`: habilitan cajas secundarias (se identifican como "Caja Secundaria" en UI si `can_use_caja` es true y no son el principal).
  - Ya no existe `register_role` en `cash_shift_users`.
  - `apply_shift_caja_configuration(...)` asigna `can_use_caja` al principal y a los cajeros secundarios, y abre caja secundaria con `internal_open_cash_register_for_cashier(..., register_role = secondary)`.
  - Tras abrir/guardar turno, el frontend debe llamar `persistShiftCajaConfiguration` **despues** de `persistShiftUsersForShift` para no borrar `can_use_caja` del cajero principal.
  - `useBranchShiftGate`: `isSecondaryCashier` = habilitado con caja y distinto de `primary_cashier_id`; define UI de cobro secundaria.
  - **Alcance de ordenes en caja secundaria (2026-05-29+):**
    - Columnas `cash_shift_users.secondary_caja_takeout_enabled` y `secondary_caja_express_enabled`.
    - Configuracion por cajero secundario en `Admin > Turno` via `apply_shift_caja_configuration(..., p_secondary_caja_config jsonb)`.
    - Filtro en cliente: `orderVisibleToSecondaryCashier` (`src/lib/secondaryCajaPayable.ts`) — solo ordenes **propias** (`created_by`); **Extra siempre** visible para el cajero secundario que las creo; Para llevar/Express segun flags.
  - Migraciones: `20260525120000_shift_caja_structure.sql`, `20260526150000_remove_max_caja_sessions_cap.sql`, `20260529120000_secondary_caja_order_scope.sql`.
- **Administrador general:** puede cambiar a cualquier sucursal activa cuando quiera; no aplica redireccion por turno ni auto-reasignacion al refrescar `get_my_access_context` (`20260524120000_global_admin_free_branch_switch.sql`).
  - **Monitoreo Global de Turnos (`/admin/monitoreo-global`):**
    - Vista exclusiva para el Administrador General que consolida todas las sucursales en tiempo real.
    - Utiliza `supabase_realtime` sobre `cash_shifts`, `cash_shift_users`, `orders` y `profiles`.
    - Muestra usuarios de turno conectados/desconectados en tiempo real (🟢 basado en `profiles.current_app_session_id`).
    - Muestra estado de operacion de caja en tiempo real (etiqueta "En Caja" basada en `last_session_id` o `secondary_session_id`).
    - Embudo de ordenes consolidado para cada sucursal (Generadas, En Caja, Pagadas, Despachadas, Anuladas).
    - Mecanismos de robustez: nombre de canal dinamico (`global-monitor-${hash}`) y `fallbackInterval` de 15s para evitar desconexiones silenciosas de Supabase. Boton de "Actualizar" manual disponible.
  - `open_cash_register(...)` retorna `uuid` de la apertura creada; `close_cash_register(...)` cierra solo la apertura del cajero autenticado.
- `profiles.current_app_session_id` y `cash_shift_users.last_session_id` sostienen el session lock principal de la app.
- Si un usuario del turno tiene `cash_shift_users.can_double_session = true` y `can_use_caja = true`, puede conservar una segunda sesion simultanea mediante:
  - `profiles.current_app_secondary_session_id`
  - `profiles.current_app_secondary_session_started_at`
  - `profiles.current_app_secondary_session_device`
- La doble sesion solo aplica para usuarios habilitados en un turno abierto y pensada para caja/operacion controlada; fuera de ese caso, el bloqueo sigue siendo de una sola sesion.
- Administrador general y supervisor de sucursal mantienen override administrativo para operar caja.
- Cerrar caja ya no implica cerrar turno.
- **Flujo Global:** El sistema impone un flujo estricto de Caja antes de Despacho. Las ordenes (Mesa, Para Llevar, Especial) deben pagarse para ser elegibles para despacho. La anulacion de pago solo aplica sobre ordenes `PAID` que aun no esten `KITCHEN_DISPATCHED`; al anular, se conserva historial y se crea una sucesora `SENT_TO_KITCHEN` con numero nuevo.
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
- **Apertura por cajero:** Si Ivonne ya abrio su caja, otro cajero habilitado (p. ej. usuario1) debe ver el formulario de arqueo propio en `/caja`, no un bloqueo por "caja ya abierta en el turno".
- **Validacion de cobro:** `useCaja` carga `cash_shift_denoms` filtrando `cashier_id = auth.uid()`. `Ordenes` valida cobro rapido con `shiftGateQuery.data.cajaStatus === 'OPEN'`, no con `shift.caja_status` global.
- **Plantilla de apertura vs catálogo de cobro (regla distinta):**
  - **Plantilla / arqueo:** `cash_register_template_denoms` y `OpenShiftForm` definen **con qué empieza** el cajero en su caja (`qty_initial` / `qty_current` en `cash_shift_denoms` del cajero).
  - **Cobro (lo que entrega el cliente):** la UI de pago usa el catálogo global `denominations` activas (`catalogToPaymentDenoms` en `src/lib/cajaDenominations.ts`), **no** solo las filas de la plantilla.
  - **Cambio:** el desglose de vuelto usa `drawerDenoms` = inventario del cajero (`shift.denoms` desde `cash_shift_denoms`).
  - **Backend:** `registrar_movimiento_caja_operativo` con `PAYMENT_IN` crea la fila en `cash_shift_denoms` del cajero autenticado si el cliente paga con una denominacion que no estaba en la plantilla (`20260528130000_payment_in_upsert_per_cashier.sql`).
- **Historial:** `list_cash_register_openings` marca `is_current` cuando la apertura abierta pertenece al usuario actual. El historial mostrado en `OpenShiftForm` se filtra por cajero en cliente.
- **Anulacion de apertura:** usar RPC `annul_cash_opening(p_opening_id, ...)`; solo borra denominaciones de esa apertura/cajero, no las de otros cajeros del mismo turno.
- **Diálogo de cobro (tres variantes):**
  - `PaymentDialog` (`src/components/caja/PaymentDialog.tsx`): flujo clásico; referencia para comprobante de transferencia preparado (`onPrepareTransferProof`, `getTransferProofReadiness`).
  - `PaymentDialogV2` (`src/components/caja/PaymentDialogV2.tsx`): caja **principal** en tablet/escritorio; denominaciones + transferencia; no modificar para caja secundaria.
  - `PaymentDialogSecondary` (`src/components/caja/PaymentDialogSecondary.tsx`): cajeros secundarios (`isSecondaryCashier`); layout vertical compacto para telefono/tablet; sin "Dividir pago"; comparte logica en `usePaymentChargeFlow` con `paymentDenominations` + `drawerDenoms`.
  - Conmutación: `src/lib/cajaPaymentUi.ts` — `USE_PAYMENT_DIALOG_V2`, `shouldUseSecondaryPaymentDialog(shiftGate)`, `canOpenPaymentUiOnDevice(shiftGate, isTablet10)` (secundaria puede cobrar en pantalla pequena aunque `isTablet10` sea false).
  - `PayableOrdersList` y `Ordenes.tsx` eligen Secondary vs V2 vs V1 segun rol y flag.
  - V2/Secondary hoy **no** replican el flujo completo de comprobante de transferencia preparado del clásico.
- **Rendimiento del cobro (cliente + BD):**
  - Inserciones calientes usan `dbInsert` / `dbInsertMany` con `hotPath` (insert sin `select` y sin escribir Dexie en ese momento) para `payments`, `payment_items` y fallback de `cash_movements`.
  - Lecturas previas al cobro en `payOrder` pueden usar `skipLocalCache` en `dbSelect` para no bloquear el hilo con `bulkPut` en IndexedDB.
  - La validación previa al insert en `payOrder` evita el RPC `get_order_operational_snapshot` cuando el flujo efectivo es `CASH_THEN_DISPATCH`, usando cancelaciones aplicadas por ítem y cantidades de `order_items`.
  - Tras persistir pagos, `ensureTableSnapshot` no bloquea el cierre del flujo de cobro (se dispara en segundo plano).
  - **Migración obligatoria para rendimiento en BD:** `20260509180000_payment_items_sync_once_per_statement.sql` reemplaza el trigger `FOR EACH ROW` en `payment_items` por triggers **a nivel de sentencia**, de modo que `sync_order_payment_state_internal` corre **una vez por lote** de ítems de pago, no una vez por fila. Sin esta migración aplicada, el cobro sigue lento aunque el frontend esté optimizado.
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
- `Pagos del turno` debe consultar desde `cash_shifts.opened_at` hasta `closed_at` o el momento actual, no desde la medianoche del dia calendario. Un turno puede cruzar de dia y sus pagos/anulaciones deben seguir visibles.
- El detalle de pago debe mostrar, cuando aplique, monto entregado por el cliente, monedas/billetes recibidos, cambio entregado y devolucion.
- Si el pago esta anulado o reversado, no debe mostrarse lo recibido por el cliente; solo corresponde mostrar la devolucion/anulacion.

### 4. Anulacion de pagos
- El sistema soporta anulacion segura de pagos.
- Regla base: para anular un pago, la orden debe estar `PAID` y no debe estar `KITCHEN_DISPATCHED`.
- Si una orden ya fue despachada, el pago no debe anularse desde el flujo operativo normal.
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
- **Historial de Anulaciones (2026-05-06):** Toda anulación de pago genera un registro de auditoría en la tabla `order_cancellations` y adjunta una nota histórica detallada al pedido (`orders.notes`), garantizando la trazabilidad del supervisor responsable y el motivo.
- **Separacion historica por anulacion de pago (2026-05-07):**
  - al anular un pago, el pedido original conserva su `order_code` / `order_number` para auditoria y queda marcado con `VOID_SUCCESSOR_ORDER:<new_order_id>`.
  - ese pedido original debe quedar `CANCELLED`, sin `table_id`, sin `paid_at`, con `cancelled_at`, y fuera de Caja/Mesas/Despacho como flujo activo.
  - el saldo/operacion activa se mueve a una orden sucesora con nuevo `order_code` / `order_number`, marcada con `SUCCESSOR_OF_VOIDED_ORDER:<old_order_id>`.
  - la orden sucesora es la unica que debe aparecer en `Por cobrar`.
  - `recalculate_check_balance(...)` debe detectar primero `VOID_SUCCESSOR_ORDER` y mantener la orden historica en `CANCELLED`; no debe revivirla a `SENT_TO_KITCHEN`, `READY`, `KITCHEN_DISPATCHED` ni `PAID`.

### 5. Ordenes y mesas
- En `Ordenes.tsx`, el detalle usa `orderItems = order?.items ?? []` de forma consistente para evitar errores si la caché devuelve la orden sin arreglo `items` durante refetch (p. ej. tras cobrar); no asumir `order.items` siempre definido en render.
- `Ordenes` mantiene la vista de lista expandible.
- El orden visible de cuentas dentro de una mesa ya no depende de "divisiones" (table_splits):
  - la UI usa exclusivamente `orders.table_order_position`.
  - una mesa puede contener múltiples órdenes independientes; cada una se trata como una "Orden" completa.
  - cuando ya existe numeracion operativa, debe prevalecer `order_code` / `order_number`.
- Las pestanas visibles del modulo `Ordenes` deben mostrarse en este orden exacto:
  - `Borrador`
  - `En Caja`
  - `Pagada`
  - `Despachada`
  - `Anulada`
- La clasificacion de `Ordenes` debe respetar reglas operativas reales:
  - `Borrador`: ordenes sin envio a Caja, con al menos un item activo agregado. Tambien incluye ordenes sin `order_code` / `order_number` que aun conservan items activos no pagados ni anulados.
  - `En Caja`: solo ordenes con `order_code` / `order_number`, enviadas a Caja (`SENT_TO_KITCHEN` o `READY`), con al menos un item no `DRAFT` y saldo/cantidad pendiente de cobro. Nunca debe mostrar lineas `DRAFT` ni ordenes pagadas completas.
  - `Pagada`: solo ordenes con estado `PAID`; son las unicas candidatas para `Despacho`.
  - `Despachada`: ordenes cuya etapa final visible sea `KITCHEN_DISPATCHED`, y ordenes `PAID` con despacho aplicado (`order_dispatch_events.status = 'APPLIED'`) mientras la cabecera aun no se haya sincronizado.
  - `Anulada`: ordenes historicas/anuladas, incluyendo las de separacion por pago anulado.
- `Pendiente de anulacion` sigue siendo un estado operativo interno y una marca visible en items/orden, pero no es una pestana principal del modulo `Ordenes`.
- Una misma orden no debe aparecer simultaneamente en `Pagada` y `Despachada`; si la cabecera esta `KITCHEN_DISPATCHED`, pertenece a `Despachada`.
- La pestana `Pagadas` debe mostrar ordenes especiales `PAID` aunque no tengan cantidades cobradas visibles por `payment_items`; en ese caso usa los items reales como detalle visual y `special_total_manual` como valor presentado de la orden.
- En toda superficie donde se visualicen ordenes, debe mostrarse el usuario que genero la orden a partir de `orders.created_by`.
- El nombre visible del generador se resuelve desde `profiles.first_name`, luego `profiles.full_name`, luego `profiles.username`, luego `profiles.email`; si no hay datos disponibles, usar `Usuario`.
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
- El flujo de movimiento de items vigente:
  - solo aplica entre ordenes `DINE_IN`
  - no aplica a ordenes especiales
  - puede mover cantidades operativamente activas entre órdenes de la misma mesa o diferentes mesas.
  - preserva historial `READY` y `DISPATCHED`
  - solo permite mover cantidad no pagada remanente
- Si una orden origen queda sin items despues del movimiento, vuelve a `DRAFT`.
- La accion `Eliminar orden` en mesa/orden activa muestra confirmacion simple y no abre `CancelOrderDialog`.
- Para eliminar una orden completa, todos sus items deben estar en `DRAFT` o en estado operativo `En caja`.
- Si algun item esta despachado, pagado o con anulacion pendiente, la accion no debe mostrarse ni ejecutarse.
- Se unifica la opción visual para evitar duplicados en el menú de acciones.
- La regla se valida al mostrar la accion y justo antes de ejecutar la eliminacion.
- **Navegación Contextual:** Al navegar entre Mesas y Ordenes, el sistema usa el parámetro `origin=mesas` para que el Sidebar y el Bottom Nav mantengan el resaltado en la sección de origen, evitando confusiones visuales.
- **Gestión de Mesas con Pagos Anulados (2026-05-06):** Las mesas con pagos anulados permanecen marcadas como ocupadas. La navegación es directa: el usuario hace clic en la mesa para ver el detalle y proceder al re-cobro (re-billing). Se eliminó el banner central de "Pagos Anulados" para simplificar la interfaz.

### 6. Editar Orden (In-Situ)
- `Editar Orden` ya es un flujo base del sistema y ahora opera de manera **In-Situ**.
- El boton `Editar orden` solo debe estar activo para ordenes en `SENT_TO_KITCHEN`/En Caja.
- En pantallas operativas de Mesa, Para llevar y Orden especial, una orden `DRAFT` editable debe mantener activo el menu de productos aunque se elimine un item; si ya esta `PAID`, `KITCHEN_DISPATCHED` o `CANCELLED`, el menu puede verse pero debe quedar desactivado.
- Si una orden no es editable, la pantalla debe seguir mostrando el menu de productos desactivado; no debe reemplazarlo por un panel de bloqueo que oculte el menu.
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
- En la UI principal se comporta igual que `Para llevar`: grilla de tarjetas, `+` permanente, borradores vacios ocultos, borradores con items visibles y salida automatica al despacho/cancelacion.
- En `Despacho`, Orden especial se despacha como orden completa; el detalle puede expandirse para consulta, pero no muestra botones por item.

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
  - nombres
  - apellidos
  - direccion domiciliaria
  - correo
  - telefono
  - contrasena / confirmacion
  - tipo de usuario
  - sucursal
- Validaciones vigentes:
  - nombre de usuario: solo letras y numeros
  - cedula: solo numeros, exactamente 10 digitos
  - nombres: solo letras y espacios
  - apellidos: solo letras y espacios
  - correo: formato valido
  - telefono: solo numeros, exactamente 10 digitos
  - contrasena: minimo 6 caracteres
- El combo de sucursal permite `Sin sucursal` para usuarios operativos.
- La sucursal solo es obligatoria para usuarios con rol supervisor.
- `profiles.first_name` es el nombre visible principal del sistema.
- `profiles.last_name` conserva apellidos para administracion, busqueda y edicion.
- `profiles.full_name` se mantiene como compatibilidad legacy, pero `sync_profile_full_name()` lo sincroniza para reflejar `first_name`.
- En listados compactos de usuario se muestra `Nombres` y nombre de usuario; no se debe agregar cedula/telefono salvo que la pantalla sea de administracion o detalle.

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
  - el modulo `Ordenes` usa las pestanas `Borrador`, `En Caja`, `Pagada`, `Despachada`, `Anulada` en ese orden; `Pendiente de anulacion` no es pestana principal.
  - `Borrador` exige items activos agregados y no enviados a Caja.
  - `En Caja` exige orden numerada/codificada, items no `DRAFT` y saldo pendiente; no debe incluir ordenes pagadas.

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

### 2026-05-03
- Navegación:
  - Implementación de `origin=mesas` para persistencia de resaltado en Sidebar y BottomNav.
  - Uso de `forceActive` y `suppressActive` en `NavLink` para anular resaltado automático por URL técnica.
- Caja:
  - Corrección de RLS para `cash_register_templates`: cajeros en turno activo pueden leer plantillas de apertura.
  - Estabilización de `PaymentDialog`: el cálculo de `changeAmount` ahora contempla excedentes en transferencias y pagos mixtos.
  - Eliminación de errores de duplicidad de keys en el desglose de monedas (`denomination_id`).
- Ordenes / Mesas:
  - Desmantelamiento conceptual de "divisiones" a favor de "órdenes independientes dentro de una mesa".
  - Unificación de la opción "Eliminar orden" en el menú de acciones para evitar duplicados visuales.
  - **Agrupamiento Consolidado:** Implementación de agrupamiento visual por descripción y precio en `OrderItemsList` y `PayableOrdersList`.
  - **Flexibilidad Operativa:** El botón "Editar orden" y la búsqueda de órdenes ahora son accesibles para meseros/cajeros con capacidad `canOperateOrders`.

### 2026-05-05
- Caja y Pagos:
  - **Inicialización Forzada:** El `PaymentDialog` ahora exige una "Caja abierta" (denominaciones de apertura registradas) para poder operar, eliminando el riesgo de pagos sin base de caja.
  - **Integridad Financiera:** Las operaciones de cobro estan vinculadas a la existencia de un registro activo en `cash_shift_denoms`. La anulacion operativa de pagos solo aplica sobre ordenes `PAID` no despachadas.
  - **Redondeo Centralizado:** Implementación de redondeo financiero en el resumen de caja para evitar errores de precisión en la sumatoria de movimientos.
- UI / UX:
  - **Optimización Tablet:** Ajuste del módulo de Despacho para resolución de 1280px, optimizando el espacio en rejillas y reduciendo redundancia visual (eliminación de etiquetas "unidades pendientes" innecesarias).

### 2026-05-07
- Caja / anulacion de pagos:
  - una anulacion de pago genera separacion de orden: historica `CANCELLED` con numero original y sucesora activa con numero nuevo.
  - las historicas con `VOID_SUCCESSOR_ORDER` nunca deben salir como cobrables ni ocupar mesa.
  - `CompletedPaymentsList` muestra cantidad entregada/desglose solo en pagos activos; en anulados oculta lo recibido y muestra devolucion.
  - `Pagos del turno` filtra desde `cash_shifts.opened_at`, no desde medianoche, para soportar turnos que cruzan de dia.
- Ordenes / Mesas / Despacho:
  - una orden `PAID` permanece visible en su mesa hasta que sea despachada; pagarla no libera la mesa ni oculta la orden.
  - `Ordenes` clasifica `PAID` y `KITCHEN_DISPATCHED` como pestanas mutuamente excluyentes.
  - `Despacho` agrupa por orden, no por lote temporal de items: un mismo `order_code` debe aparecer una sola vez con sus cantidades pendientes agregadas.
  - `Editar orden` queda limitado a `SENT_TO_KITCHEN`/En Caja.
  - cuando una orden se mueve de mesa, el encabezado debe resolver el nombre desde `restaurant_tables.name` y usar `orders.table_name_snapshot` solo como respaldo.

### 2026-06-02
- Extra:
  - Flujo alineado a mesa: pago deja `PAID` y despacho/cierre son manuales (sin auto-finalize al cobrar).
  - Visibilidad en Despacho: pestañas Mesa y Todos; items Extra no exigen `sent_to_kitchen_at` para armar tarjeta.
  - Modulo `/extra`: solo creador, grilla/+ vs auto-apertura, cierre con `close_extra_order`, sin ordenes cerradas en home.
  - Caja: creador o cajero principal; sin cobro parcial; secundario sin imprimir comprobante.
- Despacho:
  - Pestaña unificada **Para llevar / Express**; Extra en Mesa/Todos; **Despachar todo**; snapshots batch y cache optimista.
- Migraciones pendientes de aplicar manualmente en Supabase: `20260602120000`, `20260602130000`, `20260602140000`.

### 2026-05-25 / 2026-05-31
- Turno / caja:
  - Estructura caja principal + secundarias por turno (`primary_cashier_id`, plantilla secundaria, `register_role` en aperturas).
  - Alcance Por llevar / Express por cajero secundario (`secondary_caja_*`, `p_secondary_caja_config`).
  - Fix persistencia `can_use_caja` del cajero principal al guardar usuarios del turno.
  - Separacion plantilla de arqueo vs catalogo de denominaciones en cobro.
  - `PaymentDialogSecondary` para cajeros secundarios en movil/tablet.
  - `registrar_movimiento_caja_operativo`: `PAYMENT_IN` por cajero con upsert si falta denominacion en caja.
- Extra:
  - `order_type = EXTRA`, pagina `/extra`, flujo caja → despacho manual (como mesa), menu sin PLATOS.
  - Sin auto-despacho al cobrar; cierre manual con `close_extra_order` desde `/extra`.
- Productos frecuentes:
  - Tabla `extra_frequent_products` multi-contexto (Mesa, Para llevar, Express, Extra).
  - Admin reordenable; tarjetas en caja con 1–2 filas y scroll horizontal.

### 2026-05-09 (ampliado — cobro V2 y rendimiento)
- Caja / UI de cobro:
  - `PaymentDialogV2` con cobro real (`payOrder`), pantalla posterior con vuelto por denominación, impresión de comprobante y ancho reducido en éxito.
  - Optimización de `payOrder`: lecturas con `skipLocalCache`, validación sin `get_order_operational_snapshot` en modo `CASH_THEN_DISPATCH`, inserts `hotPath`, `dbInsertMany` para `payment_items`, `ensureTableSnapshot` no bloqueante.
  - Migración `20260509180000_payment_items_sync_once_per_statement.sql`: sincronización de estado de orden **una vez por sentencia** en `payment_items`.
- Caja e Integridad Financiera:
  - **Redondeo Centralizado:** Todos los cálculos de subtotales, impuestos, totales y vueltos aplican redondeo a 2 decimales para evitar discrepancias de punto flotante en el cuadre de caja.
  - **Exclusión de Cancelados:** Los ítems con estado de anulación (confirmada o pendiente) se excluyen automáticamente de los cálculos de saldo de la orden y totales del turno.
  - **Validación de Caja Abierta:** `PaymentDialog`, `PaymentDialogV2` y `payOrder` bloquean cobro sin apertura de caja válida (`cash_shift_denoms`) en el turno.
- Auditoría y Trazabilidad:
  - **Historial de Pagos Anulados:** Toda anulación (vía `PaymentReversalModal`) inserta un registro detallado en `order_cancellations` y adjunta una nota técnica en `orders.notes` con el ID del supervisor y el motivo.
  - **Despacho Consolidado:** Se garantiza que el módulo de Despacho solo muestre una tarjeta por `order_code`. Si se agregan ítems nuevos a una orden ya enviada, estos se agrupan en la tarjeta existente.
- UI/UX:
  - **Resaltado de Navegación:** Estabilización del parámetro `origin` para asegurar que el Sidebar y BottomNav reflejen siempre el módulo de origen (`mesas`, `para-llevar`, `orden-especial`), incluso tras ediciones o cobros.
  - **Optimización de Pantalla:** Ajuste final de tipografías y espaciados en `PayableOrdersList` para mejorar la lectura en dispositivos tipo tablet.

## Riesgos que siguen vigentes
1. No asumir que `menu_nodes` ya reemplazo completamente a `products`.
2. No mezclar cerrar caja con cerrar turno.
3. Cualquier cambio en anulacion de pagos debe revisar `payments`, `payment_items`, `payment_void_requests`, `order_cancellations`, `cash_shift_denoms`, `cash_movements` y estado visible de `Mesas` / `Ordenes`; si hay separacion por pago anulado, validar historica `CANCELLED` con `VOID_SUCCESSOR_ORDER` y sucesora activa con `SUCCESSOR_OF_VOIDED_ORDER`.
4. Cualquier cambio en `Unir/Dividir` debe preservar cantidades pagadas y redistribucion de historial `READY` / `DISPATCHED`.
5. Los resets SQL limpian datos transaccionales y metadata de comprobantes, pero los archivos del bucket `payment-proofs` se borran aparte.
6. La pestana `Pendiente de anulacion` depende de marcas reales en DB:
   - `orders.cancel_requested_at`
   - y/o cabecera `[PENDING_REQUEST]` en `order_cancellations`
7. Cualquier cambio en envio de ordenes o cobro debe respetar el flujo global Caja - Despacho; no codificar decisiones por sucursal.
8. Cualquier cambio en eliminacion completa de orden debe preservar la restriccion: todos los items en borrador o en caja, confirmacion previa, y validacion inmediata antes de ejecutar.
9. Cualquier cambio en `Despacho` debe preservar una sola tarjeta por orden pagada; no volver a separar la misma orden por `sent_to_kitchen_at` de los items.
10. Cobros lentos con muchas líneas: verificar que la migración `20260509180000_payment_items_sync_once_per_statement.sql` esté aplicada en la BD remota; sin ella, cada fila de `payment_items` dispara sincronización completa de orden.
11. No confundir **plantilla de apertura** con **denominaciones que puede entregar el cliente**; el cobro debe listar `denominations` activas; el arqueo y el cambio usan `cash_shift_denoms` del cajero.
12. Cajero secundario: validar `isSecondaryCashier`, flags `secondary_caja_takeout_enabled` / `secondary_caja_express_enabled`, `orderVisibleToSecondaryCashier`, migracion `20260528130000_payment_in_upsert_per_cashier.sql`, que Extra no muestre "Mesa N" si `order_type` es `EXTRA` y `table_name` es null, y que no imprima comprobante en dialogos secundarios.
13. Extra post-cobro: verificar `20260602120000` (sin auto-despacho), que la orden `PAID` aparezca en Despacho (Mesa/Todos) y que el cierre use `20260602130000` desde `/extra`.
14. Despacho: pestaña unificada Para llevar/Express; Extra en Mesa; una tarjeta por orden; migracion `20260602140000` para snapshots batch.
15. Productos frecuentes: verificar migraciones `20260531130000` y `20260531140000`; reordenar usa `display_order` con staging positivo (no valores negativos).

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
