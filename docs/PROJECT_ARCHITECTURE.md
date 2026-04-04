# Project Architecture

## Arquitectura Vigente
- Frontend: React + TypeScript.
- Backend: Supabase sobre PostgreSQL con RLS, RPC y funciones auxiliares.
- Contexto multi-sucursal: la sucursal activa viene de `profiles.active_branch_id`.
- Estrategia actual: coexistencia controlada entre el arbol nuevo `menu_nodes` y el catalogo legacy `categories` / `subcategories` / `products`.

## Capas Funcionales

### Identidad y sesion
- Supabase Auth + perfil en `profiles`.
- Login por email o username.
- La sucursal activa sigue siendo parte del estado de sesion y de las consultas operativas.

### Autorizacion
- La autorizacion real se define por permisos efectivos por modulo y sucursal.
- Los roles sirven como organizacion administrativa, no como verdad final de acceso operativo.
- La validacion final siempre debe existir en backend/BD.
- Dentro de un turno abierto, `cash_shift_users` agrega una segunda capa operativa por usuario:
  - `can_serve_tables`
  - `can_dispatch_orders`
  - `can_use_caja`
  - `can_authorize_order_cancel`
  - `is_supervisor`

### Catalogo
- Fuente de navegacion actual: `menu_nodes`.
- El catalogo visual ya trabaja con dos alcances:
  - `TABLE`
  - `TAKEOUT`
  - `BULK`
- Fuente operativa legacy aun activa: `categories`, `subcategories`, `products`.
- `MenuNodesCrud` es la interfaz principal para administrar la estructura del menu.
- La compatibilidad con `products` sigue viva a nivel operativo, pero la administracion del catalogo ya no expone una pestana separada de `Productos`; el punto principal de mantenimiento visible es `Arbol Menu`.
- En `Admin` ahora existen dos superficies hermanas:
  - `Arbol Menu Mesa`
  - `Arbol Menu Para Llevar`
- A nivel de categoria, `menu_nodes.manual_price_enabled` permite que una rama opere con precios manuales heredables hacia sus productos descendientes.

### Modificadores
- `modifiers` se mantiene como catalogo base por sucursal.
- La asignacion operativa ya no debe depender de categoria/subcategoria en el CRUD base.
- La disponibilidad del modificador se resuelve por nodo desde `menu_node_modifiers`.
- La seleccion real en el item sigue cerrando en `order_item_modifiers`.

### Ordenes
- La navegacion de seleccion usa `MenuNavigator` + `useMenuTree`.
- El unico nivel obligatorio para navegar es L1.
- La persistencia del item sigue usando `order_items.product_id`, por lo que `products` aun es obligatorio.
- `orders.menu_scope` determina que arbol usar en la orden activa.
- `TAKEOUT` usa siempre `menu_scope = 'TAKEOUT'`.
- `DINE_IN` puede alternar entre `TABLE` y `TAKEOUT` desde la UI de `Ordenes`.
- `BULK` se usa para venta `A granel` y permite asociar productos incluidos con reglas de entrega por monto.
- En `OrderItemsList`, movil y tablet ya no deben forzar el mismo layout:
  - telefono: descripcion/producto a la izquierda y columna fija de cantidad/anulacion a la derecha si cabe
  - tablet: la misma composicion aprovecha mejor el ancho y mantiene controles alineados a la derecha
- La disponibilidad de modificadores en el dialogo de producto debe resolverse por nodo efectivo del arbol, no por `subcategory_id` legacy.
- La disponibilidad/agotado de productos tambien se resuelve desde `menu_nodes.is_active`; un producto agotado puede seguir existiendo en legacy, pero `Ordenes` no debe permitir venderlo.
- Visualmente, `MenuNavigator` ya separa responsabilidades por tipo de nodo:
  - categorias/subniveles: cards
  - productos: filas de lista a ancho completo
- Esa lista de productos se comparte entre `Mesa`, `Para llevar` y `Orden especial`, por lo que cualquier cambio visual en el render de producto debe validarse en los tres flujos.
- La vista de `OrdersList` ya no usa un grid de tarjetas independientes:
  - ahora usa una lista expandible con una fila resumen por orden
  - el detalle de items se abre inline dentro de la misma lista
  - los botones de anular / solicitar / autorizar / negar deben mantenerse dentro de ese flujo sin depender de una card separada
  - en telefono, la fila resumen debe resolverse en dos lineas compactas y no en un stack vertical de bloques
  - en telefono, el cambio de pestana/estado debe hacerse con un `Select` compacto; la grilla de tabs queda para escritorio
