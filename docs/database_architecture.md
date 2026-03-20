# Database Architecture

## Resumen
- Base de datos: PostgreSQL en Supabase.
- UUID se mantiene como PK tecnica.
- Los codigos legibles operativos se conservan donde aplica, por ejemplo `order_code`.

## Catalogo Operativo Actual

### Modelo nuevo de navegacion
- Tabla: `menu_nodes`
- Proposito: representar el arbol completo del menu con profundidad indefinida.
- Campos clave esperados:
  - `id`
  - `branch_id`
  - `parent_id`
  - `name`
  - `node_type`
  - `depth`
  - `display_order`
  - `is_active`
  - `icon` (remanente legacy, ya no expuesto en el CRUD principal)
  - `image_url` (URL publica final generada desde Storage para la imagen del nodo)
  - `description`
  - `price`

### Modelo legacy que sigue vivo
- `categories`
- `subcategories`
- `products`

Este modelo legacy no ha sido eliminado porque el flujo operativo de ordenes sigue dependiendo de `products`, aunque en administracion ya no se expone una pestana visible de `Productos` y el mantenimiento principal se canaliza por `Arbol Menu`.

## Regla Funcional del Arbol
- `parent_id IS NULL` identifica nodos raiz (Nivel 1).
- Los productos solo pueden existir desde Nivel 2 en adelante.
- La distincion de L1 fijo y navegacion uniforme desde L2 es una regla de UX sobre este arbol; no introduce cambios de esquema adicionales.
- Un nodo `product` no puede tener hijos.
- La baja sigue siendo logica por `is_active=false`.

## Persistencia de Ordenes
- `order_items.product_id` sigue con FK hacia `products(id)`.
- Por eso, un nodo `menu_nodes` de tipo `product` debe tener espejo operativo en `products` si se quiere vender.
- Mientras esa FK exista, `menu_nodes` por si solo no cierra el circuito transaccional de una orden.
- `menu_nodes.is_active` pasa a tener impacto operativo real en UI:
  - si un producto/nodo esta agotado, debe bloquear venta en `Ordenes`
  - la activacion/desactivacion puede originarse desde el modulo `Productos`

## Sincronizacion Transitoria entre Modelos
- `MenuNodesCrud` sincroniza estructura minima hacia tablas legacy.
- Objetivo:
  - preservar compatibilidad con el flujo operativo actual
  - permitir vender productos creados desde el arbol
- Restricciones:
  - cuidar unicidad de orden visual legacy
  - no romper FK historicas
  - no asumir columnas inexistentes en el esquema real

## Modificadores
- `modifiers`: catalogo base de modificadores por sucursal.
- `menu_node_modifiers`: disponibilidad de modificadores por nodo del arbol (`menu_nodes`).
- `order_item_modifiers`: seleccion real de modificadores por item.
- `order_items.item_note`: nota opcional por item.
- `subcategory_modifiers`: tabla legacy de asignacion previa por subcategoria; ya no debe ser la fuente principal para nuevos cambios.

## Divisiones de mesa
- `restaurant_tables` sigue siendo la entidad fisica interna que soporta `orders.table_id` y `table_splits.table_id`.
- `branches.reference_table_count` guarda la cantidad referencial de mesas por sucursal.
- `cash_shifts.active_tables_count` guarda la cantidad operativa de mesas del turno abierto.
- La UI de `Mesas` no debe depender de contar filas activas historicas; debe recortar la capacidad visible segun el turno abierto.
- `table_splits` sigue siendo la entidad de soporte para submesas.
- `orders.split_id` enlaza la orden con su division.
- Regla operativa vigente:
  - una division nueva solo debe crearse cuando las divisiones existentes ya tienen al menos un item
  - una division no debe eliminarse si ya tiene rastro operativo de cocina/listo/despacho/pago/cancelacion
