# Codex Rules

## Objetivo
Preservar continuidad tecnica y funcional del POS entre sesiones sin perder decisiones ya tomadas.

## Reglas Obligatorias Vigentes

### 1) Refactor incremental, no rediseno total
- Reutilizar el flujo existente antes de abrir modelos paralelos innecesarios.
- Si un cambio nuevo convive con legacy, documentar claramente que parte ya migro y cual sigue operando en el modelo anterior.

### 2) Seguridad en backend/BD primero
- La UI no define seguridad.
- Validar siempre por permisos efectivos y sucursal activa en backend/BD.

### 3) Arbol de menu como fuente principal de estructura
- La construccion jerarquica del menu se administra desde `Admin > Arbol Menu`.
- No volver a depender de pantallas separadas de `Categorias`, `Subcategorias` o `Productos` para la estructura principal.
- Nivel 1 es el unico nivel obligatorio y la unica capa fija para navegar en Ordenes; desde Nivel 2 en adelante no deben existir tratamientos especiales por nivel.
- Los productos pueden existir desde Nivel 2 en adelante.

### 4) Compatibilidad legacy obligatoria mientras siga la FK actual
- Mientras `order_items.product_id` apunte a `products(id)`, no asumir que `menu_nodes` basta por si solo.
- Cualquier cambio en `MenuNodesCrud`, `useMenuTree` o `MenuNavigator` debe considerar el espejo operativo en legacy.

### 4.1) Productos agotados deben reflejarse en venta
- Si un nodo o producto se desactiva desde `Productos`, `Ordenes` debe reflejarlo como agotado.
- No basta con cambiar color o etiqueta; debe bloquearse su seleccion operativa.

### 5) Modificadores: modelo estructurado obligatorio
- Modificador no es texto libre concatenado.
- Catalogo base por `modifiers`.
- Disponibilidad por `menu_node_modifiers`.
- Seleccion por `order_item_modifiers`.
- Render consistente debajo del producto en todas las vistas operativas.

### 6) No borrar historico operativo
- En catalogo y otras entidades con trazabilidad, preferir `is_active=false`.
- Evitar deletes fisicos salvo que exista certeza de no afectar historial.

### 7) `order_code` y contadores
- Si reaparece un problema de duplicados, revisar primero la migracion/correccion vigente antes de tocar la app.
- Lo mismo aplica para `restaurant_tables.table_number`: primero revisar trigger/contador/BD antes de meter mas heuristicas en frontend.

### 7.1) Mesas: referencia de sucursal + capacidad por turno
- No volver a tratar las mesas como CRUD operativo fila por fila en Admin.
- `branches.reference_table_count` es solo referencia de sucursal.
- `cash_shifts.active_tables_count` define cuantas mesas se muestran operativamente en el turno.
- `restaurant_tables` se conserva como pool interno para FKs, ordenes y divisiones.
- Si se cambia la cantidad de mesas visibles, preferir RPC/flujo transaccional de turno antes que updates sueltos desde frontend.
- La apertura del turno debe vivir en `Admin > Turno`, no en `Caja`.
- Los usuarios habilitados para operar durante el turno deben resolverse desde `cash_shift_users`.
- `Admin > Turno` debe funcionar como formulario unico:
  - cambios de mesas, usuarios y despacho quedan en borrador local
  - solo `Abrir turno` o `Guardar` deben persistir cambios
- Si no hay turno abierto, los modulos operativos deben quedar bloqueados y solo `Admin` debe seguir accesible para administradores/supervisores.
- En `Admin > Turno`, la UX vigente de usuarios es `combo + agregar + tarjetas`; no volver al modelo de "todos visibles y luego desmarcar".
- En `Admin > Turno`, `Despacho` ya no debe exponer switches manuales de vistas activas; `Mesa` se deriva de mesas activas y `Para llevar` queda disponible.
- Si se implementa o toca `Cambiar mesa` para una orden `DINE_IN`, mantener siempre esta regla:
  - destino libre: mover directo actualizando `orders.table_id`
  - si la orden ya tenia division y el destino esta libre, debe salir de esa division y quedar con `orders.split_id = NULL`
  - destino ocupado: crear nueva division en destino y mover la orden a esa division
- No dejar una mesa compartida con un grupo en `split_id = null` y otro grupo con `split_id` distinto; si el destino ya estaba ocupado por una orden base, convertirla primero en division propia.
- Si despues de mover o eliminar una division solo queda una orden activa en la mesa, esa orden debe colapsar a mesa base y dejar de mostrarse como `3A` o `3B`.

### 7.2) Cancelacion/Anulacion directa por categoria
- La configuracion visible vive en `Admin > Turno`.
- La UI actual trabaja solo con categorias `nivel 0`.
- La primera categoria raiz queda reservada al administrador general.
- No reintroducir una UI de "plato de cocina" por fila salvo cambio funcional explicito.
- Si una categoria raiz no tiene productos aun, igual debe aparecer en el listado si sigue siendo una categoria activa valida.

