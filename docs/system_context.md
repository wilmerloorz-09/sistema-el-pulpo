# System Context

## Resumen ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- Frontend principal: React + TypeScript.
- Backend principal: Supabase/PostgreSQL con RLS, RPCs y Edge Functions.
- Backend auxiliar: `proof_capture_backend` para comprobantes de transferencia.
- La sucursal activa sale de `profiles.active_branch_id`.
- La operacion diaria sigue gobernada por permisos efectivos por modulo/sucursal y, cuando aplica, por `cash_shift_users`.
- La navegacion del catalogo ya usa `menu_nodes`, pero la persistencia operativa de venta sigue dependiendo de `products`.

## Estado operativo vigente (2026-08-07)

### Regla canonica de estado de orden
- El flujo base queda fijado como `DRAFT`/Borrador -> `SENT_TO_KITCHEN`/En Caja -> `PAID`/Pagada -> `KITCHEN_DISPATCHED`/Despachada.
- Una orden pasa a Borrador cuando tiene al menos un item agregado y todavia no se envio a Caja.
- Al enviar a Caja se genera `order_code` / `order_number` y la orden queda en `SENT_TO_KITCHEN`; ese estado significa `En Caja`, no despacho.
- Al cobrar en Caja, si la orden queda cubierta, `sync_order_payment_state_internal(...)` debe dejarla en `PAID`. **`PAID` es un estado terminal**: ninguna operación posterior puede revertirlo excepto una anulación explícita de pago.
- El modulo `Despacho` solo debe listar y permitir despachar ordenes `PAID` con cantidades activas pendientes de despacho.
- En `Despacho`, una orden pagada debe representarse como una sola tarjeta/fila por `orders.id` / `order_code`; si sus items fueron enviados en momentos distintos, se agregan dentro de esa misma orden y no se generan tarjetas duplicadas con el mismo numero.
- Al despachar, la orden pasa a `KITCHEN_DISPATCHED` cuando ya no quedan cantidades activas pendientes de despacho.
- Los estados principales son exclusivos en las pestanas operativas: una orden `PAID` no debe aparecer como `KITCHEN_DISPATCHED`, y una orden `KITCHEN_DISPATCHED` no debe seguir apareciendo como `PAID`.
- Al anular el último pago activo (desde 2026-07-19), la orden queda `CANCELLED` con marcador `VOIDED_PAYMENT_CLOSED`: sale de Recaudar, libera la mesa (conserva `table_id`) y **no** vuelve sola a En Caja. El re-cobro es bajo demanda con **Cobrar orden** en Pagos realizados → `preparar_orden_para_recobro` (misma orden / mismo número). Una sola anulación de pago por vida de orden (`can_void_payment`). Históricas legacy con `VOID_SUCCESSOR_ORDER` se preservan.

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
  - **Solo visible en flujo `CASH_THEN_DISPATCH` (Caja primero).** Si la sucursal esta en `DISPATCH_THEN_CASH` (Despacho primero), la opcion **Extra** no aparece en el menu lateral ni en la barra inferior (`useVisibleNavItems.tsx`); acceso directo a `/extra` redirige a `/mesas`.
  - Solo el **creador** ve sus ordenes Extra activas en `/extra`; al entrar sin ordenes propias muestra tarjetas + boton **+** (sin auto-creación).
  - Mesa obligatoria (`table_id` requerido); usa menu **Mesas** (`menu_scope = TABLE`) sin categoria raiz PLATOS ni pestañas Con envase / A granel.
  - Flujo operativo: **envio a caja → pago → despacho manual**.
  - Tras cobro total queda `PAID`; **no** hay auto-despacho ni cierre automatico al pagar.
  - En `Despacho`, las ordenes Extra pagadas aparecen en pestañas **Mesa** y **Todos** con el formato `Extra • Nombre Mesa`.
  - Cierre desde `/extra`: boton **X** ejecuta `close_extra_order(...)`; adicionalmente las órdenes Extra desaparecen automáticamente del módulo Extra al ser despachadas (estado `KITCHEN_DISPATCHED`).
  - Caja: sin restricción por “principal/secundario” (caja unificada). Mantener la regla de negocio de Extra (sin pagos parciales).
  - RPC `create_extra_order(...)`; en Caja el subtitulo debe mostrar **Extra • Nombre Mesa**.
  - Productos frecuentes operativos: contexto `EXTRA` en `extra_frequent_products`.
  - Migraciones: `20260527120000_add_extra_order_type.sql`, `20260602120000`, `20260602130000`.
- **Despacho (pestanas y rendimiento):**
  - Pestañas vigentes: **Todos**, **Mesa** (incluye `DINE_IN`, `TABLE` y `EXTRA`), **Para llevar / Express** (unifica `TAKEOUT` y `EXPRESS`), **Orden especial**.
  - Ya no existe pestaña Express separada; `localStorage` con vista `EXPRESS` se normaliza a `TAKEOUT`.
  - Modo `SPLIT`: asignacion `TAKEOUT` o `EXPRESS` en `dispatch_assignments` habilita la pestaña unificada.
  - Boton **Despachar todo** por orden en `DispatchCardBase` / `Despacho.tsx`.
  - **Consolidacion visual de lineas:** en la tarjeta expandida, items identicos (mismo producto, precio, modificadores y nota) se muestran en una sola fila con cantidad sumada (ej. `2x Chifle` en vez de dos filas `1x`). El despacho parcial reparte cantidades entre las lineas `order_items` originales (`src/lib/dispatchItemConsolidation.ts`, `buildDispatchAllocations`).
  - Lecturas: RPC batch `get_batch_order_operational_snapshots(...)` (`20260602140000`) con fallback a `get_order_operational_snapshot` por orden.
  - Tras despachar: actualizacion optimista en cliente e invalidacion diferida de queries secundarias (~2,5 s).
- **Servir (Platos) y Despacho:**
  - Si un turno tiene al menos un usuario habilitado con el permiso `can_serve_plates` (Servir):
    - El módulo **Despacho** filtra y oculta todos los productos de la categoría raíz PLATOS.
    - El módulo **Servir** (`/servir`) muestra *exclusivamente* los productos de la categoría raíz PLATOS.
  - Si ningún usuario en el turno tiene el permiso `can_serve_plates`, el módulo **Despacho** vuelve a mostrar todos los productos (comportamiento tradicional).
- **Clientes (comensales) y cobro (2026-06-11+):**
  - Tabla `clientes` (cédula única, sexo, contacto); no son usuarios de `auth`.
  - `orders.cliente_id` opcional: se asigna al cobrar (`PaymentDialogV2` + `usePaymentClienteSelection`) o al registrar promoción.
  - UI de cobro: `PaymentClienteCard` (búsqueda por cédula/nombre, alta con `ClienteFormulario`, cliente opcional).
- **Campañas promocionales y Promociones operativas (2026-06-11+):**
  - **Admin / Campañas** (`/campanas`, detalle `/campanas/:id`): CRUD de campaña, cartelera de ofertas (cuota, fecha de bloqueo, resultado `PENDIENTE`|`GANADA`|`PERDIDA`), cierre por fila con `cerrar_oferta_campana` (migración `20260611170000`).
  - Pueden coexistir **varias campañas con `activa = true`**; en `/promociones` el operador elige campaña en un selector antes de listar órdenes y ofertas.
  - **Promociones** (`/promociones`): requiere turno abierto y `usuario_puede_registrar_promociones()` (fila en `permisos_promociones_turnos`, creada al habilitar usuario en turno).
  - Elegibles: órdenes del turno con `paid_at` no nulo (incluye `PAID` y `KITCHEN_DISPATCHED` pagadas), consumo mínimo por campaña (usa `special_total_manual`, `orders.total` o suma de pagos activos del turno), sin predicción previa **en esa campaña** (`UNIQUE (orden_id, campana_id)` — migración `20260611180000`).
  - Registro: misma UX de cliente que caja (`PaymentClienteCard`, requerido en promociones); ofertas con `bloqueo_at` futuro; persiste `predicciones_clientes` y actualiza `orders.cliente_id` si cambió.
  - **QR en ticket de cobro (2026-07-09):** solo se genera/imprime si hay campaña activa con ofertas registrables (`src/lib/promocionesRecibo.ts`, `src/lib/campanasValidacion.ts`). Sin eso, ocultar `token_promocion` y QR aunque exista token en BD.
  - Menú lateral: categoría **PROMOCIONES** (Promociones operativo; Campañas solo admin global o `MANAGE` en `admin_global` en nav).
  - Migraciones: `20260611120000` … `20260611180000` (clientes, `orders.cliente_id`, campañas, admin, cierre oferta, unicidad por campaña).
- **Productos frecuentes ("Mas frecuentes"):**
  - Tabla `extra_frequent_products` con columna `context` ∈ `MESA`, `TAKEOUT`, `EXPRESS`, `EXTRA` (sin limite de cantidad; migraciones `20260531130000`, `20260531140000`).
  - Admin: pestaña **Mas frecuentes** en `/admin` (`FrequentProductsAdmin`) — selector de contexto, menu segun contexto, lista con agregar/eliminar/reordenar.
  - Caja/ordenes: tarjetas `FrequentProductCards` en `Ordenes.tsx` segun origen:
    - **Mesa:** encima de pestañas Menu Mesas / Con envase / A granel.
    - **Para llevar, Express, Extra:** debajo de pestañas.
  - Layout: 1 fila si caben todos los productos; maximo 2 filas con scroll horizontal tactil cuando hay mas.
  - Default: seccion expandida; click en titulo contrae/expande.