- Cambio de mesa `DINE_IN`:
  - no crea tablas nuevas ni rompe la FK actual
  - si el destino esta libre, la orden se mueve con update directo de `orders.table_id`
  - si la orden ya tenia division y el destino esta libre, `orders.split_id` debe quedar `NULL` y la division origen se desactiva
  - si el destino esta ocupado, se crea un nuevo `table_splits` en la mesa destino y `orders.split_id` pasa a apuntar a esa division nueva
  - si el destino estaba ocupado por una orden base sin `split_id`, primero debe materializarse como division propia antes de anexar el grupo movido
  - los borradores vacios en destino pueden limpiarse para no contar como ocupacion real ni dejar ordenes fantasma en una mesa libre
  - si despues del movimiento o de eliminar una division solo queda una orden activa en la mesa origen, esa orden remanente debe colapsar a mesa base con `split_id = NULL`
- Para que esa validacion sea consistente, la lectura de orden debe incluir:
  - `sent_to_kitchen_at`
  - `ready_at`
  - `dispatched_at`
  - `paid_at`
  - `cancelled_at`

## Denominaciones
- `denominations` ahora soporta `image_url` para representar visualmente monedas y billetes.
- `denominations.denomination_type` define explicitamente si una denominacion es `coin` o `bill`.
- La imagen se carga a Storage en el bucket publico `denomination-images` y se reutiliza en Admin/Caja.
- El flujo de Caja debe leer `image_url` junto con `label`, `denomination_type`, `value` y `display_order`.
- El orden de presentacion visible en Caja y Desglose debe salir de `display_order` ascendente, no del valor monetario ni de la etiqueta.
- El flujo operativo en UI agrupa denominaciones por `denomination_type` (`coin`, `bill`) y conserva la posibilidad de editar `quantity` manualmente por denominacion antes de persistir.

## Caja y pagos
- `cash_shifts` + detalle de denominaciones siguen siendo la fuente de `Apertura`, `Actual` y `Diferencia`.
- `cash_shifts` sigue representando el turno operativo; el historial real de aperturas/cierres/anulaciones de caja vive aparte.
- Tabla nueva de historial: `cash_register_openings`
  - `shift_id`
  - `branch_id`
  - `cashier_id`
  - `status` (`abierta` | `cerrada` | `anulada`)
  - `opened_at`
  - `closed_at`
  - `initial_total`
  - `notes`
  - `anulada_por`
  - `anulada_at`
  - `motivo_anulacion`
- `cash_shifts.caja_status` queda como estado agregado de la caja actual del turno (`UNOPENED` | `OPEN` | `CLOSED`), no como historial completo.
- La apertura de turno tambien fija `active_tables_count` como frontera operativa de mesas para ese turno.
- La habilitacion de usuarios por turno ya no es implícita: vive en `cash_shift_users`.
- `cash_shift_users` ya no es solo un flag binario:
  - `is_enabled`
  - `can_serve_tables`
  - `can_dispatch_orders`
  - `can_use_caja`
  - `can_authorize_order_cancel`
  - `is_supervisor`
- Aun con ese modelo, administrador general y supervisor de sucursal deben poder abrir/cerrar caja por override administrativo usando `can_manage_branch_admin(...)`.
- `close_cash_register(shift_id, cashier_id, branch_id, notes)` debe bloquearse si en la sucursal aun existen ordenes con estado distinto de `PAID` o `CANCELLED`.
- `payment_entries` / tablas equivalentes de cobro son la fuente de `Recaudado` por metodo.
- Regla funcional importante:
  - `Actual - Apertura` representa caja fisica
  - `Cobrado por metodo` puede incluir metodos no efectivos y no debe asumirse equivalente a caja fisica
- En el flujo de cobro:
  - `cashReceivedDenoms` y `cashChangeDenoms` solo deben persistirse si realmente participa un metodo efectivo
  - desactivar `Efectivo` debe limpiar denominaciones temporales para no contaminar el cierre o el total actual
- Si `Recibido >= Aplicado` y el usuario agrega mas denominaciones, la UI debe pedir confirmacion antes de aceptar excedente.
- La visibilidad de pagos entre usuarios depende de leer correctamente las tablas de eventos y pagos bajo RLS de sucursal.

