# Codex Rules

## Objetivo
Preservar continuidad tecnica y funcional del POS sin revertir decisiones operativas ya consolidadas.

## Reglas obligatorias vigentes

### 0. Estado canonico de orden
- No reinterpretar `READY` ni `KITCHEN_DISPATCHED` como "pagado".
- El flujo correcto es `DRAFT`/Borrador -> `SENT_TO_KITCHEN`/En Caja -> `PAID`/Pagada -> `KITCHEN_DISPATCHED`/Despachada.
- `Despacho` solo debe listar y operar ordenes `PAID` con cantidades activas pendientes de despacho.
- `Despacho` debe mostrar una sola tarjeta/fila por orden pagada (`orders.id` / `order_code`). Nunca separar la misma orden en varias tarjetas por `sent_to_kitchen_at` de sus items.
- `dispatch_order_quantities(...)` debe rechazar cualquier orden que no este `PAID`.
- `PAID` y `KITCHEN_DISPATCHED` son clasificaciones visibles excluyentes. Una orden no puede aparecer simultaneamente en `Pagada` y `Despachada`.
- Al anular un pago, la orden original queda historica `CANCELLED` con `VOID_SUCCESSOR_ORDER`; la sucesora activa queda con numero nuevo en `SENT_TO_KITCHEN`/En Caja.
- La anulacion operativa de pago solo aplica sobre ordenes `PAID` que no esten `KITCHEN_DISPATCHED`.

### 1. Refactor incremental
- No abrir un modelo nuevo si el flujo actual ya existe y puede extenderse.
- Si convive legacy con modelo nuevo, documentar claramente que parte ya migro y que parte no.

### 2. Seguridad en backend/BD primero
- La UI no define seguridad.
- Validar permisos reales por sucursal/modulo y, cuando aplique, por turno.
- Las reglas de flujo global deben vivir en BD/RPC y no solo en texto/botones del frontend.
- Si se toca bloqueo de sesion, revisar tanto la sesion principal como la sesion secundaria autorizada por `cash_shift_users.can_double_session`.

### 2.1 Flujo global Caja - Despacho
- Todas las sucursales trabajan con el mismo flujo: cobro primero y despacho despues, **excepto Express** (`order_type = EXPRESS`): despacho primero, cobro total despues en Caja cuando la orden esta `KITCHEN_DISPATCHED`.
- El CRUD de sucursales no debe mostrar un campo de flujo ni un check `Mesero-Cajero`.
- `branches.workflow_mode` queda como compatibilidad interna y debe estar forzado a `CASH_THEN_DISPATCH`.
- Mesa, para llevar y orden especial pasan primero a Caja; una vez pagadas pasan a Despacho.
- Una orden `PAID` de mesa permanece visible en la mesa hasta ser despachada; pagarla no libera la mesa ni debe ocultarla del detalle.
- **Para llevar (UI):** una orden `TAKEOUT` puede permanecer visible dentro de `Para llevar` aunque ya esté `PAID`; solo debe salir del grupo cuando el despacho haya sido aplicado.
- **Para llevar / Orden especial (UI):** sus modulos principales son grillas de tarjetas dinamicas, no redirecciones automaticas ni pestanas internas de orden. La tarjeta `+` siempre existe. Los borradores vacios no se muestran; los borradores con items y las ordenes activas posteriores se muestran hasta que exista despacho aplicado.
- Las tarjetas de `Mesas`, `Para llevar` y `Orden especial` deben conservar el mismo formato visual; solo cambia el icono/logo de la tarjeta. El numero superior es el orden visual consecutivo y el codigo/numero de orden debe mostrarse completo una sola vez junto al usuario creador.
- En `Despacho`, `Para llevar` y `Orden especial` se despachan siempre como orden completa. El detalle puede expandirse para consulta, pero no debe mostrar botones de despacho por item.
- Si se toca envio de ordenes, revisar `submit_order_draft_items(...)`.
- Si se toca cobro o estado post-pago, revisar `sync_order_payment_state_internal(...)` y `useCaja`.
- Las políticas RLS deben permitir que usuarios operativos asignados a un turno activo accedan a `cash_register_templates`.