- **Modificaciones al agregar producto (modal `AddItemDialog`, 2026-07-07):**
  - Las opciones visibles (Poca cebolla, Sin yuca, etc.) se resuelven en `Ordenes.tsx` desde el catalogo en memoria `branch-modifiers-catalog` (React Query).
  - Herencia: un producto hereda modificadores de sus nodos ancestros en `menu_node_modifiers` (categoria padre, etc.). La resolucion **no debe depender** de que el `MenuNode` traiga `ancestor_ids` precalculado.
  - `resolveModifierNodeIds(...)` recorre `parent_id` usando el mapa `parentByNodeId` del catalogo (todos los `menu_nodes` de la sucursal). Esto corrige fallos al elegir desde **Mas frecuentes**, donde `menu_nodes(*)` llega sin enriquecer.
  - Consultas del catalogo usan chunks de 200 IDs en `.in(...)` para evitar fallos intermitentes en movil/tablet con sucursales grandes.
  - `handleSelectMenuProduct` usa secuencia (`productSelectSeqRef`) para ignorar respuestas async de selecciones anteriores (doble toque / red lenta).
  - Ya no se cachea el lookup del producto 60 s con `menu-product-lookup`; el lookup se ejecuta directo en cada apertura del modal.
  - Orden bandeja tipo **Sin envase** (`tray_item_type = A`): modificadores ocultos por regla de negocio (intencional).
  - Invalidacion: al editar asignaciones en admin (`useNodeModifiers`, `MenuNodesCrud`) se invalida `branch-modifiers-catalog`.
- **Agregar producto al instante (2026-08-05):**
  - Al tocar un producto, `AddItemDialog` abre de inmediato con un shell del nodo de menú (`resolvingShell` / producto optimista en `Ordenes.tsx`).
  - El lookup de `product_id` y modificadores corre en background; `ensureProduct` bloquea confirmar **Agregar** hasta reconciliar.
  - Archivos: `src/pages/Ordenes.tsx`, `src/components/order/AddItemDialog.tsx`.

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
  - `can_pack_orders` (Empacador: solo ve `/extra` y sus comandas, bloqueado de Mesas, Express, Para Llevar y Especial)
  - `can_serve_plates` (Servir: módulo independiente para despachar productos de categoría PLATOS)
- **Varios cajeros por turno (2026-05-21+):**
  - Puede haber **varios** usuarios con `can_use_caja = true` en el mismo turno, hasta el cupo `cash_shifts.max_caja_sessions` (terminales configuradas en `Admin > Turno`).
  - Ya no existe restriccion de un solo cajero habilitado por turno (`ux_cash_shift_users_one_enabled_cashier_per_shift` eliminado).
  - Cada cajero habilitado debe **abrir su propia caja** con su propio arqueo; no comparten una sola apertura global del turno.
  - `cash_register_openings` permite una apertura `abierta` por par `(shift_id, cashier_id)`.
  - `cash_shift_denoms` se particiona por `cashier_id` y `opening_id`; el indice unico vigente es `(shift_id, cashier_id, denomination_id)`.
  - `get_my_branch_shift_gate(...)` devuelve `caja_status` **del usuario autenticado** via `get_user_caja_status(...)`, no el agregado de `cash_shifts.caja_status`.
  - `cash_shifts.caja_status` sigue existiendo como resumen agregado (hay alguna caja abierta en el turno), pero la UI de Caja y el menu lateral usan el estado por usuario.
  - No usar flujo de "conectar terminal" / `claim_cash_session_slot` para un segundo cajero: cada uno ve `Abrir mi caja` y completa su arqueo.
- **Cajas unificadas (principal opcional) (2026-05-25+ / 2026-06-05+):**
  - No existe distinción operativa entre “caja principal” y “secundaria”: cualquier cajero habilitado puede cobrar cualquier tipo de orden y de cualquier usuario.
  - `cash_shifts.primary_cashier_id` existe solo como **default de UI** en Recaudar: si coincide con el usuario, por defecto ve **todas** las órdenes; si no, por defecto ve “solo mis órdenes”.
  - El cajero principal es **opcional**: puede ser `NULL` siempre que exista al menos un cajero habilitado para caja.
  - Configuración UI: lista única de cajeros (usuario + plantilla) con un checkbox “Principal” por fila (máximo 1).
  - `apply_shift_caja_configuration(...)` aplica la lista (habilita `can_use_caja`) y abre cajas según plantilla.
  - Migraciones clave: `20260604120000_secondary_caja_individual_template.sql` y `20260605120000_optional_primary_cashier.sql`.
- **Administrador general:** puede cambiar a cualquier sucursal activa cuando quiera; no aplica redireccion por turno ni auto-reasignacion al refrescar `get_my_access_context` (`20260524120000_global_admin_free_branch_switch.sql`).
  - **Monitoreo Global de Turnos (`/admin/monitoreo-global`):**
    - Vista exclusiva para el Administrador General que consolida todas las sucursales en tiempo real.
    - Utiliza `supabase_realtime` sobre `cash_shifts`, `cash_shift_users` y `orders` (sin suscripcion amplia a `profiles` que recargaba todas las sucursales).
    - Muestra usuarios de turno conectados/desconectados en tiempo real (🟢 basado en `profiles.current_app_session_id`).
    - Muestra estado de operacion de caja en tiempo real (etiqueta "En Caja" basada en `last_session_id` o `secondary_session_id`).
    - Embudo de ordenes consolidado para cada sucursal (Generadas, En Caja, Pagadas, Despachadas, Anuladas).
    - Mecanismos de robustez: nombre de canal dinamico (`global-monitor:...`), Realtime sobre `orders`/`cash_shifts`/`cash_shift_users` (migración `20260730230000`), polling de respaldo cada **5 min** y boton **Actualizar** manual. Hooks de React deben declararse antes de cualquier `return` condicional en `MonitoreoGlobal.tsx`.
  - `open_cash_register(...)` retorna `uuid` de la apertura creada; `close_cash_register(...)` cierra solo la apertura del cajero autenticado.
- `profiles.current_app_session_id` y `cash_shift_users.last_session_id` sostienen el session lock principal de la app.
- Si un usuario del turno tiene `cash_shift_users.can_double_session = true` (checkbox **Sesión doble** en la tarjeta de `Admin > Turno`), puede conservar una segunda sesion simultanea en otro dispositivo mediante:
  - `profiles.current_app_session_id` (slot primario)
  - `profiles.current_app_secondary_session_id` (slot secundario)
  - `profiles.current_app_secondary_session_started_at`
  - `profiles.current_app_secondary_session_device`
- La doble sesion aplica a **cualquier** usuario habilitado en un turno abierto (Venta, Despacho, Servir, Empacador, Caja, etc.); ya no exige `can_use_caja`. Sin el flag, el bloqueo sigue siendo de una sola sesion.
- **Registro y validacion (cliente):**
  - Cada dispositivo guarda su id en `localStorage` (`authOwnedSingleSession`).
  - `register_my_single_session` escribe el slot primario o secundario segun `user_has_double_app_session_permission(auth.uid())`.
  - `AuthContext` valida cada ~15 s y al focus/visibility leyendo slots directo de `profiles` (no via `dbSelect`).
  - **No** borrar `authOwnedSingleSession` cuando `user` parpadea a `null` (refresh de token): regenerar el id ocuparia el secundario y echaria el otro dispositivo. Solo limpiar en `signOut` / kick concurrente.
  - Reservar el id local **antes** del RPC para evitar dos UUID en paralelo.
- **Persistencia en turno:** al abrir, `open_cash_shift_with_tables` debe guardar `can_double_session` sin `AND can_use_caja` (el cliente envia caja=false y luego `apply_shift_caja_configuration`). Tras aplicar caja, `ShiftSetupAdmin.restoreDoubleSessionFlags` reaplica el flag.
- Si falla doble sesion en operacion, verificar: turno `OPEN`, `cash_shift_users.can_double_session = true`, migraciones `20260713220000` / `20260714230000` / `20260714240000`, y que con dos dispositivos abiertos existan ambos slots en `profiles`.
- Administrador general y supervisor de sucursal mantienen override administrativo para operar caja.
- Cerrar caja ya no implica cerrar turno.
- **Flujos Operativos Configurable:** Las sucursales pueden configurarse mediante `branches.workflow_mode` en uno de dos flujos operativos:
  - **`CASH_THEN_DISPATCH` (Caja primero)**: Las órdenes (Mesa, Para Llevar, Especial, Extra) se cobran primero en Caja y luego pasan a Despacho. La anulación de pago solo aplica sobre órdenes `PAID` que aún no estén despachadas.
  - **`DISPATCH_THEN_CASH` (Despacho primero)**: Las órdenes pasan primero al módulo de Despacho para ser servidas/preparadas y luego pasan a Caja para su cobro final.
- El CRUD de administración de sucursales expone y permite modificar el campo de flujo `workflow_mode`.
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
- **Forzar cierre de turno (Admin, 2026-08-06):**
  - Ruta `/forzar-cierre-turno` (`ForzarCierreTurno.tsx`); ítem en menú ADMINISTRACIÓN.
  - Visible con MANAGE en `turno` / `admin_sucursal` / `admin_global` (también sin turno abierto para el actor).
  - RPC `force_close_cash_shift(p_shift_id, p_branch_id, p_notes)`; migración `20260806040000_force_close_cash_shift.sql`.
  - Requiere `can_manage_shift_admin`; confirmación tipando `FORZAR`.
  - Efectos: elimina borradores `DRAFT`; cierra `PAID` pendientes de despacho; fuerza operativas (`SENT_TO_KITCHEN`/`READY`/`KITCHEN_DISPATCHED`) → `PAID`; cierra aperturas y turno; desactiva mesas.
  - **No** sustituye el cierre normal `close_cash_shift_with_tables` (este sí respeta bloqueantes).