## Funciones operativas nuevas para mesas por turno
- `ensure_branch_table_capacity(branch_id, requested_count)`
  - garantiza que exista capacidad interna suficiente en `restaurant_tables`
  - no elimina mesas historicas; solo crea faltantes
- `configure_shift_active_tables(branch_id, shift_id, active_tables_count)`
  - sincroniza cuantas mesas quedan activas para el turno
  - no debe permitir bajar el conteo por debajo de mesas con ordenes abiertas
- `open_cash_shift_with_tables(cashier_id, branch_id, active_tables_count, denoms)`
  - abre el turno de forma transaccional
  - crea `cash_shifts`, detalle de denominaciones, movimientos de apertura y mesas activas en una sola operacion
- `close_cash_shift_with_tables(shift_id, branch_id, notes)`
  - cierra el turno y desactiva internamente las mesas del turno
  - no debe permitir cierre si aun existen ordenes con estado distinto de `PAID` o `CANCELLED`
  - debe seguir bloqueando tambien si la caja continua abierta
- `list_cash_register_openings(shift_id)`
  - devuelve el historial de aperturas de caja del turno
  - incluye motivo y anulador cuando una apertura fue anulada
  - expone `payment_count` de la apertura actual para bloquear anulacion si ya hubo ventas/cobros
- `anular_apertura_caja(turno_id, motivo)`
  - solo supervisor/admin
  - exige motivo minimo
  - no permite anular si existen cobros (`cash_movements` `PAYMENT_IN`) en el turno
  - marca la apertura como `anulada` y devuelve la caja a estado `UNOPENED`
- Tabla nueva: `cash_register_movements`
  - `shift_id`
  - `branch_id`
  - `movement_type` (`entrada` | `salida` | `cambio_denominacion`)
  - `amount`
  - `reason`
  - `recorded_by`
  - `created_at`
- Regla funcional:
  - los movimientos de caja no alteran `cash_movements`
  - `Cambio de denominacion` si altera `cash_shift_denoms.qty_current`
  - el total debe permanecer igual, pero la composicion de denominaciones si cambia
  - por eso `Actual` y `Desglose` deben reflejar el nuevo reparto de billetes/monedas
  - existen para auditoria, historial y reporte operativo del turno
- `list_cash_register_movements(turno_id)`
  - devuelve el historial visible de movimientos del turno actual
  - incluye nombre y usuario de quien lo registro
- `registrar_movimiento_caja(turno_id, tipo, monto, motivo)`
  - exige turno `OPEN` y `caja_status = OPEN`
  - exige monto mayor a `0`
  - exige motivo obligatorio
  - permite registrar al usuario de caja habilitado o al override admin/supervisor
  - para `cambio_denominacion` exige detalle origen/destino que cuadre exactamente
  - las denominaciones que salen de caja deben existir con stock suficiente en `cash_shift_denoms.qty_current`
  - suma denominaciones de entrada y resta denominaciones de salida sobre `cash_shift_denoms.qty_current`
- Los cobros en efectivo ya no deben depender de un `PAYMENT_IN` generico sin denominacion:
  - cada billete/moneda recibida y cada denominacion de cambio deben registrarse con `denomination_id`
  - ese registro debe mover `cash_shift_denoms.qty_current`
  - `Desglose de Caja` debe reconstruirse desde esos valores persistidos
- `list_shift_users_for_branch(branch_id)`
  - devuelve los usuarios activos de la sucursal con su estado habilitado en el turno actual
- `set_shift_user_enabled(shift_id, user_id, is_enabled)`
  - la firma vieja binaria puede seguir existiendo en algunas bases remotas
  - la firma objetivo debe contemplar tambien capacidades operativas del usuario del turno
- get_my_branch_shift_gate(branch_id) 
  - indica si hay turno abierto y si el usuario autenticado esta habilitado para operar
  - expone tambien `active_tables_count` para que usuarios operativos puedan ver Mesas aunque no tengan permisos de Caja
  - debe poder reflejar tambien las capacidades del usuario del turno para modular menu y rutas