- `CancelOrderDialog` usa ahora un selector dual alineado con `PaymentDialog`:
  - izquierda: cantidades aun anulables
  - derecha: cantidades que se aplicaran en la anulacion actual
  - la logica de seleccion sigue produciendo el mismo payload de backend; cambia la superficie de seleccion, no el contrato operativo
  - no debe convivir con toggles visuales del esquema anterior (`parcial/total`); ese estado se deriva desde la seleccion efectiva
  - en UI de anulacion no se muestran precios ni totales monetarios; solo cantidades y contexto operativo por linea
  - el motivo de anulacion debe ir en un `Select` compacto para no consumir altura con una lista de opciones expandida
- La visibilidad de estados operativos entre usuarios depende de dos capas:
  - RLS correcto sobre tablas de eventos operativos
  - suscripciones en vivo en frontend para invalidar listas cuando cambia `orders`, `order_items` y eventos asociados
- La clasificacion final de estados operativos ya no debe depender solo de eventos sueltos: `Ordenes`, `Despacho`, `Cocina` y `Caja` deben apoyarse en un snapshot operativo comun.

### Productos
- Nuevo modulo operativo visible en el menu inferior.
- Reutiliza `MenuNavigator` para consulta del arbol completo.
- Puede funcionar en dos modos:
  - consulta para meseros
  - activacion/desactivacion operativa para perfiles de despacho
- La activacion/desactivacion por nodo es cascada sobre descendientes.

### Mesas y divisiones
- La division de mesa se resuelve sobre `table_splits` + `orders`.
- `restaurant_tables` sigue siendo la entidad interna real para FKs y divisiones.
- La administracion visible ya no debe operar mesas como CRUD manual una por una.
- `branches.reference_table_count` define la base referencial por sucursal.
- `cash_shifts.active_tables_count` define la cantidad operativa del turno abierto.
- `Mesas` solo debe renderizar la capacidad activa del turno, no todo el pool interno de `restaurant_tables`.
- `Admin` ya no expone una pestana visible de `Mesas` como CRUD operativo.
- La regla vigente es:
  - una mesa base con items puede dividirse
  - una division nueva solo puede crearse si todas las divisiones anteriores tienen al menos un item
  - la nueva division creada debe quedar seleccionada automaticamente
  - la eliminacion de division solo aplica antes de cocina/listo/despacho/pago/cancelacion
- El cambio de mesa para `DINE_IN` tambien vive sobre estas mismas entidades, sin tablas nuevas:
  - destino libre: update directo de `orders.table_id`
  - si la orden movida ya tenia `split_id`, al pasar a una mesa libre deja de ser division y `orders.split_id` debe quedar `NULL`
  - destino ocupado: se crea una division nueva en la mesa destino y la orden movida pasa a esa nueva division
- Si la mesa destino estaba ocupada por una orden aun sin `split_id`, esa orden debe convertirse primero en su propia division para no mezclar grupos ni romper la vista de siblings por mesa.
- Si despues de mover o eliminar una division solo queda una orden activa en una mesa, esa orden debe volver a representar la mesa base y perder su `split_id`.
- El mosaico principal de `Mesas` ahora expone tambien saldo pendiente visible por tarjeta:
  - total unico abajo a la derecha cuando no hay divisiones visibles
  - hasta 2 etiquetas inferiores cuando hay divisiones
  - sin montos si hay mas de 2 divisiones activas
- El `split_code` visible debe formatearse como `2A`, `2B`, etc., sin espacio intermedio.
- La lectura del mosaico ya no debe recomponerse en frontend con varias queries operativas; el resumen sale de `get_branch_tables_overview(...)`.
- `Mesas` actua tambien como superficie de warm-up:
  - precalienta el detalle de las ordenes visibles
  - precalienta el arbol de menu para `TABLE`, `TAKEOUT` y `BULK`
  - al navegar a `Ordenes`, la pantalla debe reutilizar ese cache en React Query

### Usuarios y alta administrativa
- `UsersCrud` sigue siendo la superficie de administracion de usuarios.

### Usuarios y alta administrativa
- `UsersCrud` sigue siendo la superficie de administracion de usuarios.
- La Edge Function `create-user` debe:
  - validar duplicados de `email` y `username`
  - crear el usuario en Auth
  - asignar sucursal inicial y rol de sucursal inicial
  - asignar rol global si aplica
  - hacer rollback del usuario de Auth si la asignacion posterior falla