### 3. Caja y pagos
- **Apertura por cajero:** Si Ivonne ya abrio su caja, otro cajero habilitado (p. ej. usuario1) debe ver el formulario de arqueo propio en `/caja`, no un bloqueo por "caja ya abierta en el turno".
- **Validacion de cobro:** `useCaja` carga `cash_shift_denoms` filtrando `cashier_id = auth.uid()`. `Ordenes` valida cobro rapido con `shiftGateQuery.data.cajaStatus === 'OPEN'`, no con `shift.caja_status` global.
- **Plantilla de apertura vs catálogo de cobro (regla estricta):**
  - **Plantilla / arqueo:** `cash_register_template_denoms` y `OpenShiftForm` definen **con qué empieza** el cajero en su caja (`qty_initial` / `qty_current` en `cash_shift_denoms` del cajero).
  - **Cobro (Efectivo entregado):** la UI de pago usa el catálogo global `denominations` activas (`catalogToPaymentDenoms` en `src/lib/cajaDenominations.ts`), **no depende** de la plantilla.
  - **Cambio:** el desglose de vuelto usa `drawerDenoms` = inventario del cajero (`shift.denoms` desde `cash_shift_denoms`).
  - **Backend:** `registrar_movimiento_caja_operativo` con `PAYMENT_IN` crea la fila en `cash_shift_denoms` del cajero autenticado si el cliente paga con una denominacion que no estaba en la plantilla (`20260528130000_payment_in_upsert_per_cashier.sql`).
- **Historial:** `list_cash_register_openings` marca `is_current` cuando la apertura abierta pertenece al usuario actual. El historial mostrado en `OpenShiftForm` se filtra por cajero en cliente.
- **Anulacion de apertura:** usar RPC `annul_cash_opening(p_opening_id, ...)`; solo borra denominaciones de esa apertura/cajero, no las de otros cajeros del mismo turno.
- **Diálogo de cobro (unificado):**
  - `PaymentDialogV2` (`src/components/caja/PaymentDialogV2.tsx`) es la UI estándar para cobrar (misma UI para todos los cajeros).
  - `PaymentDialog` (`src/components/caja/PaymentDialog.tsx`) se conserva como referencia/compatibilidad.
- **Despacho primero — bloqueo de cobro en Caja (2026-07-10):**
  - Solo cuando `branches.workflow_mode = DISPATCH_THEN_CASH`.
  - Cada `PayableOrder` expone `undispatched_units` y `ready_to_collect` (calculados en `useCaja` con `computeUndispatchedQuantity` de `src/lib/orderOperational.ts`).
  - Si `ready_to_collect = false`, la orden **sigue visible** en Recaudar; `PayableOrdersList` muestra boton **Cobrar** rojo y al pulsarlo abre `AlertDialog` (“No estan despachados todos los items…”) sin abrir el dialogo de pago. No filtrar estas ordenes en `Caja.tsx` (causaba parpadeo).
  - Si todo esta despachado, boton verde como antes.
  - `payOrder` rechaza el cobro en servidor si aun quedan unidades sin despachar (defensa adicional).
  - `orders.locked_for_editing` sigue deshabilitando el boton independientemente del color.
- **Rendimiento del cobro (cliente + BD):**
  - Inserciones calientes usan `dbInsert` / `dbInsertMany` con `hotPath` (insert sin `select` y sin escribir Dexie en ese momento) para `payments`, `payment_items` y fallback de `cash_movements`.
  - Lecturas previas al cobro en `payOrder` pueden usar `skipLocalCache` en `dbSelect` para no bloquear el hilo con `bulkPut` en IndexedDB.
  - La validación previa al insert en `payOrder` evita el RPC `get_order_operational_snapshot` cuando el flujo configurado es `CASH_THEN_DISPATCH`, usando cancelaciones aplicadas por ítem y cantidades de `order_items`.
  - Tras persistir pagos, `ensureTableSnapshot` no bloquea el cierre del flujo de cobro (se dispara en segundo plano).
  - **Migración obligatoria para rendimiento en BD:** `20260509180000_payment_items_sync_once_per_statement.sql` reemplaza el trigger `FOR EACH ROW` en `payment_items` por triggers **a nivel de sentencia**, de modo que `sync_order_payment_state_internal` corre **una vez por lote** de ítems de pago, no una vez por fila. Sin esta migración aplicada, el cobro sigue lento aunque el frontend esté optimizado.
  - **Guard de estado terminal (`20260623200000`):** `sync_order_payment_state_internal` retorna inmediatamente si la orden ya es `PAID` o `CANCELLED`. Impide que despacho o recomputación operativa pisen el estado de pago.
  - **`orders.total` siempre sincronizado (`20260623190000`):** El trigger `trg_sync_order_total` en `order_items` recalcula `orders.total` en tiempo real. `sync_order_payment_state_internal` también recalcula `total` antes de evaluar si la orden está pagada. Antes de esta migración, `total` solo se actualizaba en cancelaciones.
- `Caja` trabaja con:
  - `PayableOrdersList`
  - `CompletedPaymentsList`
  - `ShiftSummary`
  - `CashRegisterMovementsDialog`
  - `PaymentReversalModal`
- **Resumen por cajero (regla UI):** dentro de `ShiftSummary`, las secciones **Resumen de caja**, **Desglose** y **Cambio** deben reflejar exclusivamente los pagos y movimientos del usuario logueado (no el total global del turno).
- La caja fisica se reconstruye desde `cash_shift_denoms` + `cash_movements`.
- El resumen de caja ya debe mostrar efectivo neto aplicado, no efectivo bruto recibido antes del cambio.
- En flujo **`CASH_THEN_DISPATCH`**, Caja debe considerar cobrable la cantidad ordenada activa completa, no solo la cantidad despachada, incluso para ordenes de mesa.
- En flujo **`DISPATCH_THEN_CASH`**, las ordenes en **Ordenes por cobrar** pueden listar montos parcialmente cobrables (solo unidades ya despachadas), pero el boton **Cobrar** permanece **rojo** y bloqueado hasta que **todos** los items activos de la orden esten despachados. La misma regla aplica a mesa, para llevar, especial, bandeja y cualquier orden visible en esa lista.
- Existen plantillas persistentes para apertura de caja:
  - `cash_register_templates`
  - `cash_register_template_denoms`
- El flujo de cobro por transferencia usa `TransferenciaPagoSection` + `TransferenciaPagoDialog`:
  - Tarjeta violeta: boton **Transferencia** + input de monto **solo lectura**.
  - Modal: banco (obligatorio, por defecto el primero del catalogo — `orden_visual`), numero de transferencia (obligatorio), boton **Exacto** y valor.
  - Boton opcional de **camara** para foto del comprobante; se guarda en Storage + `comprobantes_pago` solo al confirmar el cobro final (`payOrder`).
  - Al **Aceptar**, el monto confirmado se refleja en el input principal; al **Cancelar**, no se guarda nada.
- Los datos `banco_id`, `numero_transferencia` y `amount` se persisten en `payments` cuando el metodo es transferencia.
- La combinacion **banco + numero de transferencia** es unica en **todo el sistema** (incluye pagos anulados); se valida al aceptar el modal (mensaje inline rojo en el dialogo) y al registrar el cobro en servidor (`useCaja.payOrder` + RPC `register_payment_with_items` + indice unico).
- Mensaje canonico de duplicado: `Ya existe un pago registrado con este banco y numero de transferencia.` (`src/lib/transferenciaDuplicada.ts`).
- El catalogo `bancos` se administra en **Admin > Bancos** (solo admin global; CRUD `BancosCrud`, lectura activa via `useBancosActivos`).
- Helpers: `src/lib/transferenciaPago.ts`, `src/lib/transferenciaDuplicada.ts`.
- Migraciones: `20260712220000_bancos_y_datos_transferencia_pagos.sql`, `20260713050000_transferencia_unica_global.sql`.
- El flujo de cobro por transferencia prepara captura previa de comprobante antes del cierre final.
- El modal no debe dar por confirmado un pago de transferencia solo por el monto digitado.
- **Feedback operativo (2026-07-12):** no usar popups flotantes Sonner en el POS. `import { toast } from "sonner"` esta silenciado via alias Vite (`src/lib/sonner-stub.ts`). Errores de validacion criticos deben mostrarse **inline** en el dialogo o componente que los origina.
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
- **Visibilidad operativa y `cash_shift_id` (2026-08-07):**
  - Listas de Caja/Despacho/Servir filtran por turno abierto; una orden activa sin `cash_shift_id` puede quedar invisible.
  - Trigger `trg_assign_open_cash_shift_to_order` / función `assign_open_cash_shift_to_order` completa `cash_shift_id` si es NULL y hay turno `OPEN`.
  - Repair: `repair_open_shift_order_cash_shift_ids(p_branch_id)`.
  - Migración `20260807121000_stabilize_operational_order_visibility.sql`.
  - Lecturas de listas operativas usan `dbSelectStrict` (sin fallback Dexie que vacíe la UI).