### 2.2 Cobro en caja: UI unificada y rendimiento
- La UI estándar de cobro es `PaymentDialogV2` (misma UI para todos los cajeros).
- V2 y Secondary deben enviar a `payOrder` los mismos invariantes (`PayOrderParams`) que el clásico.
- **Plantilla de apertura ≠ denominaciones de cobro:**
  - Plantilla (`cash_register_template_denoms`, `OpenShiftForm`): arqueo inicial del cajero en `cash_shift_denoms`.
  - Cobro (UI): catálogo `denominations` activas vía `catalogToPaymentDenoms` (`src/lib/cajaDenominations.ts`).
  - Cambio: inventario del cajero (`drawerDenoms` / `shift.denoms`).
  - BD: `registrar_movimiento_caja_operativo` con `PAYMENT_IN` debe crear fila en `cash_shift_denoms` del cajero si falta (`20260528130000_payment_in_upsert_per_cashier.sql`).
- No listar solo `shift.denoms` en botones de monedas/billetes del diálogo de cobro.
- **Base de datos:** cualquier entorno donde se cobre debe tener aplicada la migración `20260509180000_payment_items_sync_once_per_statement.sql`; sin ella, cada fila de `payment_items` dispara una sincronización completa de orden y el POS se siente lento.
- **Cliente (`DatabaseService`):** reservar `hotPath` en `dbInsert`/`dbInsertMany` solo cuando el registro lleve `id` (u otros NOT NULL) generados en cliente; reservar `skipLocalCache` en `dbSelect` para lecturas calientes del flujo de cobro donde no haga falta actualizar Dexie en el mismo tick.
- No reintroducir llamadas redundantes a `sync_order_payment_state` tras un cobro exitoso si los triggers ya actualizaron la orden (salvo flujos de reparación explícitos documentados).
- En UI post-cobro (`PaymentDialogV2`, `PaymentReceipt`, detalle en `Ordenes.tsx`), no asumir `items` ni `payments` definidos: usar `?? []` y pasar al recibo el objeto `receipt` completo que devuelve el flujo de pago.

### 3. Catalogo
- `menu_nodes` es la fuente principal de estructura.
- Mantener soporte para `TABLE`, `TAKEOUT` y `BULK` (y `EXTRA` en BD si aplica arbol dedicado).
- Mientras `order_items.product_id` apunte a `products`, toda venta debe preservar puente legacy.
- `manual_price_enabled` sigue viviendo en `menu_nodes`, no en `products`.
- **Productos frecuentes:** tabla `extra_frequent_products` con `context` (`MESA`, `TAKEOUT`, `EXPRESS`, `EXTRA`); admin en `/admin` > Mas frecuentes; UI operativa `FrequentProductCards` en `Ordenes.tsx`. Sin limite de cantidad. Reordenar en BD con staging de `display_order` positivo (no negativos).

### 4. Caja y turno no son lo mismo
- No mezclar cierre de caja con cierre de turno.
- No asumir una sola caja abierta por turno: cada cajero con `can_use_caja` abre la suya (`cash_register_openings` + `cash_shift_denoms` por `cashier_id`).
- La UI y el gate operativo usan `get_my_branch_shift_gate(...).caja_status` / `get_user_caja_status`, no `cash_shifts.caja_status` global, para decidir si mostrar cobros o el formulario de apertura.
- Varios usuarios pueden tener `can_use_caja` en el mismo turno hasta `cash_shifts.max_caja_sessions`; no reintroducir indice/trigger de un solo cajero por turno.
- No usar "conectar terminal" como sustituto de segunda apertura: el segundo cajero debe ver `Abrir mi caja` con arqueo propio.
- `close_cash_register(...)` cierra solo la apertura `abierta` del cajero autenticado.
- `close_cash_shift_with_tables(...)` es cierre de turno. Si el flujo UI debe resolver ordenes especiales `$0`, debe hacerlo con confirmacion explicita antes de llamar al cierre.
- Antes de bloquear cierre por borradores, usar la logica central que cancela borradores no enviados sin cobros ni items operativos.
- Un `DRAFT` vacio o con solo items `DRAFT` no debe impedir cerrar turno.
- Para ordenes especiales `$0`, no inflar conteos con borradores vacios ni pagadas historicas: contar solo `SENT_TO_KITCHEN`, `READY` y `KITCHEN_DISPATCHED` sin `paid_at`.
- Respetar:
  - `cash_shifts` como turno
  - `cash_shifts.opened_at` como fecha/hora visible de apertura del turno abierto en `Admin > Turno`
  - `cash_register_openings` como historico de aperturas
  - principal vs secundarias (ya no usan `register_role`, se identifican por `primary_cashier_id` vs rest)
  - multiples cajeros (limitado a `max_caja_sessions`)
  - `cash_shift_denoms` como caja fisica real (por cajero; columnas `cashier_id`, `opening_id`)