- La UI de `Usuarios` debe distinguir:
  - rol en sucursal activa
  - rol global, el cual sirve de base para la herencia de permisos
- El modulo de `Usuarios` fue modernizado para permitir una gestion mas fluida:
  - `EditUserDialog` con _sticky footer_ para acciones permanentes
  - Asignacion automatica de roles de sucursal basados en el tipo de usuario global
  - Permiso para administradores globales de gestionar avatares de cualquier perfil

## Cambios Arquitectonicos de Esta Jornada

### A.1) Primera apertura instantanea de Mesas/Ordenes
- `Ordenes` ya no comparte el mismo camino critico de render con la carga pesada del catalogo legacy.
- La orden puede pintarse primero y el menu completar su hidratacion aparte.
- La seleccion de producto resuelve el detalle operativo on-demand:
  - producto legacy
  - herencia de `manual_price_enabled`
  - modificadores efectivos por nodo y ancestros
- Esto reemplaza la carga eager previa del catalogo operativo completo al abrir cualquier orden.

### A.2) Cache cliente con stale-while-revalidate
- `useOrder` y `useMenuTree` usan cache React Query con `staleTime` y `gcTime`.
- `Mesas` precalienta:
  - query de detalle de orden por `order_id`
  - arboles de menu por `menu_scope`
- Si la data ya existe en cache, `Ordenes` la reutiliza y revalida en segundo plano.
- Si la data aun no existe, la pantalla muestra skeleton inmediato en vez de spinner bloqueante.

### A.3) Resumen de mesas consolidado
- Nueva RPC: `get_branch_tables_overview(p_branch_id uuid)`.
- Objetivo:
  - mover a backend el resumen por mesa del turno
  - evitar N+1 y joins armados en frontend
  - exponer en una sola ida: estado, orden activa, total pendiente, divisiones, items y minutos transcurridos
- Los borradores vacios siguen siendo navegables, pero no deben marcar una mesa como ocupada.

### A.4) Frescura por invalidacion, no por polling ciego
- `useTablesWithStatus` mantiene una sola suscripcion Realtime por sucursal activa.
- Esa suscripcion invalida el resumen consolidado cuando cambian ordenes, items, pagos, divisiones o eventos operativos relevantes.

### A) Arbol recursivo de profundidad indefinida
- Se agrego `menu_nodes` con `parent_id`, `depth`, `node_type`, `display_order`, `image_url`, `price`, `is_active` y `manual_price_enabled`; la columna `icon` queda como remanente legacy y ya no se expone en el editor principal.
- La UI de Ordenes ya trabaja sobre esa jerarquia en memoria, sin consultas por cada nivel.

### B) Navegacion con L1 como unica obligatoriedad
- Se elimino la dependencia funcional de elegir L2 para empezar a navegar.
- Los hijos directos de L1 pueden mostrarse inmediatamente.
- Solo L1 conserva tratamiento fijo en la parte superior; desde L2 en adelante la navegacion profunda se resuelve con el mismo esquema de breadcrumb, drill-down y retroceso por rama.

### C) Admin orientado al arbol
- Se retiraron de `Admin` las pestanas de `Categorias`, `Subcategorias` y `Productos`.
- `Arbol Menu` se divide ahora en dos alcances:
  - `Arbol Menu Mesa`
  - `Arbol Menu Para Llevar`
- `Arbol Menu Para Llevar` incorpora `Copiar desde Mesa` como accion de bootstrap.
- Los productos se permiten desde Nivel 2 en adelante.
- Las asignaciones de modificadores tambien viven en `Arbol Menu`; la pestana `Modificadores` queda solo para el catalogo base.
- Cuando el nodo es `category`, el editor tambien expone `Precios manuales`; esa decision se guarda en el propio nodo y la carga operativa del catalogo puede heredarla hacia productos descendientes.

### D.0) Denominaciones Globales
- El catalogo de `denominations` ya no es por sucursal.
- La arquitectura permite que los administradores globales mantengan un solo pool de denominaciones e imagenes para toda la red.
- El RLS ahora valida `is_global_admin` para cualquier operacion de escritura en denominaciones.