- **Marcadores de comprobante de transferencia (`TRANSFER_PROOF_PENDING`):**
  - Prefijo canónico en `payments.notes`: `TRANSFER_PROOF_PENDING:1` (pendiente) / `:0` (resuelto).
  - Helper `setTransferProofPendingMarker` en `src/lib/paymentNoteMarkers.ts` (elimina marcadores previos del prefijo y deja uno solo).
  - Pagos con `:1` se excluyen de cuadre / pagos activos (igual que VOIDED/REVERSED).
  - Si coexisten `:1` y `:0`, prevalece `:0` (migración `20260807124500_normalize_transfer_proof_pending_notes.sql`).
- **Caja — nombre de mesa en cobrables:**
  - `PayableOrder.table_name`: para especiales usar flag `isSpecial` (no solo `order_type === DINE_IN`); si no hay `table_id`, caer a `table_name_snapshot` / `special_origin_table_id`.

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
- Una anulacion de pago puede reabrir el estado operativo de la orden (si quedan pagos activos) o cerrarla (`CANCELLED`) si era el último pago activo.
- **Historial de Anulaciones (2026-05-06):** Toda anulación de pago genera un registro de auditoría en la tabla `order_cancellations` y adjunta una nota histórica detallada al pedido (`orders.notes`), garantizando la trazabilidad del supervisor responsable y el motivo.
- **Anulación cierra la orden (2026-07-19, regla vigente):**
  - al anular el último pago activo, la orden queda `CANCELLED` con marcador `VOIDED_PAYMENT_CLOSED`: sale de Recaudar/Ordenes, libera la mesa (conserva `table_id` para restaurarla en re-cobro).
  - Si quedan pagos activos (anulación parcial con reemplazo) se reabre a `SENT_TO_KITCHEN` y el sync recalcula.
  - **Re-cobro bajo demanda:** en Pagos realizados, botón **Cobrar orden** → `preparar_orden_para_recobro` reabre la misma orden (mismo `order_code` / `order_number`).
  - Una sola anulación de pago por vida de orden (`can_void_payment`); tras re-cobrar, el nuevo pago no se puede anular.
  - Anulación total en efectivo puede devolver el tender original y reingresar el vuelto (`cash_change_return_detail`; migración `20260802180000`).
  - Ordenes legacy con `VOID_SUCCESSOR_ORDER` siguen tratadas como historicas; no se reviven.

### 5. Ordenes y mesas
- En `Ordenes.tsx`, el detalle usa `orderItems = order?.items ?? []` de forma consistente para evitar errores si la caché devuelve la orden sin arreglo `items` durante refetch (p. ej. tras cobrar); no asumir `order.items` siempre definido en render.
- Al seleccionar un producto del menu o de **Mas frecuentes**, `AddItemDialog` muestra la seccion **Modificaciones** solo si `selectedProductModifiers.length > 0`. Si la lista llega vacia por bug de resolucion, el modal sigue usable (cantidad, total, Agregar) pero sin checkboxes.
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
- El identificador visible del usuario en operación es **`profiles.alias`** (sin `@`), resuelto vía `src/lib/userDisplay.ts` (`getUserDisplayName`, `getUserAlias`, `buildUserDisplayMap`). No usar `first_name` / `full_name` en reportes, caja, turnos, despacho ni listados operativos.
- El nombre real (`getUserRealName`: nombres + apellidos) solo se muestra en administración de usuarios y como subtítulo bajo el alias en menú/cuenta.
- Esta visibilidad aplica a Ordenes, detalle de orden, Cocina, Despacho, Caja, pagos completados, Mesas/Editar Orden, Reportes (Cajero, Creador orden, CSV) y Monitoreo Global.
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
- **Despacho primero — vista de detalle de orden (actualizado 2026-08-02):**
  - `OrderItemsList` separa visualmente **En despacho** y **Despachados** cuando la sucursal usa `DISPATCH_THEN_CASH` (o Express) y hay lineas enviadas/despachadas (`splitDispatchSections`).
  - Los cambios locales (+/-, borrar, agregar borrador) **no** propagan a Despacho hasta confirmar con **Enviar a cocina**.
  - El boton **Enviar a cocina** solo aparece si hay diferencias respecto al ultimo envio confirmado; muestra el **delta monetario** (ej. `-$1.25`, `+$3.50`), no el total de la orden.
  - Staging en cliente: `kitchenBaselineItems` (ultimo envio) vs `stagedItems` (vista actual); al enviar se llama `applyKitchenPendingItemChanges(...)` y, solo si hay borradores nuevos, `submit_order_draft_items(...)`.
  - Si un item ya enviado **aumenta** de cantidad, se actualiza **la misma linea** (`set_draft_order_item_quantity` / `persistOrderItemLineQuantity`). No crear DRAFT paralelo ni dos filas que luego se consolidan.
  - Si solo se **bajan** cantidades de lineas En despacho, se aplica el diff en BD y se resetea el baseline **sin** exigir envio de borradores (no mostrar error de “aumento de cantidad”).
  - Bloqueo de edicion de despachados en vista normal: usar `isOrderItemFullyDispatched` (cantidades), no solo `status`.
  - Consolidacion visual por producto+precio también en **Editar orden → Despachados**; el `+/-` redistribuye el grupo (`redistributeGroupedItemQuantities`).
  - Reconciliacion de ids temporales (`temp-*`): `reconcileKitchenStagedItems` / `isTemporaryKitchenItemId`.
  - Tras agregar producto nuevo (DRAFT) en orden ya despachada, `submit_order_draft_items` debe aceptar envio desde `KITCHEN_DISPATCHED` (migracion `20260709220000`).
  - Archivos: `src/lib/kitchenPendingChanges.ts`, `src/lib/orderFlow.ts`, `src/hooks/useOrder.ts`, `src/pages/Ordenes.tsx`, `src/components/order/OrderItemsList.tsx`.
- La regla se valida al mostrar la accion y justo antes de ejecutar la eliminacion.
- **Navegación Contextual:** Al navegar entre Mesas y Ordenes, el sistema usa el parámetro `origin=mesas` para que el Sidebar y el Bottom Nav mantengan el resaltado en la sección de origen, evitando confusiones visuales.
- **Gestión de Mesas con Pagos Anulados (2026-05-06):** Las mesas con pagos anulados permanecen marcadas como ocupadas. La navegación es directa: el usuario hace clic en la mesa para ver el detalle y proceder al re-cobro (re-billing). Se eliminó el banner central de "Pagos Anulados" para simplificar la interfaz.

### 6. Editar Orden (In-Situ)
- `Editar Orden` ya es un flujo base del sistema y ahora opera de manera **In-Situ**.
- En Despacho primero (`DISPATCH_THEN_CASH`), el menu superior muestra **Editar orden** cuando la orden tiene al menos una unidad despachada. El modo habilita `Cancelar edicion` / `Aceptar cambios` y mantiene el despacho bloqueado con `orders.locked_for_editing`.
- La porcion **En despacho** de una linea parcial permanece fija; los controles modifican exclusivamente la cantidad **Despachada**. Los cambios son locales hasta **Aceptar cambios**.
- En **Despachados** solo se puede **bajar** o eliminar; el botón **+** está deshabilitado (más unidades → flujo En despacho → Enviar a cocina).
- Productos iguales se muestran consolidados (una fila con la suma), no una fila por `order_item_id`.
- En Caja primero (`CASH_THEN_DISPATCH`), el boton sigue limitado a ordenes editables en `SENT_TO_KITCHEN`/En Caja.
- En pantallas operativas de Mesa, Para llevar y Orden especial, una orden `DRAFT` editable debe mantener activo el menu de productos aunque se elimine un item; si ya esta `PAID`, `KITCHEN_DISPATCHED` o `CANCELLED`, el menu puede verse pero debe quedar desactivado.
- Si una orden no es editable, la pantalla debe seguir mostrando el menu de productos desactivado; no debe reemplazarlo por un panel de bloqueo que oculte el menu.
- Al editar desde el módulo de "Mesas" o "Ordenes", el usuario ya no es redirigido a la pantalla principal al aceptar o cancelar cambios, manteniendo el contexto visual del detalle de la orden.
- El Sidebar preserva su estado resaltado (ej. "Mesas") mediante el parámetro de URL `origin`.
- Usa buffer temporal en UI (`stagedItems`).
- Bloquea la orden en DB con `orders.locked_for_editing`.
- El bloqueo se propaga a Caja, donde el botón "Cobrar" se deshabilita automáticamente mientras la edición esté activa para evitar conflictos transaccionales.
- Disminuir o eliminar cantidades despachadas registra una anulacion/ajuste con `source_stage = 'DISPATCHED'`; si el usuario no puede autorizarla directamente, queda una solicitud pendiente.
- Los items nuevos agregados durante la sesion si pueden exponer `+/-`, eliminar e input de cantidad.
- Al aceptar cambios se registran y aplican automaticamente las anulaciones derivadas del buffer.
- La accion principal del modulo es `Aceptar cambios`, no `Enviar`.

### 6.1 Refresco entre módulos (2026-08-02)
- Hub Realtime `branch-ops-hub:{branchId}`; con `SUBSCRIBED` no hay poll de listas.
- Si el hub cae: poll de respaldo `OPERATIONAL_LIST_BACKUP_POLL_MS = 15s` en Despacho, Cocina, Caja, Mesas, Órdenes, Extra/Express/Para llevar/Especial.
- También `refetchOnWindowFocus` / `refetchOnReconnect` en esas listas; badge **Sync lenta** en layout.
- Doc: `docs/operational-module-refresh.md` y sección Fase 1.5 en `docs/supabase-performance-audit-phase2.md`.

### 6.2 Reportes de productos vs anulaciones parciales
- Bajar un despachado (ej. 4→3) vía Editar orden **no** reduce `order_items.quantity` crudo: deja anulacion `APPLIED` en `order_item_cancellations`.
- Caja cobra el neto (3). `useReportesProductos` debe restar cantidades canceladas aplicadas y el monto proporcional; no sumar `quantity` crudo.