## Snapshot operativo
- La UI operativa ya no debe reconstruir estados solo desde eventos dispersos.
- Existe una dependencia funcional en `get_order_operational_snapshot` para:
  - clasificar `Enviadas`, `Listas`, `Despachadas`
  - determinar que entra a `Por cobrar`
  - mantener consistencia entre `Ordenes`, `Despacho`, `Cocina` y `Caja`
- Mientras existan bases remotas con despliegue parcial, el consumidor frontend debe tolerar dos variantes del RPC:
  - nueva: `quantity_dispatched_total`, `quantity_dispatched_available`, `quantity_cancelled_dispatched`
  - legacy: `quantity_dispatched`
- Si esa compatibilidad no existe, una orden ya despachada puede quedar fuera de todas las vistas operativas aunque siga viva en `orders`.
- El snapshot vigente debe contemplar tambien cancelaciones sobre cantidades despachadas:
  - `quantity_dispatched_total`
  - `quantity_dispatched_available`
  - `quantity_cancelled_dispatched`
- `order_item_cancellations.source_stage` debe permitir:
  - `PENDING`
  - `READY`
  - `DISPATCHED`
- `cancel_order_quantities(...)` ya no debe limitarse a `Pendiente + Listo`; debe poder cancelar tambien `Despachado` mientras no exista pago sobre esa cantidad.
- Si el dialogo de anulacion se abre desde una tarjeta filtrada, el frontend debe enviar solo el subconjunto visible/anulable de esa tarjeta; no debe intentar cancelar items que no forman parte de la vista desde donde se disparo la accion.

## Politica de cancelacion/anulacion directa por categoria
- Tabla operativa: `branch_cancel_policy`
- Unidad visible actual: categoria `nivel 0` de `menu_nodes`
- Campos operativos esperados:
  - `branch_id`
  - `menu_node_id`
  - `allow_direct_cancel`
- La UI actual ya no usa una clasificacion editable de `plato de cocina`; la politica visible fue simplificada a checks por categoria raiz.
- Regla especial vigente:
  - la primera categoria raiz de la sucursal solo puede ser modificada por administrador general
- La RPC/listado debe devolver todas las categorias nivel 0 activas, incluso si alguna aun no tiene productos, para no ocultar raices validas.

## Solicitudes pendientes de anulacion
- `orders.cancel_requested_at` identifica una orden con solicitud pendiente de anulacion.
- `orders.cancel_requested_by` guarda quien la solicito cuando la columna esta disponible en la base remota.
- Esa marca no convierte la orden en `CANCELLED`; solo la mueve a la cola visible `Pendiente de anulacion` en frontend.
- Para reconstruir los items solicitados sin aplicar aun la anulacion real, el frontend puede persistir un borrador tecnico en:
  - `order_cancellations` con marca de solicitud pendiente en `notes`
  - `order_item_cancellations` asociados a ese borrador
- Ese borrador no debe contarse como anulacion efectiva en snapshot operativo ni en historial aplicado.
- Mientras la solicitud siga activa:
  - no debe perderse la referencia a su etapa operativa original
  - pero tampoco debe seguir mezclada en `Enviadas`, `Listas` o `Despachadas`

## Consultas Correctas para Modificadores
- No leer descripcion desde `order_item_modifiers` como fuente principal.
- Leer descripcion desde `modifiers(description)` mediante join relacional.
- Para disponibilidad operativa en catalogo/arbol, resolver desde `menu_node_modifiers` y no desde `subcategory_modifiers`.

## Migraciones Relevantes
- `supabase/migrations/20260310213000_subcategory_modifiers_and_item_notes.sql`
  - normalizacion inicial de modificadores por subcategoria
  - columna `order_items.item_note`
- `supabase/migrations/20260310223000_fix_order_code_generator_collision.sql`
  - correccion de colisiones en `order_code`