### D) Capa de compatibilidad legacy
- Al guardar nodos del arbol, se replica la estructura minima necesaria en tablas legacy.
- Los nodos `product` se sincronizan hacia `products` para que puedan entrar a `order_items`.
- En alcance `TAKEOUT`, las categorias ya no deben crear/editar `subcategories` legacy.
- Los productos `TAKEOUT` siguen necesitando espejo en `products`, pero deben resolver la categoria legacy equivalente sin fabricar ramas nuevas fuera del arbol `Mesa`.
- Esta capa debe tratarse como compatibilidad transitoria, no como arquitectura destino.

### D.1) Productos incluidos para A granel
- Los productos `BULK` pueden vincular productos incluidos desde el arbol `TABLE`.
- Esa relacion se administra en frontend con `BulkIncludedProductsPanel` y `useBulkIncludedProducts`.
- La persistencia vive en dos tablas auxiliares:
  - `bulk_included_products`
  - `bulk_included_product_ranges`
- La UI administrativa ya trabaja con una tabla visible de `Desde` y `Entregar`; el `Hasta` se deriva automaticamente.
- En tiempo de venta, la resolucion de entrega no cambia `order_items.product_id`; solo agrega una instruccion operativa en `order_items.item_note`.

### E) Caja: composicion actual del flujo de cobro
- `Caja` se divide en:
  - resumen de turno (`ShiftSummary`)
  - ordenes por cobrar (`PayableOrdersList`)
  - pagos realizados (`CompletedPaymentsList`)
- La apertura del turno ya no debe vivir aqui como flujo principal; queda en `Admin > Turno`.
- `ShiftSummary` ya no expone totales de apertura/actual de forma permanente en la pantalla; usa un modal `Resumen` y otro modal `Desglose`.
- La anulacion de apertura de caja se resuelve dentro de `ShiftSummary > Resumen`.
- Para soportarla sin romper el turno operativo, el historial de aperturas de caja se separa conceptualmente del turno y se consulta como registros propios del turno actual.
- Una anulacion vuelve la caja a estado limpio (`UNOPENED`) pero conserva la apertura anulada en historial con motivo y usuario responsable.
- El cierre de caja debe validar tambien el estado operativo de `orders`: si la sucursal aun tiene ordenes no `PAID` y no `CANCELLED`, la caja no puede cerrarse.
- `ShiftSummary` ahora expone tambien `Movimientos`, en un modal propio desde el header.
- Los movimientos de caja se modelan como auditoria separada del total de caja: sirven para trazabilidad y reporte, pero no para recalcular `Actual`, `Diferencia` ni `Recaudado`.
- El soporte inicial visible es `Cambio de denominacion`; el modelo queda preparado para futuras `Entradas` y `Salidas`.
- La UX vigente de `Movimientos` es de un solo paso:
  - al abrir el modal se entra directo al registro del cambio de denominacion
  - el historial existente queda disponible detras de `Ver historial`
  - el registro exige cuadrar `Sale de caja` vs `Ingresa a caja`
  - las denominaciones que salen de caja no pueden exceder la cantidad fisica actual disponible
- La caja fisica ya no debe depender solo de snapshots locales del frontend:
  - los cobros en efectivo y cambios de denominacion deben actualizar `cash_shift_denoms.qty_current`
  - `Desglose de Caja` y `Resumen` deben leer el estado real persistido del turno
- `PayableOrdersList` usa layout de dos columnas en desktop: KPIs verticales y listado operativo.
- En movil/tablet:
  - la lista principal puede seguir siendo tabla suave en desktop
  - los detalles expandidos deben degradar a bloques apilados si el ancho no alcanza
- La navegacion entre `Por cobrar` y `Pagos realizados` ya no es exclusivamente interna a la pagina:
  - en desktop/tablet se expone como subnavegacion del item `Caja` en la `sidebar`
  - en movil se mantiene como conmutador compacto dentro de `Caja`
  - la seleccion actual se persiste en la URL (`?tab=completed`) para que el shell pueda controlarla
- `PaymentDialog` contiene:
  - seleccion de cantidades a cobrar con dos columnas (`Items pendientes` y `Items a cobrar ahora`) desde tablet
  - metodos de pago compactos en una franja inferior
  - modal dedicado para `Monedas y billetes`
- La arquitectura del flujo de cobro incorpora ahora:
  - Persistencia del modal tras el pago exitoso para permitir la impresion del ticket de venta
  - Soporte nativo para tickets de 80mm optimizados para impresoras termicas
  - Navegacion automatica al ticket si el efectivo cubre la totalidad de la orden