### 6.3 Reportes admin (`/reportes`, 2026-08-05+)
- Distinto de los reportes imprimibles de Caja (turno/apertura).
- Filtro **Categoría de producto** sobre nodos de menú (`FiltrosPanel.tsx` → `selectedCategoryId`).
- En **Pagos**, toggle **Desglose por ítem** (`itemBreakdown`) lista filas por `order_items` de órdenes cobradas (`useReportesPagos` + `ReportePagos.tsx`).

### 7. Orden especial
- `Orden Especial` sigue siendo metadata sobre `orders`, no un `order_type` nuevo.
- Usa `orders.is_special` y `orders.special_total_manual`.
- Para ordenes especiales, `special_total_manual` es el valor manual visible/cobrable aunque `orders.total` o la suma de `order_items.total` difieran.
- **Órdenes especiales mixtas (2026-07-25+):**
  - Parte del pedido con valor manual (grupo especial) + resto a precio real; un solo cobro.
  - `order_items.cantidad_especial`; `orders.special_group_total` (NULL = especial legacy no mixta); `special_total_manual` = total general.
  - RPC `convertir_orden_especial_parcial(...)`; migraciones `20260725170000` … `20260725200000`.
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
- **Autocompletado y validación IA en Caja (actualizado 2026-07-18):**
  - Al tomar/cambiar foto en `TransferenciaPagoDialog`, se invoca automáticamente `analizar-comprobante-transferencia`.
  - Extrae numero, monto, banco origen/destino, titular/cuenta destino y fecha.
  - La Edge Function requiere usuario autenticado, optimiza la imagen en cliente y no la almacena durante el análisis.
  - Secretos remotos: `OPENAI_API_KEY` obligatorio para activar; `OPENAI_VISION_MODEL` opcional (default `gpt-4.1-mini`).
  - Admin > **Bancos de origen** define la mascara de cuenta mostrada (`#` visible; `X`/`*` oculto). Admin > **Cuentas bancarias** registra cuentas receptoras de El Pulpo.
  - Validaciones: banco/titular/cuenta destino autorizada, fecha del dia en `America/Guayaquil` y monto. En sabado o domingo tambien se acepta la fecha del lunes siguiente (los bancos registran transferencias de fin de semana con fecha del lunes).
  - El cajero decide: diferencias o datos ilegibles requieren motivo y se registran de forma inmutable en `validaciones_comprobantes_transferencia` con usuario/pago.
  - Sin secreto, error del proveedor o foto ilegible: ingreso manual + estado `NO_VERIFICABLE`; no se bloquea el cobro, pero exige motivo.

### 9. Usuarios
- Crear/editar usuario incluye datos de contacto extendidos:
  - nombre de usuario (`username`, login interno)
  - **alias** (identificador operativo unico, solo letras y numeros, visible en todo el sistema)
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
  - **alias:** solo letras y numeros; unico sin distinguir mayusculas (`idx_profiles_alias_unique_ci`)
  - cedula: solo numeros, exactamente 10 digitos
  - nombres: solo letras y espacios
  - apellidos: solo letras y espacios
  - correo: formato valido
  - telefono: solo numeros, exactamente 10 digitos
  - contrasena: minimo 6 caracteres
- **Login:** el usuario puede autenticarse con **correo**, **nombre de usuario** o **alias** (Edge Function `login-with-identifier`).
- `username` y `alias` conviven: `username` sigue siendo credencial de login; `alias` es el nombre publico en operacion.
- Usuarios existentes: migracion inicial `alias = username`.
- El combo de sucursal permite `Sin sucursal` para usuarios operativos.
- La sucursal solo es obligatoria para usuarios con rol supervisor.
- `profiles.first_name` y `profiles.last_name` son datos legales/administrativos.
- `profiles.full_name` se mantiene como compatibilidad legacy; `sync_profile_full_name()` refleja `first_name`.
- **Tabla de usuarios (admin):** columnas separadas **Usuario** (nombre real) y **Alias** (identificador operativo).
- **Menu / cuenta:** alias arriba, nombre real abajo (`AppLayout`, `SidebarNav`).
- En listados operativos compactos mostrar **alias**; cedula/telefono/nombre real solo en administracion o detalle.

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
  - existe soporte de segunda sesion de app para cualquier usuario del turno con `cash_shift_users.can_double_session = true` (no exige `can_use_caja`).
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
  - El flujo se configura por sucursal (`branches.workflow_mode`), permitiendo `CASH_THEN_DISPATCH` (Caja primero) o `DISPATCH_THEN_CASH` (Despacho primero).
  - El CRUD de administración de sucursales expone esta configuración para que el administrador pueda seleccionar el modo de flujo.
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
  - En Caja primero, `Editar orden` queda limitado a `SENT_TO_KITCHEN`/En Caja; en Despacho primero se habilita con unidades despachadas activas.
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

### 2026-06-11
- **Clientes:** módulo `/clientes` (admin) y catálogo `clientes` para cobro y promociones.
- **Campañas / Promociones:** varias campañas activas; selector en operativo; elegibilidad por `paid_at` y consumo efectivo; participación una vez por orden y campaña.
- **Cierre de ofertas:** RPC `cerrar_oferta_campana` por oferta (ganadora/perdedora); cupones vía `generar_codigo_cupon_promocion` al marcar ganadoras.
- Migraciones pendientes de aplicar en Supabase si faltan: `20260611120000` … `20260611180000`.

### 2026-05-25 / 2026-06-06
- Turno / caja:
  - Cajas unificadas: todos los cajeros pueden cobrar cualquier orden (sin flags `secondary_caja_*` para alcance de cobro).
  - `primary_cashier_id` es opcional y solo afecta defaults de UI en Recaudar.
  - Configuración en una sola lista de cajeros (usuario + plantilla; “principal” por checkbox).
  - Separación estricta: plantilla de arqueo ≠ denominaciones que puede entregar el cliente.
  - `registrar_movimiento_caja_operativo`: `PAYMENT_IN` por cajero con upsert si falta denominación en caja.
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
12. Caja unificada: no reintroducir restricciones por “secundario” ni flags `secondary_caja_*` en caja/por-cobrar/cobro.
13. Extra post-cobro: verificar `20260602120000` (sin auto-despacho), que la orden `PAID` aparezca en Despacho (Mesa/Todos) y que el cierre use `20260602130000` desde `/extra`.
16. Turno nuevo / mesas: aplicar `20260603120000_scope_table_busy_check_to_open_shift.sql`; `create_dine_in_order` solo bloquea órdenes activas del **turno abierto**, no PAID de turnos cerrados.
14. Despacho: pestaña unificada Para llevar/Express; Extra en Mesa; una tarjeta por orden; migracion `20260602140000` para snapshots batch.
15. Productos frecuentes: verificar migraciones `20260531130000` y `20260531140000`; reordenar usa `display_order` con staging positivo (no valores negativos).
17. Promociones: aplicar `20260611180000` si debe permitirse la misma orden en dos campañas; sin ella falla el segundo registro por `predicciones_orden_unica`.
18. Listado de elegibles para promoción: no filtrar solo `status = 'PAID'`; usar `paid_at IS NOT NULL` y consumo desde pagos del turno. Desde `20260623190000`, `orders.total` es confiable para órdenes nuevas; para históricas anteriores a esa fecha, preferir suma de pagos activos.
19. Campañas: `listarCampanasActivas` en operativo; no asumir una sola campaña activa (`limit 1`).
20. Token de promoción: se genera al cobrar (`paid_at` no nulo) y **no se borra** al despachar (`KITCHEN_DISPATCHED`). Migración `20260623210000`. El **QR en ticket** solo debe mostrarse si existe al menos una campaña activa con ofertas registrables (`hayPromocionRegistrableEnRecibo`, `campanaTieneOfertasRegistrables`); migraciones `20260709200000` (trigger solo con campaña activa) y `20260709210000` (solo ofertas registrables). Sin campaña/oferta valida, no imprimir QR aunque exista `token_promocion` en BD.
21. **Modificaciones en modal de producto:** no reintroducir dependencia exclusiva de `node.ancestor_ids` para resolver herencia; usar `parentByNodeId` del catalogo. No cachear lookup de producto con lista vacia de modificadores. Invalidar `branch-modifiers-catalog` al cambiar `menu_node_modifiers` en admin.
22. **Despacho primero — cocina pendiente y edicion:** no invalidar `dispatch-orders` al editar lineas En despacho en vista normal; solo al confirmar **Enviar a cocina**. Mostrar **Editar orden** cuando haya unidades despachadas y confirmar sus ajustes con trazabilidad.
23. **Despacho — consolidacion UI:** no separar el mismo producto en varias filas si comparten descripcion, precio, modificadores y nota; usar `consolidateDispatchOrderItems`.
24. **Extra vs workflow:** no mostrar `/extra` en nav cuando `branches.workflow_mode = DISPATCH_THEN_CASH`.
25. **Auth en tablet/Capacitor:** no reactivar banner global por `AbortError` benigno de Web Locks; mantener `auth.lock` no-op en cliente Supabase y `isBenignAuthLockAbort` en `main.tsx`.
26. **Despacho primero — cobro en Caja:** no abrir `PaymentDialog` si `ready_to_collect = false`; mantener validacion en `payOrder` y calculo con `computeUndispatchedQuantity` sobre todos los items no `DRAFT` de la orden.
27. **Cocina pendiente — ids temp:** tras `addItem` con staging, reconciliar `stagedItems` con servidor; no dejar `temp-*` huerfanos que bloqueen el boton Enviar a cocina.
28. **Migraciones Jul 9 pendientes en Supabase:** `20260709200000`, `20260709210000`, `20260709220000` (token/QR promocion y envio post-despacho).
29. **Forzar cierre:** no confundir con `close_cash_shift_with_tables`; exige confirmación `FORZAR` y permiso MANAGE; migración `20260806040000`.
30. **Visibilidad operativa:** órdenes activas sin `cash_shift_id` pueden desaparecer de Caja/Despacho; aplicar trigger/repair `20260807121000` y usar `dbSelectStrict`.
31. **Marcadores transferencia:** no dejar `TRANSFER_PROOF_PENDING:1` y `:0` juntos; usar `paymentNoteMarkers.ts`; normalización `20260807124500`.
32. **Especial mixta:** respetar `special_group_total` + `cantidad_especial`; no tratar como especial legacy puro si `special_group_total` no es NULL.