- Migraciones de caja (entornos que cobran): aplicar las migraciones de caja multi-cajero y las de configuración de caja por turno, incluyendo las más recientes de caja unificada (principal opcional y plantilla por cajero).
- Si se añaden características globales o se toca el estado de los turnos, asegurarse de que no interfieran con la vista del Administrador en `/admin/monitoreo-global` (Monitoreo Global de Turnos). Esta interfaz depende de `supabase_realtime` en las tablas principales de la operación (profiles, cash_shifts, orders, cash_shift_users).
- Al cambiar `open_cash_register`, si el retorno pasa de `void` a `uuid`, incluir `DROP FUNCTION IF EXISTS public.open_cash_register(uuid, uuid, uuid, jsonb)` antes del `CREATE`.
- **No** hacer `DROP FUNCTION get_my_branch_shift_gate(uuid)` en migraciones: politicas RLS de `order_cancellations` / `order_item_cancellations` dependen de ella; usar `CREATE OR REPLACE` con la misma firma `RETURNS TABLE`.
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
  - **Auditoría de Anulación (2026-05-09):** Queda terminantemente prohibido anular pagos sin registrar el evento en `order_cancellations` y adjuntar una nota técnica en `orders.notes`. La nota debe incluir el supervisor responsable y el motivo.
  - separacion historica cuando un pago anulado deja una cuenta activa: orden original `CANCELLED` con `VOID_SUCCESSOR_ORDER`, y orden sucesora activa con nuevo numero y `SUCCESSOR_OF_VOIDED_ORDER`.
  - la orden historica por pago anulado nunca debe quedar `PAID`, aparecer en `Por cobrar`, ocupar mesa ni reactivarse por `recalculate_check_balance(...)`.