- `supabase/migrations/20260312110000_add_menu_nodes_tree.sql`
  - tabla `menu_nodes`
  - trigger/calculo de profundidad
  - base inicial para navegacion del arbol
- `supabase/migrations/20260313121000_add_menu_node_images_storage.sql`
  - bucket publico `menu-node-images`
  - policies de Storage para administracion por sucursal
- `supabase/migrations/20260313143000_move_modifier_assignments_to_menu_nodes.sql`
  - tabla `menu_node_modifiers`
  - backfill inicial desde `subcategory_modifiers`
  - RLS por sucursal tomando `menu_nodes.branch_id` como referencia
- `supabase/migrations/20260313170000_add_denomination_images.sql` 
  - columna `denominations.image_url` 
  - bucket publico `denomination-images` 
  - policies de Storage para administracion por sucursal
- `supabase/migrations/20260313193000_add_denomination_type.sql`
  - columna `denominations.denomination_type`
  - backfill inicial de datos existentes
  - restriccion `coin|bill`
- `supabase/migrations/20260313201000_fix_orders_rls_for_branch_operate_permissions.sql`
  - alinea RLS de `orders` y entidades relacionadas con permisos `OPERATE` por sucursal/modulo
- `supabase/migrations/20260313205500_fix_operational_event_visibility_by_branch_permissions.sql`
  - alinea RLS de eventos operativos para que `Enviadas`, `Listas` y `Despachadas` sean visibles segun permisos efectivos
- `supabase/migrations/20260314120000_fix_restaurant_table_number_collision.sql`
  - endurece la asignacion de `restaurant_tables.table_number`
  - mantiene sincronizado `entity_counters`
  - evita reutilizar numeros de mesa existentes por sucursal cuando hay drift entre contador y datos reales
- `supabase/migrations/20260315090000_branch_reference_tables_and_shift_active_count.sql`
  - agrega `branches.reference_table_count`
  - agrega `cash_shifts.active_tables_count`
  - introduce RPCs para capacidad interna, mesas activas por turno y apertura/cierre transaccional de turno
- `supabase/migrations/20260315170000_shift_admin_gate_and_enabled_users.sql`
  - agrega `cash_shift_users`
  - mueve la apertura operativa del turno al modelo administrado por Admin
  - introduce el gate operativo por usuario habilitado dentro del turno
- `supabase/migrations/20260316203000_shift_roles_caja_cancellations.sql`
  - agrega capacidades operativas por usuario dentro del turno
  - obliga a que un usuario habilitado tenga al menos una capacidad operativa
- `supabase/migrations/20260316203001_caja_and_user_rpcs.sql`
  - extiende RPCs de usuarios/turno/caja para el nuevo modelo de capacidades
- `supabase/migrations/20260316203002_user_and_gate_rpcs.sql`
  - ajusta lecturas/gates alineados con capacidades del turno
- `supabase/migrations/20260317033000_branch_cancel_policy.sql`
  - crea `branch_cancel_policy`
  - introduce RPCs de listado/guardado/consulta para politica de cancelacion/anulacion por categoria
- `supabase/migrations/20260317091500_fix_profile_user_code_counter.sql`
  - corrige el contador de `profiles.user_code`
  - evita colisiones silenciosas al crear usuarios nuevos
- `supabase/migrations/20260317124500_cash_register_opening_annulment.sql`
  - crea `cash_register_openings`
  - adapta `open_cash_register` y `close_cash_register` al historial real de aperturas
  - agrega `list_cash_register_openings`
  - agrega `anular_apertura_caja`
- `supabase/migrations/20260317133000_cash_register_movements.sql`
  - crea `cash_register_movements`
  - agrega indices por turno y sucursal
  - agrega RLS de lectura/insert por sucursal activa y permisos de caja
  - agrega `list_cash_register_movements`
  - agrega `registrar_movimiento_caja`
- `supabase/migrations/20260317140000_cash_register_movement_detail.sql`
  - agrega `movement_detail` en formato jsonb
  - permite guardar el desglose completo del cambio de denominaciones