### Actualizacion Ago 5–7, 2026
- **Agregar al instante:** `AddItemDialog` abre con shell optimista; lookup de producto/modificadores en background (`Ordenes.tsx`, `AddItemDialog.tsx`).
- **Reportes admin:** filtro por categoría de producto; en Pagos, toggle **Desglose por ítem** (`itemBreakdown`).
- **Forzar cierre de turno:** `/forzar-cierre-turno`, RPC `force_close_cash_shift`, migración `20260806040000`.
- **Visibilidad operativa:** trigger `assign_open_cash_shift_to_order` + `repair_open_shift_order_cash_shift_ids`; `dbSelectStrict` en listas; migración `20260807121000`.
- **Marcadores comprobante:** `TRANSFER_PROOF_PENDING` vía `paymentNoteMarkers.ts`; normalización `20260807124500`.
- **Naming mesa en cobrables:** `isSpecial` + `special_origin_table_id` / `table_name_snapshot` en `useCaja`.
- **Anulación / vuelto exacto:** `cash_change_return_detail` (`20260802180000`).
- **Especial mixta (Jul 25, documentada aquí):** `cantidad_especial`, `special_group_total`, `convertir_orden_especial_parcial`.

### Actualizacion Jul 20, 2026 — Timeout al cerrar turno (Local Principal)
- **Síntoma:** al cerrar turno aparece `canceling statement due to statement timeout`.
- **Causa:** `close_cash_shift_with_tables` evaluaba bloqueantes dos veces y `list_branch_closure_blocking_orders` llamaba `order_is_fully_dispatched` → `get_order_operational_snapshot` por cada orden `PAID` del turno (N+1). En sucursales con alto volumen (p. ej. Local Principal) superaba el `statement_timeout`.
- **Fix:** migración `20260720140000_fix_close_shift_statement_timeout.sql` — chequeo set-based de despacho pendiente, cancelación de borradores acotada al turno `OPEN`, una sola pasada de bloqueantes y `SET LOCAL statement_timeout = '120s'` en el cierre.

### Actualizacion Jul 18–19, 2026 — IA de comprobantes, anulaciones y caja en tablet
- **Cuentas destino + validación IA (Jul 18):** Admin > **Cuentas bancarias** (`cuentas_bancarias_destino`) y máscara por banco origen en **Bancos de origen**. `TransferenciaPagoDialog` analiza la foto con la Edge Function `analizar-comprobante-transferencia` y valida banco/titular/cuenta destino, fecha (Ecuador) y monto. Diferencias o datos ilegibles exigen motivo y se guardan inmutables en `validaciones_comprobantes_transferencia`. Migración `20260718100000`.
- **Fecha en fin de semana (Jul 19):** la validación acepta la fecha de hoy y, si es sábado o domingo, también la del lunes siguiente (los bancos registran transferencias de fin de semana con fecha del lunes). Helper `fechasAceptadasComprobante` en `src/lib/validacionComprobanteTransferencia.ts`; solo frontend.
- **Editar orden en Despacho primero:** con al menos una unidad despachada, la opción aparece en el menú superior; los controles afectan solo la porción despachada (buffer hasta **Aceptar cambios**) y las reducciones/eliminaciones se registran como anulación/ajuste. Helpers `getDispatchedEditQuantity` / `getDispatchedEditTargetQuantity` en `src/lib/orderFlow.ts`.
- **Fix cancelaciones Despacho primero (Jul 18):** `cancel_order_quantities` y `set_draft_order_item_quantity` casteaban `''` al enum `order_type` (error `22P02`), lo que hacía fallar en silencio reducciones/eliminaciones y podía impedir que un item nuevo agregado tras despachar llegara a Despacho. Corregido con `::text` en `20260718230000`. Además, `Ordenes.tsx` muestra toast si falla `applyKitchenPendingItemChanges` y el botón **Enviar a cocina** ahora aparece siempre que haya borradores `DRAFT`.
- **Forma de devolución al anular transferencia (Jul 18):** el cajero elige **En efectivo** (afecta caja) o **Por transferencia** (no afecta caja) mediante un combo en `PaymentReversalModal`. Se persiste `refund_method` y `approve_and_void_payment` lo respeta. Migración `20260718225000`.
- **Anulación cierra la orden (Jul 19):** al anular el último pago activo la orden queda `CANCELLED` (`VOIDED_PAYMENT_CLOSED`): desaparece de Recaudar y libera la mesa. Se puede re-cobrar bajo demanda con **Cobrar orden** en Pagos realizados. Migración `20260719010000`.
- **Una anulación por orden (Jul 19):** una orden solo admite una anulación de pago en toda su vida; tras re-cobrarla, el nuevo pago no se puede anular (`can_void_payment` lo bloquea; botón Anular visible pero desactivado). Migraciones `20260719012000` y fix de ambigüedad `20260719013000`.
- **Denominaciones en tablet (Jul 19, solo frontend):** `useCaja` lee `cash_shift_denoms` con query directa a Supabase (no cache local que devolvía `[]` en fallo de red), guardia de consistencia y `refetchInterval` (~20 s) para auto-sanar tablets/PWA con datos viejos. `PaymentDialogV2` muestra mensaje de carga/conexión mientras no lleguen las denominaciones.

### Actualizacion Jul 15–16, 2026 — Autopedidos QR en mesa

Módulo que permite al comensal escanear un QR físico en la mesa, ver el menú de mesas y enviar un pedido desde el celular. El personal del turno debe **aprobar** el pedido antes de que entre al flujo normal del POS.

#### Flujo operativo
1. **Admin** genera tokens en `/admin` → pestaña **Mesas QR** (`QrMesasAdmin.tsx`).
2. Cada mesa obtiene URL pública: `/qr-pedido/:token_seguro`.
3. El comensal abre la URL (sin login). Requiere **turno `OPEN`** en la sucursal del token.
4. El comensal arma el pedido (menú `TABLE` only) y envía.
5. La orden queda `status = 'DRAFT'`, `es_autopedido_qr = true`, `estado_aprobacion_qr = 'PENDIENTE'`.
6. En el POS, badge + panel **Autopedidos entrantes** (`AutopedidosQrPanel.tsx`).
7. **Aprobar** → `aprobar_autopedido_qr` → `submit_order_draft_items` → `SENT_TO_KITCHEN` + `estado_aprobacion_qr = 'APROBADO'`.
8. **Rechazar** → `rechazar_autopedido_qr` → ítems `CANCELLED`, orden `CANCELLED`, `estado_aprobacion_qr = 'RECHAZADO'`.
9. Tras aprobar, la orden sigue el flujo canónico: En Caja → Pagada → Despachada (según `workflow_mode`).

#### Web App del cliente (`/qr-pedido/:token`)
- Ruta pública en `App.tsx` (hermana de `/login` y `/promociones/registro`); **sin** `AuthGate` ni `AppLayout`.
- Página: `src/pages/QrPedido.tsx`. Servicio: `src/services/autopedidosQrDb.ts`.
- **Mobile-first:** `max-w-md`, `pt-safe`, botones táctiles ≥ 44px, sin popups Sonner.
- **Identificación opcional:** cédula 10 dígitos → `buscar_cliente_autopedido_qr` / `registrar_cliente_autopedido_qr`; puede omitirse (`cliente_id` NULL).
- **Menú:** solo `menu_scope = 'TABLE'` vía `obtener_menu_autopedido_qr`. **Excluye** Con envase (`TAKEOUT`) y A granel (`BULK`).
- **Modificadores:** herencia por ancestros en cliente (`obtener_modificadores_autopedido_qr` + resolución `parent_id`); misma lógica que POS pero sin depender de `ancestor_ids`.
- **Envío:** RPC `crear_orden_autopedido_qr(p_token_seguro, p_items jsonb, p_cliente_id)`.
- `p_items`: array `{ menu_node_id, quantity, item_note?, unit_price?, modifier_ids? }`.

#### Admin — generación de QR
- Pestaña **Mesas QR** en `Admin.tsx` (`QrMesasAdmin.tsx`).
- Campo **Cantidad de mesas** configurable (1–100; sugerido según mesas de la sucursal).
- Antes de generar: `ensure_branch_table_capacity` + RPC `generar_tokens_qr_mesas_sucursal(p_sucursal_id, p_limite)`.
- Tokens **estables:** al regenerar se reactivan filas existentes; no se rotan (QR impresos siguen válidos).
- Impresión: vista con QR (`qrcode` → data URL) + botón **Imprimir**.
- Permiso: admin global o `can_manage_branch_admin` en la sucursal.