- La lista visible de metodos debe deduplicar nombres equivalentes (`Efectivo`, etc.) para no repetir opciones en pantalla.
- Para ordenes normales:
  - la seleccion inicia en cero
  - el usuario mueve unidades entre columnas con acciones por item
  - el subtotal real visible se calcula por cantidad movida
  - el modal no debe cerrarse automaticamente en un pago parcial mientras la orden siga vigente
- Para ordenes especiales:
  - se mantiene el flujo de monto manual
  - el total real de items sigue visible como referencia
- `useCaja` enriquece ahora cada item cobrable con `menu_node_id`, `image_url` e `icon` cuando puede resolverlos desde `menu_nodes`, permitiendo que `PaymentDialog` use la imagen real del producto.
- La regla de efectivo en arquitectura actual es:
  - monto de efectivo controlado por denominaciones
  - no editable manualmente
  - transferencia/no efectivo editable por input
- `Monedas y billetes` solo debe habilitarse cuando ya exista al menos un item seleccionado en `Items a cobrar ahora`.
- El modal de efectivo se comporta como subflujo especializado:
  - agrupa `Monedas` y `Billetes`
  - permite cantidad manual por denominacion
  - valida excedentes con confirmacion explicita

### F) Snapshot operativo compartido
- Se consolido la dependencia en `get_order_operational_snapshot` para evitar divergencias entre:
  - `OrdersList`
  - `useDispatchOrders`
  - `useKitchenOrders`
  - `useCaja`
- La capa frontend que consume ese snapshot debe aceptar temporalmente ambas firmas:
  - firma nueva con `quantity_dispatched_total` y `quantity_dispatched_available`
  - firma legacy con `quantity_dispatched`
- Esa tolerancia evita que una orden despachada desaparezca de las vistas operativas cuando la BD remota aun no aplico la migracion mas reciente.
- Ademas, si una orden parcial conserva `orders.status` y timestamps operativos validos pero el snapshot no devuelve cantidad visible para esa etapa, la UI de `Ordenes` debe usar un fallback acotado por etapa para no ocultar la linea activa restante.
- La arquitectura operativa de estados debe considerar ese snapshot como lectura principal para UI cross-modulo.
- Las solicitudes de anulacion pendientes forman ahora una vista operativa propia en `Ordenes`:
  - la fuente visible es `orders.cancel_requested_at`
  - mientras exista esa marca, la orden sale de las tabs operativas normales y pasa a `Pendiente de anulacion`
  - la resolucion final sigue dependiendo del flujo de autorizacion/cancelacion, no de la mera solicitud
- En ese flujo, administrador general, administrador de sucursal, supervisor habilitado en turno y usuarios con `can_authorize_order_cancel` pueden resolver directo.
- La politica `allow_direct_cancel` de categoria queda reservada al camino de anulacion directa por mesero, y deja de aplicar cuando la seleccion ya toca una linea/orden despachada.
- Ese snapshot ahora tambien debe distinguir:
  - `quantity_dispatched_total`
  - `quantity_dispatched_available`
  - `quantity_cancelled_dispatched`
- Para el flujo nuevo de `Despacho`, `quantity_dispatched_available` representa la cantidad actualmente despachable (`PENDING + READY`) y no el neto historico ya despachado.
- Para que ese calculo siga siendo exacto cuando un item se despacha directo desde `PENDING`, `order_item_dispatch_events` ahora debe registrar `source_stage` (`PENDING` o `READY`) y el snapshot debe recomponer `quantity_pending_prepare` y `quantity_ready_available` desde esa desagregacion.
- La anulacion parcial/total puede consumir cantidades en este orden:
  - `PENDING`
  - `READY`
  - `DISPATCHED` no pagado
- Si la UI muestra una orden en `Despachadas`, la ventana de anulacion debe derivar sus cantidades anulables del mismo snapshot y no de una formula parcial distinta.
- Ademas, si el dialogo se abre desde una tarjeta filtrada por pestana, el dialogo debe respetar exactamente ese subconjunto visible y no mezclar otros items de la orden completa.
- En `Ordenes`, el flujo de anulacion por linea ya no es una variante del dialogo general de cancelacion:
  - la cantidad se define primero en la propia tarjeta del item
  - el dialogo posterior funciona como confirmacion compacta
  - la operacion enviada al backend siempre es `partial` a nivel de orden, aunque la linea quede anulada por completo
  - esto evita que una anulacion total de una sola linea se convierta accidentalmente en anulacion total de la orden

