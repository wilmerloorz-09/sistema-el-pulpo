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
- Fuente operativa legacy aun activa: `categories`, `subcategories`, `products`.
- `MenuNodesCrud` es la interfaz principal para administrar la estructura del menu.
- La compatibilidad con `products` sigue viva a nivel operativo, pero la administracion del catalogo ya no expone una pestana separada de `Productos`; el punto principal de mantenimiento visible es `Arbol Menu`.

### Modificadores
- `modifiers` se mantiene como catalogo base por sucursal.
- La asignacion operativa ya no debe depender de categoria/subcategoria en el CRUD base.
- La disponibilidad del modificador se resuelve por nodo desde `menu_node_modifiers`.
- La seleccion real en el item sigue cerrando en `order_item_modifiers`.

### Ordenes
- La navegacion de seleccion usa `MenuNavigator` + `useMenuTree`.
- El unico nivel obligatorio para navegar es L1.
- La persistencia del item sigue usando `order_items.product_id`, por lo que `products` aun es obligatorio.
- La disponibilidad de modificadores en el dialogo de producto debe resolverse por nodo efectivo del arbol, no por `subcategory_id` legacy.
- La disponibilidad/agotado de productos tambien se resuelve desde `menu_nodes.is_active`; un producto agotado puede seguir existiendo en legacy, pero `Ordenes` no debe permitir venderlo.
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
  - rol global, solo si existe

## Cambios Arquitectonicos de Esta Jornada

### A) Arbol recursivo de profundidad indefinida
- Se agrego `menu_nodes` con `parent_id`, `depth`, `node_type`, `display_order`, `image_url`, `price` e `is_active`; la columna `icon` queda como remanente legacy y ya no se expone en el editor principal.
- La UI de Ordenes ya trabaja sobre esa jerarquia en memoria, sin consultas por cada nivel.

### B) Navegacion con L1 como unica obligatoriedad
- Se elimino la dependencia funcional de elegir L2 para empezar a navegar.
- Los hijos directos de L1 pueden mostrarse inmediatamente.
- Solo L1 conserva tratamiento fijo en la parte superior; desde L2 en adelante la navegacion profunda se resuelve con el mismo esquema de breadcrumb, drill-down y retroceso por rama.

### C) Admin orientado al arbol
- Se retiraron de `Admin` las pestanas de `Categorias`, `Subcategorias` y `Productos`.
- `Arbol Menu` es la fuente principal para construir la jerarquia del catalogo y usa subida de imagen a Storage como mecanismo visible de administracion.
- Los productos se permiten desde Nivel 2 en adelante.
- Las asignaciones de modificadores tambien viven en `Arbol Menu`; la pestana `Modificadores` queda solo para el catalogo base.

### D) Capa de compatibilidad legacy
- Al guardar nodos del arbol, se replica la estructura minima necesaria en tablas legacy.
- Los nodos `product` se sincronizan hacia `products` para que puedan entrar a `order_items`.
- Esta capa debe tratarse como compatibilidad transitoria, no como arquitectura destino.

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
- `PaymentDialog` contiene:
  - seleccion de cantidades a cobrar
  - metodos de pago compactos
  - modal dedicado para `Monedas y billetes`
- La regla de efectivo en arquitectura actual es:
  - monto de efectivo controlado por denominaciones
  - no editable manualmente
  - transferencia/no efectivo editable por input
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
- Ese snapshot ahora tambien debe distinguir:
  - `quantity_dispatched_total`
  - `quantity_dispatched_available`
  - `quantity_cancelled_dispatched`
- La anulacion parcial/total puede consumir cantidades en este orden:
  - `PENDING`
  - `READY`
  - `DISPATCHED` no pagado
- Si la UI muestra una orden en `Despachadas`, la ventana de anulacion debe derivar sus cantidades anulables del mismo snapshot y no de una formula parcial distinta.
- Ademas, si el dialogo se abre desde una tarjeta filtrada por pestana, el dialogo debe respetar exactamente ese subconjunto visible y no mezclar otros items de la orden completa.

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