#### POS — aprobación
- Badge discreto en header móvil (`AppLayout`) y sidebar desktop (`SidebarNav`) cuando `contar_autopedidos_pendientes > 0`.
- Panel lateral: `AutopedidosQrPanel.tsx`; datos: `useAutopedidosQrPendientes.ts`.
- Listado agrupado por mesa; actualización vía hub Realtime operativo (`useOperationalOrdersRealtime`); poll de respaldo solo si hub ≠ SUBSCRIBED (`OPERATIONAL_LIST_BACKUP_POLL_MS`).
- Quien puede gestionar: `usuario_puede_gestionar_autopedidos_qr` (mesero, caja, supervisor o admin en turno `OPEN`).

#### Base de datos (nomenclatura en español)
- Tabla `tokens_qr_mesas`: `id`, `sucursal_id`, `mesa_id`, `token_seguro`, `activo`, `creado_en`, `actualizado_en`.
- `orders`: `es_autopedido_qr`, `estado_aprobacion_qr` (`PENDIENTE`|`APROBADO`|`RECHAZADO`), `token_qr_id`.
- `orders.created_by` nullable solo si `es_autopedido_qr = true` (comensal no es usuario auth).
- Trigger `trg_orders_normalizar_estado_aprobacion_qr`: órdenes no-QR siempre `APROBADO`.

#### Seguridad
- Lectura anónima acotada: `tokens_qr_mesas` activos + turno `OPEN`; `menu_nodes`/`modifiers`/`menu_node_modifiers` solo `TABLE`.
- Escritura del comensal vía RPCs `SECURITY DEFINER` (patrón promociones públicas), no inserts directos desde UI.
- Policies INSERT `TO anon` en `orders`/`order_items` documentan el contrato; camino operativo real: `crear_orden_autopedido_qr`.

#### Migraciones obligatorias
- `20260716000000_autopedidos_qr.sql` — esquema, RLS, RPCs.
- `20260716010000_fix_gen_random_bytes_tokens_qr.sql` — `token_seguro` con `gen_random_uuid()` (no `pgcrypto.gen_random_bytes`).

#### Archivos clave
| Capa | Archivos |
|------|----------|
| SQL | `supabase/migrations/20260716000000_autopedidos_qr.sql`, `20260716010000_fix_gen_random_bytes_tokens_qr.sql` |
| Servicio | `src/services/autopedidosQrDb.ts` |
| Cliente | `src/pages/QrPedido.tsx` |
| Admin | `src/components/admin/QrMesasAdmin.tsx` |
| POS | `src/components/autopedidos/AutopedidosQrPanel.tsx`, `src/hooks/useAutopedidosQrPendientes.ts` |
| Shell | `src/App.tsx`, `src/components/AppLayout.tsx`, `src/components/SidebarNav.tsx`, `src/pages/Admin.tsx` |

#### Riesgos / no romper
29. **Autopedidos QR:** requiere migraciones `20260716000000` y `20260716010000` aplicadas en Supabase remota.
30. **Autopedidos QR:** no usar `gen_random_bytes` para tokens; usar `gen_random_uuid()` concatenado.
31. **Autopedidos QR:** menú cliente solo `TABLE`; no exponer `TAKEOUT`/`BULK` en `/qr-pedido`.
32. **Autopedidos QR:** sin Sonner; errores inline (`role="alert"`, `text-destructive`).
33. **Autopedidos QR:** aprobar siempre vía `aprobar_autopedido_qr` (no `submit_order_draft_items` directo sin marcar `APROBADO`).
34. **Autopedidos QR:** no confundir con QR promocional de ticket (`token_promocion` / `promocionesRecibo.ts`).

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
   - si usa doble sesion, que tenga `can_double_session = true` en el turno abierto (no requiere `can_use_caja`)
7. Si falla **Autopedidos QR** (Admin / cliente / POS), revisar:
   - migraciones `20260716000000` y `20260716010000` aplicadas en Supabase remota
   - turno `OPEN` en la sucursal del token (cliente ve error si está cerrado)
   - tabla `tokens_qr_mesas` existe y token `activo = true`
   - error `gen_random_bytes` → aplicar fix `20260716010000`
   - pedido pendiente: `estado_aprobacion_qr = 'PENDIENTE'` y permisos `usuario_puede_gestionar_autopedidos_qr`

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
- **Configuración Dinámica de Impresoras:** Se implementó el soporte para configurar la dirección IP (`printer_ip`) y el puerto (`printer_port`) de la impresora térmica de forma individual por sucursal en la tabla `public.branches`. Los valores se obtienen al iniciar la aplicación mediante `public.get_my_access_context()`, se exponen en `BranchContext.tsx` y se persisten en `localStorage` (`activePrinterIp`, `activePrinterPort`) al cambiar de sucursal activa. La lógica de impresión nativa en `thermalPrint.ts` lee estos valores dinámicos y, si no están definidos, recurre como fallback a las variables de entorno `VITE_THERMAL_PRINTER_IP` y `VITE_THERMAL_PRINTER_PORT`.
- **Mejoras en el Formato de Impresión ESC/POS:** 
  - **Uso de Font B y Espaciado:** El detalle de productos, los totales y la sección de pie de página se formatean usando la fuente compacta Font B (activada mediante `ESC ! 0x01` y `ESC M 1` para máxima compatibilidad con impresoras genéricas). El espaciado de línea se fijó en 40 puntos para mejorar la legibilidad y evitar amontonamiento de texto.
  - **Margen y Alineación de Productos:** Para alinear visualmente la lista de productos y centrar/mover el contenido hacia la derecha, se estableció un margen izquierdo de 8 caracteres. El sistema envuelve automáticamente la descripción de productos para que se ajuste exactamente a la longitud neta disponible (40 caracteres por línea).
  - **Evitar Corte del Código QR:** Para solucionar que el cortador físico cortara el código QR antes de tiempo, se añadió una restauración explícita a Font A y espaciado de línea por defecto (`lineSpacing(null)`) inmediatamente antes de enviar el comando de avance final y corte físico (`feedAndCut`).

### Actualizacion Jun 23, 2026
- **Fix: `orders.total` siempre sincronizado:** El campo `orders.total` solo se actualizaba al cancelar items. Si no había cancelaciones, quedaba en `0` aunque los items tuvieran valor, lo que impedía que `sync_order_payment_state_internal` reconociera la orden como pagada. Trigger `trg_sync_order_total` y recalculo en `sync_order_payment_state_internal` resuelven esto.
- **Fix: `PAID` terminal e inmutable:** `sync_order_payment_state_internal` ahora retorna inmediatamente si la orden ya es `PAID` o `CANCELLED`. Antes, si la cocina despachaba después del cobro, la recomputación operativa podía revertir el estado `PAID` a `KITCHEN_DISPATCHED`, borrando el token de promoción.
- **Fix: TAKEOUT/EXPRESS siempre pasan a `PAID`:** La lógica anterior dejaba órdenes TAKEOUT/EXPRESS en `READY` o `KITCHEN_DISPATCHED` cuando el cajero cobraba antes del despacho. Ahora cualquier orden con pago completo pasa directamente a `PAID`.
- **Purga de órdenes fantasma:** Triggers que cancelan automáticamente órdenes activas sin items. Funciones `purge_empty_order` / `purge_empty_orders_for_branch`. Filtro `item_count > 0` en UI de ParaLlevar y Express.