- `supabase/migrations/20260317143000_apply_cash_register_movement_to_denoms.sql`
  - hace que `registrar_movimiento_caja` actualice `cash_shift_denoms.qty_current`
  - asegura que el cambio de denominacion cuadre y se vea reflejado en `Desglose`
- `supabase/migrations/20260317144500_fix_cash_register_movements_rls_ambiguity.sql`
  - corrige la RLS de `cash_register_movements`
  - evita ambiguedad de columnas en insercion/lectura bajo policies
- `supabase/migrations/20260317145500_fix_registrar_movimiento_caja_ambiguity.sql`
  - recrea `registrar_movimiento_caja` con aliases calificados
  - evita ambiguedad de `shift_id`/`branch_id` dentro de la funcion
- `supabase/migrations/20260317150500_block_cash_close_with_pending_orders.sql`
  - bloquea `close_cash_register` si existen ordenes no `PAID` y no `CANCELLED`
- `supabase/migrations/20260317152000_fix_branch_cancel_policy_defaults.sql`
  - deja por defecto desactivada la primera categoria raiz
  - deja activadas por defecto las categorias raiz restantes
- `supabase/migrations/20260317161500_support_dispatched_cancellations.sql`
  - habilita `source_stage = 'DISPATCHED'` en `order_item_cancellations`
  - recrea `get_order_operational_snapshot` con cantidades despachadas disponibles
  - ajusta `recompute_order_operational_state`
  - extiende `cancel_order_quantities` para cancelar tambien cantidades despachadas no pagadas
- `supabase/migrations/20260318110000_register_cash_movement_operational_rpc.sql`
  - agrega RPC operacional segura para registrar movimientos de caja sin depender de insert directo bloqueado por RLS
- `supabase/migrations/20260318123000_apply_cash_payment_denoms_via_cash_movements.sql`
  - hace que cobros en efectivo y cambios entregados muevan `cash_shift_denoms.qty_current` via `cash_movements`
  - deja trazabilidad por `denomination_id`
- `supabase/migrations/20260319103000_move_dine_in_orders_between_tables.sql`
  - agrega la RPC `move_dine_in_order_to_table`
  - agrega el helper `normalize_single_remaining_split_for_table`
  - aplica la regla `destino libre -> mover directo`
  - aplica la regla `destino ocupado -> crear division nueva y mover`
  - materializa divisiones faltantes en la mesa destino cuando ya habia una orden base sin `split_id`
  - colapsa la mesa origen a base si despues del cambio solo queda una orden activa

## Reglas de Integridad
1. No hacer deletes fisicos en entidades con historial operativo.
2. Si se altera catalogo legacy, validar impacto en FK de `orders` y `order_items`.
3. Toda tabla nueva o cambio de acceso requiere revisar RLS/policies por sucursal.
4. Los archivos de `menu-node-images` deben quedar protegidos por policies de Storage alineadas con permisos administrativos por sucursal.
5. Si aparece error en insercion de items, revisar primero la correspondencia entre `menu_nodes.product` y `products`.
6. Si aparece colision de `table_number` al crear mesas, revisar trigger remoto y `entity_counters` antes de agregar mas logica en frontend.

## Addendum 2026-03-15
- `Admin > Turno` trabaja como formulario unico de configuracion operativa.
- Los cambios de mesas, usuarios y despacho pueden vivir en borrador local, pero la persistencia final sigue cerrando sobre:
  - `cash_shifts`
  - `cash_shift_users`
  - `dispatch_config`
  - `dispatch_assignments`
- `get_my_branch_shift_gate(branch_id)` debe seguir devolviendo tambien `active_tables_count` para que usuarios operativos sin permisos de Caja puedan ver `Mesas` correctamente.
- Si la base remota todavia conserva la firma vieja de `set_shift_user_enabled`, el frontend puede necesitar compatibilidad temporal; el objetivo final sigue siendo alinear la RPC extendida en BD remota.