### I) Apertura/cierre de turno como frontera operativa de mesas
- Abrir turno debe ser transaccional respecto a `cash_shifts`, `cash_shift_denoms`, `cash_movements` y mesas activas.
- Cerrar turno debe apagar internamente las mesas visibles del turno para no dejar capacidad operativa colgada fuera de Caja.
- La configuracion del turno ahora vive en `Admin > Turno`, donde tambien se administran:
  - mesas activas
  - metodo de despacho
  - usuarios habilitados del turno
- `Admin > Turno` debe tratarse como un formulario unico de configuracion operativa, no como varios modulos independientes:
  - `Despacho` no debe persistir cambios de inmediato desde switches o asignaciones
  - la persistencia total ocurre solo con `Abrir turno` o `Guardar`
- La UX vigente del bloque de usuarios del turno ya no es "todos visibles y luego desmarcar":
  - se agregan usuarios activos de sucursal desde combo + boton
  - solo los agregados quedan como tarjetas configurables
- El bloque `Cancelacion/Anulacion directa de orden por categoria` vive dentro de este mismo formulario y persiste junto con el resto.
- Sin turno abierto, los modulos operativos deben degradarse a estado bloqueado; `Admin` queda como unico punto de entrada para administradores/supervisores.

### J) Despacho por tipo de orden
- El bloque de `Metodo de despacho` ya no expone switches manuales de vistas activas.
- Las vistas activas se derivan de la configuracion operativa:
  - `Mesa` depende de que haya mesas activas en el turno
  - `Para llevar` se mantiene disponible
- En `Despacho`:
  - modo `SINGLE`: tabs `Todos`, `Mesa`, `Para llevar`
  - modo `SPLIT`: cada usuario ve solo el tipo asignado
  - si un usuario queda con ambos tipos, tambien puede ver `Todos`
- El card operativo de `Despacho` ya no usa un solo boton global por orden:
  - se refactorizo a una vista de lista tipo acordeon para manejar alto volumen sin saturar la pantalla
  - cada item expone su stepper de cantidad
  - `Listo` es solo una senal para el mesero
  - `Despachar` consume desde `PENDING` y/o `READY` sin requerir `READY` previo
  - ambos botones deben coexistir visualmente y apilarse en movil si no caben en una fila
- `useDispatchOrders` conserva las operaciones globales para compatibilidad, pero la UX principal ya vive en acciones por item (`markItemReady` y `dispatchItem`).
- El `Listo` del encabezado de tarjeta en `Despacho` ya no debe depender de `mark_order_quantities_ready`; su arquitectura final es alerta pura para mesero y se soporta sobre:
  - `emit_order_ready_alert(...)`
  - `get_mesero_ready_alerts(...)`
  - `order_has_dispatch_after(...)`
- La alerta se filtra por `orders.created_by` para no sonar en sesiones de otros usuarios de la misma sucursal.
- La alarma debe repetirse hasta detectar cualquier despacho posterior de la orden.
- Una asignacion de despachador debe ser unica por usuario; no se permiten duplicados del mismo usuario.

### G) Admin movil
- Los listados administrativos reutilizan `AdminTable`.
- En movil, `AdminTable` debe renderizar tarjetas apiladas y no tablas comprimidas, para evitar superposicion de campos y acciones.

### H) Movil primero en vistas operativas
- `AppLayout`, `BottomNav`, `Mesas`, `Caja`, `Productos`, `Admin` y `MenuNavigator` ya recibieron una pasada movil explicita.
- La navegacion inferior y los contenedores superiores ya no deben asumirse como layouts desktop reducidos; deben comportarse como superficies tactiles reales.
- `ShiftSetupAdmin` y `DispatchConfig` tambien quedaron dentro de esta regla:
  - el resumen del turno puede colapsar en 1 o 2 columnas
  - los bloques del formulario se apilan verticalmente
  - las acciones principales deben mantenerse usables a ancho completo en telefono
  - los formularios de asignacion de despacho deben degradar a una sola columna en movil
- `Admin` ya tiene comportamiento mixto movil/tablet:
  - telefono: selector colapsado por dropdown
  - tablet/desktop: tabs horizontales con scroll