### Actualizacion Jun 28, 2026
- **Alias de usuario (identificador operativo):** Nueva columna `profiles.alias` (NOT NULL, unico case-insensitive, alfanumerico). Backfill `alias = username`. Migracion `20260628120000_add_profile_alias.sql`. RPCs actualizadas: `handle_new_user`, `admin_list_users_access`, `list_shift_users_for_branch`. Edge Functions: `login-with-identifier`, `create-user`, `void-payment` aceptan correo/usuario/alias. Frontend: `src/lib/userDisplay.ts` centraliza `getUserAlias`, `getUserDisplayName` (alias en operacion), `getUserRealName` (nombre legal). Reportes, caja, turnos y ordenes muestran alias; admin muestra nombre real + alias; menu muestra alias arriba y nombre abajo.
- **Unificación del Canal de Descuentos Promocionales en Checkout**: Se desactivó la reducción automática de totales por "Descuento por Oferta Pasada" (`discountAmount`) en [PaymentDialogV2.tsx](file:///c:/sistema-el-pulpo/src/components/caja/PaymentDialogV2.tsx) para evitar que los pronósticos ganados se apliquen por partida doble al estar también en el Monedero Promocional (Saldo a Favor). Ahora, los cobros se gestionan limpiamente a través de la casilla de saldo a favor del monedero del cliente.
- **Sincronización de Base de Datos para Pronósticos Ganados**: Se actualizó la función trigger `procesar_pago_saldo_fifo()` para que cuando un cliente pague usando su saldo promocional, el cupón de la predicción correspondiente se marque automáticamente como usado (`cupon_usado_el = now()`), previniendo fugas y manteniendo la consistencia de auditoría. Se corrigió además la función `cerrar_oferta_campana` que estaba omitiendo la asignación de montos ganados y la creación de saldos en el monedero al calificar partidos.

### Actualizacion Jul 2, 2026
- **Cobro de Órdenes Especiales:** Se corrigió la lógica de cobro para permitir registrar transacciones de órdenes especiales que no tienen un total manual configurado (se calculan dinámicamente usando el total real de los ítems en su lugar). Se resolvieron errores de referencia de variables y se actualizó el mapeo de `payableOrder` tanto en el hook de Caja como en la vista de Órdenes.
- **Rediseño Móvil del Modal de Cobro (Dividir Pago):** Ajuste de altura dinámica a `94dvh` en móviles portrait, reducción de tipografías, reorientación dinámica de flechas arriba/abajo según viewport vertical, y eliminación de textos de instrucción redundantes.
- **Precio e Inputs de Items en Tiempo Real:** Sincronización instantánea de entradas en `OrderItemsList.tsx` con un debouncing de 500ms usando el componente `PriceInput` para prevenir peticiones redundantes.
- **Cabecera Sticky y UI en Ordenes:** Se fijó la cabecera de la mesa/orden en la parte superior (`sticky top-[56px] md:top-0 z-20`) con un fondo opaco degradado para evitar que los elementos que hacen scroll se transparenten por detrás. Se eliminó la pestaña "A granel" en órdenes especiales y se removió el botón flotante inferior en móviles para delegar la interacción al icono de bandeja superior.
- **Limpieza de UI en Despacho:** Eliminación de los contadores detallados `Env:`, `Desp:`, `Falt:`, `Canc:` en las tarjetas de despacho de todas las categorías.
- **Persistencia de Sesión Ampliada:** Se extendió el tiempo de cierre de sesión por inactividad de 40 minutos a exactamente 1 hora (`60` minutos) en `AuthContext.tsx`.

### Actualizacion Jul 7, 2026
- **Fix: modificaciones intermitentes en modal de agregar producto (`Ordenes.tsx`):**
  - Causa raiz: herencia de modificadores desde categoria padre fallaba cuando el nodo no traia `ancestor_ids` (tipico en **Mas frecuentes**); carreras async por doble toque en movil; cache React Query de 60 s que congelaba listas vacias; consultas `.in(node_id, todos)` sin trocear en sucursales grandes.
  - Correccion: `fetchBranchModifiersCatalog` ahora incluye `parentByNodeId` y consultas en chunks de 200; `resolveModifierNodeIds` recorre ancestros desde el catalogo; `productSelectSeqRef` ignora respuestas obsoletas; lookup directo sin cache `menu-product-lookup`; invalidacion de `branch-modifiers-catalog` en `useNodeModifiers` y `MenuNodesCrud`.
  - Archivos: `src/pages/Ordenes.tsx`, `src/hooks/useNodeModifiers.ts`, `src/components/admin/MenuNodesCrud.tsx`, `src/components/order/AddItemDialog.tsx`.
- **Fix: banner naranja `AbortError: The lock request is aborted` en tablet/WebView:**
  - Causa: Web Locks API de Supabase Auth (`autoRefreshToken`, `getSession`) compitiendo con validacion de sesion en `AuthContext` en entorno Capacitor.
  - Correccion: `src/lib/benignAsyncErrors.ts` (`isBenignAuthLockAbort`, `logBackgroundTaskError`); listener global en `src/main.tsx` silencia aborts benignos; `auth.lock` no-op en `src/integrations/supabase/client.ts`; `catch` en `validateSingleSession` y `checkSessionAge` de `AuthContext.tsx`.
  - Sin migracion SQL; requiere despliegue de frontend en tablets.

### Actualizacion Jul 9–10, 2026
- **Caja — boton Cobrar rojo (Despacho primero):** En `DISPATCH_THEN_CASH`, si cualquier item de la orden tiene unidades sin despachar, `PayableOrdersList` muestra boton rojo y `AlertDialog` de bloqueo. Campos `ready_to_collect` y `undispatched_units` en `PayableOrder`; helper `computeUndispatchedQuantity`; validacion en `payOrder`. Aplica a todas las ordenes en “Ordenes por cobrar”.
- **QR promocion en ticket:** Solo si hay campaña activa con ofertas registrables (`src/lib/promocionesRecibo.ts`, `src/lib/campanasValidacion.ts`). Sanitizacion en impresion termica y dialogs de pago. Migraciones `20260709200000`, `20260709210000`.
- **Enviar a cocina tras despacho total:** `submit_order_draft_items` acepta ordenes `KITCHEN_DISPATCHED` con borradores nuevos (`20260709220000`). `sendToKitchen` refetch antes de enviar y error si no hay borradores.
- **Staging cocina — fixes:** `reconcileKitchenStagedItems` para ids `temp-*`; reset de baseline tras envio exitoso. *(Nota Ago 2026: aumentos en lineas enviadas ya no crean DRAFT; ver Actualizacion Ago 2.)*
- **Monitoreo Global:** Fix colgado (import `useBranch`, orden de hooks, realtime menos agresivo, polling 60 s).

### Actualizacion Ago 2, 2026
- **Refresco entre módulos:** poll de listas 25 s solo si hub Realtime ≠ SUBSCRIBED; focus/reconnect refetch; badge Sync lenta; invalidaciones cocina↔servir/caja. Doc: `docs/operational-module-refresh.md`.
- **Staging / Editar orden:** aumentos in-place; bajas sin error de “aumento”; consolidación en Despachados al editar; `+` deshabilitado en despachados.
- **Reportes:** `useReportesProductos` resta anulaciones `APPLIED` (neto = lo cobrable).
- **Admin bypass turno:** `20260802190000_admin_bypass_shift_enablement.sql`.
- **Recaudar:** sin filtro por cajero.
- **Fix add item:** `20260803010000_fix_add_dine_in_order_item_vnode.sql`.

### Actualizacion Jul 14, 2026
- **Sesión doble (persistencia al abrir turno):** `open_cash_shift_with_tables` ya no hace `can_double_session AND can_use_caja`. El cliente envia `can_use_caja=false` al abrir y la caja se aplica despues; el `AND` dejaba el flag siempre en `false`. Migracion `20260714230000_fix_open_shift_sesion_doble.sql` (tambien reafirma `normalize_cash_shift_user_capabilities` y `user_has_double_app_session_permission`). Tras `apply_shift_caja_configuration`, `ShiftSetupAdmin` llama `restoreDoubleSessionFlags`.
- **Sesión doble — cierre fantasma (AuthContext):** al refrescar token el `user` podia pasar a `null` y el efecto borraba `authOwnedSingleSession`; al volver se registraba un UUID nuevo que pisaba el slot secundario y cerraba el otro dispositivo. Fix: no limpiar ese storage en parpadeos; validar slots con select directo a `profiles`; escribir el id local antes del RPC. Migracion `20260714240000_harden_register_double_session.sql` endurece `register_my_single_session` (con doble sesion y ambos slots ocupados, reemplaza el mas antiguo por `started_at`).
- **Re-cobro tras anulación / comprobantes:** ver secciones operativas de re-cobro misma orden y `comprobantes_pago` (migraciones `20260714120000` … `20260714220000`).

### Actualizacion Jul 12, 2026
- **Cobro por transferencia — datos bancarios:**
  - Tabla `bancos` (catalogo global) y columnas `payments.banco_id`, `payments.numero_transferencia`.
  - UI: `TransferenciaPagoDialog`, `TransferenciaPagoSection` en `PaymentDialogV2` y `PaymentDialogSecondary`.
  - Admin: pestaña **Bancos** (`BancosCrud`); seed de bancos ecuatorianos en migracion.
  - Banco por defecto al abrir modal: primer registro activo por `orden_visual` (ej. Banco Pichincha).
- **Unicidad global de comprobante:**
  - Indice `idx_payments_transferencia_unica` sobre `(banco_id, lower(trim(numero_transferencia)))`.
  - Validacion cliente (`existeTransferenciaDuplicada`) + servidor en `register_payment_with_items`.
  - Mensaje inline en modal; sin depender de toast flotante.
- **Sin popups Sonner en POS:**
  - Alias Vite `sonner` → `src/lib/sonner-stub.ts` (toasts silenciados).
  - Evita mensajes como *"Orden lista para cobrar en caja"* u otros `toast.success`/`toast.error` flotantes.
  - Mantener feedback en UI contextual (texto destructive en dialogos, `payValidationMessage`, `AlertDialog`, etc.).

### Actualizacion Jul 8, 2026
- **Despacho primero — cambios pendientes de cocina:**
  - En mesa con `DISPATCH_THEN_CASH`, editar lineas **En despacho** ya no persiste de inmediato en BD ni actualiza Despacho.
  - Los cambios quedan en `stagedItems` hasta pulsar **Enviar a cocina**; entonces `applyKitchenPendingItemChanges` aplica el diff y `submit_order_draft_items` envia borradores.
  - El boton muestra solo si hay pendientes y etiqueta con **delta en dinero** vs el ultimo envio (`formatKitchenSendMoneyDelta` en `kitchenPendingChanges.ts`).
- **UI orden — secciones En despacho / Despachados:** `OrderItemsList` con `splitDispatchSections` (vista normal y, si aplica, modo edicion en Caja primero).
- **Editar orden en Despacho primero:** opcion condicionada a unidades despachadas, buffer temporal y anulacion/ajuste al confirmar reducciones.
- **Despacho — lineas consolidadas:** mismo producto/precio/modificadores en una fila; despacho parcial reparte por `source_lines` (`dispatchItemConsolidation.ts`).
- **Extra oculto en Despacho primero:** nav sin `/extra`; `usePreferredHomePath` no envia empacadores a Extra; `/extra` redirige a Mesas.
- **RPC `remove_order_item_line`:** elimina o reduce lineas enviadas sin dialogo de anulacion en despacho primero (migraciones `20260707240000`, fix `20260707241000`). Usado al confirmar envio a cocina.
- **Dev — Fast Refresh:** `showSystemAlert` movido de `App.tsx` a `src/lib/systemAlert.ts` para evitar recargas completas en HMR.