- No anular pagos de ordenes `KITCHEN_DISPATCHED` desde el flujo operativo normal.
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
- El boton `Editar orden` solo debe estar activo cuando la orden esta en `SENT_TO_KITCHEN`/En Caja.
- En `DRAFT` de Mesa, Para llevar y Orden especial, el menu de productos debe seguir activo mientras la orden sea una superficie editable y no tenga bloqueo/anulacion pendiente. Eliminar el ultimo item visible no debe desactivar el catalogo si la orden sigue siendo borrador editable.
- En `PAID`, `KITCHEN_DISPATCHED` y `CANCELLED`, no activar edicion. Si la pantalla muestra el menu de productos, debe estar visible pero desactivado.
- Debe seguir aplicando `orders.locked_for_editing` en DB.
- **Contexto de Navegación:** El flujo de edición y la navegación desde Mesas deben preservar el contexto original. Usar el parámetro `origin=mesas` para que el Sidebar y el BottomNav mantengan su estado resaltado.
- **Contexto de Navegación (Para llevar / Orden especial):** cuando el usuario entra por estas opciones del menú lateral, preservar el resaltado usando:
  - `origin=para-llevar`
  - `origin=orden-especial`
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
- Si una pantalla clasifica estados operativos (despacho, listos, cancelaciones en flujo mesa con despacho previo al cobro en otros modos), usar `get_order_operational_snapshot(...)` cuando corresponda.
- **Excepción documentada:** `payOrder` puede validar cantidad cobrable en modo `CASH_THEN_DISPATCH` sin ese RPC, usando `order_items` y cancelaciones aplicadas; no copiar ese atajo a Despacho/Cocina sin revisión.
- No reconstruir cantidades criticas con formulas ad hoc en modulos que ya dependen del snapshot comun.
- Toda pantalla que visualiza ordenes debe mostrar el usuario creador desde `orders.created_by`.
- Resolver nombres de usuario con el helper central (`first_name`, `full_name`, `username`, `email`, `Usuario`) y no duplicar fallbacks distintos por pantalla.
- El modulo `Ordenes` debe mantener las pestanas visibles en este orden exacto: `Borrador`, `En Caja`, `Pagada`, `Despachada`, `Anulada`.
- `Pendiente de anulacion` no debe reintroducirse como pestana principal; es un estado/marca operativa que bloquea acciones y se muestra en el detalle.
- `Borrador` debe listar ordenes con al menos un item activo agregado y no enviado a Caja; si una orden aun no tiene `order_code` / `order_number`, debe permanecer en `Borrador` mientras sus items no esten pagados ni anulados.
- `En Caja` debe listar solo ordenes numeradas/codificadas, enviadas a Caja, con items no `DRAFT` y saldo/cantidad pendiente de cobro; no debe incluir ordenes pagadas completas.
- `Pagada` debe listar solo ordenes `PAID`.
- `Despachada` debe listar ordenes cuya cabecera este en `KITCHEN_DISPATCHED` y tambien ordenes `PAID` que ya tengan despacho aplicado (`order_dispatch_events.status = 'APPLIED'`) mientras la cabecera aun no se haya sincronizado.
- Para evitar dobles clasificaciones, si la cabecera de la orden es `KITCHEN_DISPATCHED`, la orden pertenece a `Despachada`, no a `Pagada`.
- Una linea `DRAFT` no debe aparecer en pestanas operativas posteriores.
- En `Pagadas`, las ordenes especiales `PAID` deben seguir visibles aunque no tengan cantidades cobradas por item; usar `special_total_manual` como valor visible de la orden y los items reales como detalle.
- El cálculo de cambio (`changeAmount`) debe realizarse de manera unificada, agregando los excedentes de todos los métodos de pago en una sola cifra coherente.
- No asumir que `orders.total` de una orden especial coincide con `special_total_manual` o con `sum(order_items.total)`.
- **Agrupamiento UI Obligatorio:** Toda lista de ítems de orden (Caja y Resumen) debe implementar agrupamiento por descripción y precio unitario para evitar redundancia visual y facilitar la lectura operativa.
- **Flexibilidad en Edición:** El acceso a la edición de órdenes puede estar permitido para usuarios operativos (`canOperateOrders`) siempre que el turno esté abierto, pero el boton solo debe activarse cuando la orden este en `SENT_TO_KITCHEN`/En Caja.
- **Crear múltiples órdenes en Para llevar / Orden especial:** el botón `+` (Nueva orden) debe existir siempre y permitir crear una nueva orden aunque existan ordenes activas `DRAFT`, `SENT_TO_KITCHEN` o `PAID`; las tarjetas se agregan dinamicamente y se retiran al despacho/cancelacion segun corresponda.

### 11. Comprobantes de transferencia
- No romper separacion entre captura, almacenamiento, OCR/analisis y aprobacion/rechazo posterior.
- Si no hay OCR disponible, el flujo debe degradar a revision manual.
- La limpieza de metadata SQL y la limpieza del bucket `payment-proofs` son procesos separados.

### 12.1 Extra
- `order_type = EXTRA`: menu mesa sin PLATOS, sin mesa, flujo caja → despacho manual (como mesa; no Express).
- Tras cobro total queda `PAID`; **no** auto-despachar ni cerrar en `sync_order_payment_state_internal` (`20260602120000`). Cierre con `close_extra_order` desde `/extra` (`20260602130000`).
- Modulo `/extra`: solo el creador ve sus ordenes activas; sin pagos parciales; cajero secundario sin imprimir comprobante.
- Usuarios con la capacidad **Empacador (`can_pack_orders`)** tienen acceso exclusivo al módulo `/extra` y a la pantalla de comandas de ese módulo, restringiendo todo acceso a Mesas, Express, Especial y Para Llevar.
- En Caja: subtitulo **Extra**; visible para creador o cajero principal del turno; no mostrar nombre de mesa.
- En Despacho: listar en pestañas **Mesa** y **Todos**; no exigir `sent_to_kitchen_at` en lineas Extra para armar tarjeta.