### 7.3) Solicitudes pendientes de anulacion
- Si un mesero o usuario sin autorizacion solicita una anulacion, la orden debe moverse a una pestana propia `Pendiente de anulacion`.
- No dejar esas ordenes mezcladas en las tabs operativas normales mientras `cancel_requested_at` siga activo.
- El usuario autorizado debe resolverlas desde esa cola, manteniendo visible que se trata de una solicitud y no de una anulacion ya aplicada.
- Debe existir tambien la accion `Negar anulacion`; negar una solicitud limpia la marca pendiente y devuelve la orden a su estado operativo previo, sin aplicar cancelacion real sobre items.

### 8) Snapshot operativo compartido
- Si una pantalla clasifica estados de orden (`Enviada`, `Lista`, `Despachada`, `Por cobrar`), preferir snapshot operativo compartido sobre lecturas parciales.
- No reconstruir reglas operativas criticas desde una sola tabla si ya existe un snapshot consolidado.
- Si el frontend consume `get_order_operational_snapshot`, mantener compatibilidad temporal con la firma legacy mientras haya riesgo de bases remotas sin la migracion mas reciente; una orden despachada no debe desaparecer solo por cambio de nombres de columnas del RPC.
- Si una orden parcial sigue activa y `orders.status` indica una etapa operativa valida (`SENT_TO_KITCHEN`, `READY`, `KITCHEN_DISPATCHED`) pero el snapshot no devuelve cantidad visible para esa etapa, no ocultarla del tablero: aplicar fallback controlado antes de dejarla fuera de todas las pestanas.

## Convenciones de Implementacion

### Frontend
- Si cambia la navegacion del catalogo o el detalle de item, revisar consistencia en:
  - Ordenes
  - Cocina
  - Despacho
  - Ticket
- Si cambia disponibilidad/agotado, revisar tambien:
  - Productos
  - Ordenes
  - vistas de consulta relacionadas
- Distinguir visualmente categoria vs producto; una categoria no debe mostrarse como item vendible con precio.
- En `Caja`, diferenciar visualmente:
  - caja fisica
  - recaudacion por metodo
- Si se implementa anulacion de apertura de caja, no anular el turno operativo: conservar historial separado de aperturas dentro del turno y regresar la caja a estado limpio.
- La accion `Anular apertura` debe vivir dentro de `Resumen`, no en header ni sidebar.
- Solo supervisor de sucursal o administrador general pueden verla/ejecutarla.
- Si ya existen cobros en la caja actual, la anulacion debe bloquearse con mensaje claro al usuario.
- `Cerrar Caja` tambien debe bloquearse si existen ordenes de la sucursal en cualquier estado distinto de `PAID` o `CANCELLED`.
- Si se agregan `Movimientos de Caja`, no mezclarlos con `Recaudado`, pero si se trata de `Cambio de denominacion` deben reflejarse en `cash_shift_denoms` para que `Actual`/`Desglose` muestren la nueva composicion sin alterar el total.
- Si se toca cobro en efectivo, no confiar en recalculos solo del cliente:
  - las denominaciones recibidas y el cambio entregado deben persistirse en backend
  - `Desglose de Caja` debe reflejar los nuevos billetes/monedas reales del turno
- El flujo visible de `Movimientos` debe vivir dentro de `Caja > ShiftSummary`, no en el sidebar izquierdo.
- `Cambio de denominacion` debe exigir monto mayor a `0`, motivo obligatorio y dejar `Impacto en caja: $0.00`.
- El flujo visible vigente de `Movimientos` abre directo al registro; si se necesita historial, debe quedar detras de `Ver historial` y no como paso previo obligatorio.
- En `Cambio de denominacion`, las denominaciones que salen de caja nunca pueden superar el stock actual disponible.
- En movil, evitar tablas comprimidas o filas montadas; preferir tarjetas apiladas o layouts de una sola responsabilidad visual.
- No forzar layouts desktop partidos en ancho insuficiente; si una pantalla no cabe bien en dos columnas, degradar a una sola columna estable.
- Si existe una alerta operativa para el mesero como `orden lista`, no montarla solo en la pagina de `Despacho`; debe vivir en una capa global del layout operativo para que siga funcionando en movil mientras el usuario navega por otras vistas.
- En `Admin > Turno`, priorizar usabilidad movil:
  - bloques verticales
  - resumen adaptable a 1 o 2 columnas
  - controles de despacho apilados
  - boton principal a ancho completo en telefono
- En tablet, `Admin` ya debe comportarse con tabs horizontales; no dejarlo en modo dropdown de telefono si ya hay ancho suficiente.
- `BranchCancelPolicyEditor`, `DispatchConfig`, `ShiftSetupAdmin` y `UsersCrud` deben revisarse juntos cuando se hagan cambios recientes de UX en Admin.
- Si se toca `CancelOrderDialog`, `CashRegisterMovementsDialog` o modales de `ShiftSummary`, revisar tambien:
  - ancho real en telefono (`calc(100vw - margen)`)
  - scroll vertical controlado
  - botones de footer apilados en telefono
  - cards internas sin comprimir inputs o textos
  - en tablet, preferir usar el ancho extra para 2 columnas antes que dejar una ventana muy alta