- `BranchCancelPolicyEditor` y `UsersCrud` tambien deben degradar a layouts tactiles reales, no a escritorio comprimido.
- Los dialogos operativos recientes tambien forman parte de esta regla:
  - `CancelOrderDialog` debe abrir en ancho real de telefono/tablet, con acciones apiladas y controles de cantidad legibles
  - `CashRegisterMovementsDialog` debe degradar de 2 columnas a 1 cuando no hay ancho suficiente
- `ShiftSummary` debe mantener sus botones del header y modales usables sin asumir desktop
- `ShiftSummary`, `CashRegisterMovementsDialog` y `CancelOrderDialog` deben escalar asi:
  - telefono: una columna, footer apilado, inputs a ancho completo
  - tablet: modales mas anchos y grids de 2 columnas cuando haya espacio
  - desktop: dashboard horizontal sin depender de scroll de toda la ventana
- La notificacion de `orden lista` para mesero/despacho debe vivir a nivel de layout operativo y no solo dentro de `Despacho`, para que el movil pueda seguir alertando aunque el usuario este en `Mesas` u otra vista operativa.
- `OrderItemsList` en `Ordenes` tambien debe seguir esta regla:
  - telefono: descripcion a la izquierda y columna fija de stepper/boton a la derecha cuando el ancho lo permita
  - tablet: descripcion a la izquierda y controles a la derecha cuando ya haya ancho util
- `CancelOrderDialog` en modo compacto debe aprovechar tablet con layout mas ancho y, cuando hay espacio, con detalle del item y cantidad preseleccionada en dos columnas.
- `Mesas` tambien debe seguir esta regla:
  - telefono: badges de total/split con ancho acotado y truncado visual
  - tablet: mismas esquinas inferiores, pero con mayor padding y texto mas legible
- `Ordenes` tambien debe seguir esta regla:
  - telefono: item con descripcion a la izquierda y stepper/boton a la derecha, evitando mandar los controles al pie de la card
  - tablet: mantener la misma columna fija de controles con mejor aprovechamiento horizontal

### K) Shell adaptativo de navegacion
- `AppLayout` pasa a ser el shell responsivo comun del sistema.
- En `>= 768px`, la arquitectura visible del shell usa `sidebar` izquierda ancha con contexto de sucursal y subnavegacion contextual cuando aplica.
- En `< 768px`, la arquitectura visible del shell usa `bottom nav` fija con padding inferior compensado en `main`.
- La logica de visibilidad de modulos no se duplico por layout: `sidebar` y `bottom nav` comparten la misma resolucion de items visibles segun permisos, turno y acceso a despacho.
- El tema visual ya no debe depender de un provider externo no montado; la arquitectura actual usa un hook propio que sincroniza `data-theme`, clase `dark` y consumidores visuales como `Sonner`.
- En `Mesas`, el panel de detalle es arquitectonicamente una lectura auxiliar del mismo dataset de `useTablesWithStatus`; no introduce queries nuevas ni cambia handlers de apertura/navegacion.
- En `sidebar`, la arquitectura actual fija header y footer y deja scroll solo en la lista central para evitar cortes verticales al final del menu.
- Cuando una navegacion hacia `Ordenes` se dispara desde `Mesas`, la arquitectura visible del shell debe poder conservar `Mesas` como item activo mediante contexto de origen (`from=mesas`), aunque la ruta real sea `/ordenes`.

## Componentes Impactados
- `src/hooks/useMenuTree.ts`
- `src/hooks/useMenuData.ts`
- `src/hooks/useOrder.ts`
- `src/hooks/useOrdersByStatus.ts`
- `src/hooks/useCaja.ts`
- `src/hooks/useBranchShiftGate.ts`
- `src/hooks/useTablesWithStatus.ts`
- `src/hooks/useDispatchOrders.ts`
- `src/hooks/useKitchenOrders.ts`
- `src/components/order/MenuNavigator.tsx`
- `src/pages/Ordenes.tsx`
- `src/pages/Productos.tsx`
- `src/components/admin/MenuNodesCrud.tsx`
- `src/components/admin/ModifiersCrud.tsx`
- `src/pages/Admin.tsx`
- `src/pages/Caja.tsx`
- `src/components/caja/OpenShiftForm.tsx`
- `src/components/admin/ShiftSetupAdmin.tsx`
- `src/components/admin/BranchCancelPolicyEditor.tsx`
- `src/components/admin/DispatchConfig.tsx`
- `src/components/admin/UsersCrud.tsx`
- `src/pages/Mesas.tsx`
- `src/components/AppLayout.tsx`
- `src/components/BottomNav.tsx`
- `src/components/caja/ShiftSummary.tsx`
- `src/components/caja/PayableOrdersList.tsx`
- `src/components/caja/PaymentDialog.tsx`
- `src/components/admin/AdminTable.tsx`