### 12.2 Despacho
- Pestañas: `Todos`, `Mesa` (incluye `EXTRA`), `Para llevar / Express` (unifica `TAKEOUT`+`EXPRESS`), `Orden especial`.
- No reintroducir pestaña Express separada; normalizar `localStorage` `EXPRESS` → `TAKEOUT`.
- Modo SPLIT: asignacion `TAKEOUT` o `EXPRESS` habilita la pestaña unificada; `EXTRA` se evalua como `TABLE`.
- Conservar una tarjeta por `order_code`; usar `get_batch_order_operational_snapshots` si existe (`20260602140000`).
- **Despachar todo:** `dispatch_order_quantities` con operacion total e items vacios.

### 13. Integridad Financiera y Caja
- **Integridad Financiera (2026-05-09):**
  - **Redondeo:** Todos los cálculos financieros deben redondearse a 2 decimales en el origen (BD/RPC) y en la UI para evitar errores de precisión.
  - **Caja Abierta:** Los diálogos de pago no deben permitir cobros si el cajero no tiene apertura activa (`shiftGate.cajaStatus === OPEN`). El catálogo de denominaciones en cobro viene de `denominations`, no de la plantilla sola.
  - **Exclusión de Cancelados:** Los ítems con anulación confirmada o pendiente no deben sumarse a ninguna cifra operativa de cobro.
  - La anulacion operativa de pagos solo aplica sobre ordenes `PAID` no despachadas.
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
2. Si se toco caja, validar apertura por cajero, cobro con denoms del usuario, cierre individual y que un segundo cajero habilitado pueda abrir su propia caja sin bloqueo global.
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
   - **Flujo Global:** Caja antes de Despacho (Mesa, Para Llevar, Especial, Extra). Express invierte el flujo (despacho antes de cobro). Extra: despacho manual tras `PAID`; cierre con `close_extra_order`.
   - **Despacho:** pestaña unificada Para llevar/Express; Extra en Mesa/Todos; migracion batch `20260602140000` recomendada.
   - **Productos frecuentes:** reset total borra `extra_frequent_products`; reset operativo los conserva.
  - **Caja unificada:** no documentar ni depender de flags `secondary_caja_*` para alcance de cobro.
9. Si se toco flujo de ordenes, validar que mesa, para llevar y orden especial pasen primero por Caja y luego a Despacho.
10. Si se toca el diálogo de pago (V1, V2 o Secondary), validar apertura de caja, redondeo, recibo/vuelto; confirmar migraciones `20260509180000` y `20260528130000` en BD.
11. Si se toca Caja/Recaudar, validar el filtro de alcance (todas / mías / por usuario) y que el cobro siga unificado.
12. Si se toca Extra, validar `order_type = EXTRA`, menú sin PLATOS, RPC `create_extra_order`, flujo caja → `PAID` → despacho manual, `20260602120000`/`20260602130000`, visibilidad creador/cajero principal y aparicion en Despacho (Mesa/Todos).
13. Si se toca productos frecuentes, validar migraciones `20260531130000` y `20260531140000`, contexto correcto y layout 1–2 filas en `FrequentProductCards`.
14. En `Ordenes.tsx`, no asumir `order.items` definido tras mutaciones; usar arreglo vacío por defecto donde se haga `.map`/`.reduce`.
15. Si se toca Despacho, validar pestaña unificada Para llevar/Express, Extra en Mesa/Todos, una tarjeta por `order_code`, **Despachar todo**, batch snapshots (`20260602140000`) y tablet 1280px.

### Actualizacion May 23, 2026
- **Ordenes Especiales:** Se corrigio el trigger de pago para marcar como PAID a las ordenes especiales cuando alcanzan el monto manual configurado. Tambien se actualizo useReportesOnlineData.ts para que aparezcan bajo el tipo SPECIAL en los reportes y filtros, y dejen de estar ocultas como Mesa o Extra.
- **UI/UX Monitoreo y Tarjetas:** Ajustes en MonitoreoGlobal.tsx para hacer el embudo mutuamente excluyente en la columna Generadas. Se implemento grid de 2 columnas para tarjetas en vista de tablet y se corrigio el truncado de fecha/hora de los items.
- **Logo y PWA:** Se elimino el filtro CSS que ocultaba el color del logo en SidebarNav.tsx. Se aplico enmascarado circular (rounded-full object-cover) en Login, Sidebar y AppLayout. Se actualizaron los assets de PWA icon-192.png y icon-512.png con la nueva imagen cargada.