### Admin
- `Arbol Menu` es la via principal para altas, ediciones, reordenamiento y bajas logicas del catalogo; no debe reintroducirse una pestana visible de `Productos` como superficie principal.
- `image_url` es la representacion visual principal del nodo y debe llenarse desde la subida de archivo a Storage.
- El campo `icon` ya no debe exponerse en `Admin > Arbol Menu`; si persiste en BD, tratarlo solo como remanente legacy.
- La pestana `Modificadores` solo administra el catalogo base; la asignacion a nodos debe hacerse en `Arbol Menu`.
- `AdminTable` debe seguir siendo la base para listados administrativos y en movil debe mostrarse como tarjetas, no como tabla apretada.
- En `Usuarios`, distinguir siempre entre:
  - rol en sucursal activa
  - rol global
- No mostrar etiquetas vacias o confusas como `Sin rol global` si no aportan valor operativo.

### Backend y consultas
- Para modificadores, leer descripciones desde la relacion con `modifiers`.
- La disponibilidad operativa del modificador debe resolverse desde `menu_node_modifiers`.
- Filtrar datos vacios o inconsistentes antes de renderizar.
- Si se toca apertura/cierre de turno, validar tambien la consistencia de mesas activas; no dejar turnos medio abiertos ni mesas activas sin turno.
- No permitir cierre de turno si quedan ordenes o cobros pendientes; esa regla debe vivir en BD y no solo en frontend.
- Administrador general y supervisor de sucursal deben poder operar caja por override administrativo, aunque no tengan `can_use_caja` marcado como usuario comun del turno.
- Si se toca creacion de usuarios, validar el circuito completo:
  - Auth
  - `profiles`
  - sucursal inicial
  - rol de sucursal inicial
  - rollback si la asignacion posterior falla
- Si se toca Ordenes o Despacho, revisar tambien:
  - RLS de tablas de eventos operativos
  - reflejo en vivo entre usuarios/sesiones
- Si se toca cancelacion de ordenes, validar siempre contra el snapshot operativo completo:
  - no asumir que cancelar = solo `Pendiente + Listo`
  - considerar tambien `Despachado no pagado` cuando la regla de negocio lo permita
  - la ventana de cancelacion, las tarjetas de `Despachadas` y los calculos de `Caja` deben seguir exactamente la misma cuenta operativa
- Si la anulacion se dispara desde una tarjeta filtrada por pestana, el dialogo debe respetar exactamente los items visibles de esa tarjeta; no mezclar otros items de la orden completa.
- Si se toca `Despacho`, validar tambien la unicidad de asignacion por usuario y la visibilidad final de tabs segun modo `SINGLE` / `SPLIT`.
- Si se toca divisiones de mesa, validar tambien:
  - que la nueva division quede seleccionada
  - que no pueda crearse una division nueva si una anterior no tiene items
  - que `Eliminar division` se bloquee si ya hubo cocina/listo/despacho/pago/cancelacion
- En Caja, no mezclar montos de efectivo con montos no efectivos al presentar `Diferencia` o `Actual`.
- Si el metodo efectivo no participa en un cobro final, no persistir ni reutilizar denominaciones temporales.

## Checklist Minimo Antes de Cerrar una Tarea
1. `npx.cmd tsc --noEmit`
2. Probar alta/edicion relevante en `Admin > Arbol Menu` si el cambio toca catalogo
3. Probar flujo de orden si el cambio toca seleccion de productos
4. Documentar impacto en:
   - `docs/system_context.md`
   - `docs/PROJECT_ARCHITECTURE.md`
   - `docs/database_architecture.md`
   - `docs/codex_rules.md`
5. Si se tocó un flujo operativo entre modulos, validar que el estado coincida en `Ordenes`, `Despacho`, `Cocina` y `Caja`.

6. Si se toco una Edge Function o una RPC critica, confirmar si requiere deploy o migracion remota antes de dar por cerrado el cambio.

## Estado Base que Debe Mantenerse
- Login con email o username.
- Sucursal activa como contexto operativo.
- Permisos efectivos por modulo/sucursal.
- Modificadores estructurados por nodo e item.
- Navegacion del menu basada en arbol, con Nivel 1 como unica obligatoriedad.
- Modulo `Productos` como superficie operativa para consulta y agotado/activacion.
- Caja con:
  - efectivo controlado por denominaciones
  - transferencia/no efectivo como monto editable
  - resumen de turno separado de recaudacion por metodo

## 9) Autonomía de Asistentes IA
- **Aplicación Directa:** Los asistentes de IA (como Windsurf, Cursor, Gemini, etc.) tienen permitido y se les requiere aplicar los cambios de código directamente a los archivos del proyecto, omitiendo los pasos intermedios de pedir permiso o confirmación para proceder con la escritura de código, a menos que el flujo requiera revisión humana crítica de arquitectura o se rompa un sistema en producción.