## Principios para los Siguientes Cambios
1. No reintroducir la obligatoriedad de L2 salvo redefinicion funcional explicita.
2. No asumir que `menu_nodes` ya reemplazo por completo a `products`.
3. Si se toca catalogo o detalle de item, validar consistencia en Ordenes, Cocina, Despacho y Ticket.
4. Mantener la migracion al arbol como refactor incremental, no como corte brusco del modelo legacy.
5. Mantener `modifiers` como catalogo reutilizable y mover la disponibilidad a relaciones por nodo, no al CRUD base.
6. En Caja, diferenciar siempre `caja fisica` de `recaudacion por metodo`; no mezclar ambos conceptos en el mismo resumen sin rotulacion clara.
7. Si un flujo necesita el estado real de una orden, preferir snapshot operativo compartido antes que reconstrucciones parciales ad hoc.

## Addendum 2026-03-25B
### Orden Especial
- `Orden Especial` no abre un modulo paralelo: reutiliza `Mesas`, `Ordenes` y `Caja`.
- `src/pages/Mesas.tsx` ahora puede:
  - abrir una orden especial nueva
  - reutilizar un borrador especial del usuario si aun no tiene envio operativo
- `src/pages/Ordenes.tsx` ahora resuelve tres capacidades:
  - una orden especial puede navegar ambos arboles visuales (`TABLE` y `TAKEOUT`)
  - el usuario puede editar `total especial manual`
  - una orden de mesa activa puede convertirse en especial liberando `table_id` y `split_id`
- `src/hooks/useOrder.ts` centraliza las mutaciones nuevas:
  - `updateSpecialTotal`
  - `convertToSpecial`
- `src/components/caja/PayableOrdersList.tsx` y `src/components/caja/PaymentDialog.tsx` ya distinguen entre:
  - cobro normal por items/cantidades
  - cobro especial por monto manual pendiente
- `src/hooks/useCaja.ts` mantiene ambos modelos coexistiendo:
  - orden normal sigue usando `payment_items`
  - orden especial usa `payments.amount` contra `orders.special_total_manual`
- La presentacion visual de origen de orden ya no puede inferirse solo por `table_name`; debe contemplar `is_special`.
- `src/pages/Despacho.tsx` y `src/hooks/useDispatchAccess.ts` ahora exponen una vista explicita `Orden especial`.
- En despacho:
  - `Mesa` muestra solo `DINE_IN` no especiales
  - `Orden especial` muestra solo `orders.is_special = true`
  - `Para llevar` sigue mostrando solo `TAKEOUT`
- `Orden Bandeja` reutiliza el flujo operativo de `TAKEOUT` y se identifica con `orders.is_tray_order = true`.
- `useTrayOrder` concentra la creacion de orden bandeja y la carga del arbol filtrado para `Tipo C`.
- `MenuNavigator` ahora acepta `trayMode` opcional; si no se envia, mantiene el comportamiento previo.
- `TrayItemTypeSelector` decide entre tipos `A/B/C` y `TrayItemChip` resume el tipo de entrega en Ordenes, Cocina, Despacho y Caja.
- En la presentacion visible actual, una orden de bandeja puede seguir existiendo como `orders.is_tray_order = true`, pero en `Caja` y `Despacho` debe mostrarse como `Para llevar`.

## Addendum 2026-03-29
- `A granel` ya debe considerarse parte de la arquitectura operativa estable, no un experimento temporal de UI.
- `OrderItemsList`, `OrderDetailPanel`, `KitchenCard`, `DispatchCardBase`, `ThermalReceipt`, `PayableOrdersList`, `PaymentDialog`, `CompletedPaymentsList` y `PaymentReversalModal` ya contemplan render especial para `tray_item_type = 'C'`.
- La regla visible actual es:
  - no representar el item `A granel` como compra por unidades
  - usar la instruccion `Entregar: ...` como mensaje operativo destacado
  - en `Despacho`, usar el valor del item en lugar del stepper
- En `Caja`, al cobrar una orden `TAKEOUT`/bandeja por completo:
  - se guarda `paid_at`
  - pero el estado vuelve a `READY` para que el flujo logistico siga en `Despacho`
