# System Context

## Resumen Ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- La operacion diaria sigue gobernada por permisos efectivos por modulo y sucursal activa.
- `profiles.active_branch_id` sigue siendo el pivote de sesion y contexto operativo.
- El catalogo visible en Ordenes ya navega con arbol recursivo `menu_nodes`, pero la persistencia operativa de items sigue dependiendo de `products`.

## Cambios Aplicados en Esta Jornada (2026-03-14)

### 0) Compatibilidad defensiva del snapshot operativo en frontend
- El frontend ahora debe tolerar tanto la version nueva de `get_order_operational_snapshot` (`quantity_dispatched_total`, `quantity_dispatched_available`, `quantity_cancelled_dispatched`) como la firma legacy que aun devuelve `quantity_dispatched`.
- Si una base remota sigue en la firma anterior, las ordenes despachadas no deben desaparecer de `Ordenes`, `Despacho` o `Caja` por falta de normalizacion de campos.

### 1) Arbol de menu recursivo como nueva navegacion
- Se introdujo `menu_nodes` como estructura jerarquica de profundidad indefinida.
- `MenuNavigator` reemplaza la navegacion plana anterior en el modulo de Ordenes.
- `useMenuTree` carga una sola vez los nodos activos por sucursal y resuelve hijos, breadcrumb y drill-down en memoria.
- Los nodos pueden ser `category` o `product`.

### 2) Regla operativa nueva para navegar y crear productos
- El unico nivel obligatorio para navegar en Mesas/Ordenes es Nivel 1.
- Ya no es obligatoria la secuencia fija `categoria -> subcategoria` para empezar a vender.
- Un producto puede crearse desde Nivel 2 en adelante.
- Un nodo `product` no puede ser raiz y no puede tener hijos.

### 3) Administracion centralizada en Arbol Menu
- En `Admin` se retiraron las pestanas `Categorias`, `Subcategorias` y `Productos`.
- `Admin > Arbol Menu` pasa a ser la via principal para crear, editar, reordenar y desactivar ramas del catalogo.
- El editor del arbol soporta:
  - imagen por archivo subido
  - cambio de padre
  - cambio de orden
  - precio para nodos `product`
  - baja logica con `is_active=false`
- La pestana `Modificadores` administra solo el catalogo base (`modifiers`).
- `Admin > Denominaciones` ahora permite subir imagen por archivo; esa imagen se muestra en Caja al listar monedas/billetes y opciones de cambio.
- `Admin > Denominaciones` ahora maneja tambien `denomination_type` (`Moneda` o `Billete`) como campo explicito, independiente de la etiqueta visible.
- El editor del arbol incorpora la asignacion operativa por nodo mediante `menu_node_modifiers`.
- El panel de modificadores muestra:
  - heredados acumulativos desde ancestros
  - propios del nodo actual
  - vista combinada efectiva
- Un mismo modificador puede reutilizarse en varios nodos distintos sin duplicar el catalogo base.

### 4) Ordenes: UX actual
- Se selecciona un nodo raiz L1 y desde ahi se puede navegar la rama.
- Solo el Nivel 1 se mantiene fijo como barra superior; desde Nivel 2 en adelante toda la navegacion usa el mismo tratamiento por cards, breadcrumb y retroceso.
- El breadcrumb aparece desde niveles profundos.
- Las cards distinguen categoria vs producto:
  - categoria: muestra conteo/indicador de profundidad, no precio
  - producto: muestra precio y permite agregarse a la orden
- La disponibilidad de modificadores ya debe resolverse por nodo efectivo del arbol, no por `subcategory_id` legacy.

### 4.3) Productos: nuevo modulo operativo
- Se agrego un modulo visible en el menu inferior: `Productos`.
- Este modulo reutiliza el mismo arbol de `Ordenes` para consulta operativa del catalogo.
- Si el usuario solo tiene perfil tipo mesero, el modulo funciona en modo consulta.
- Si el usuario tiene capacidad operativa de despacho, puede:
  - marcar un producto como `Agotado`
  - `Activar` nuevamente un producto agotado
  - activar/desactivar nodos completos del arbol
- La activacion/desactivacion por nodo es recursiva: afecta todos los descendientes.
- Lo marcado como agotado en `Productos` debe reflejarse en `Ordenes` como no seleccionable.

### 4.4) Ordenes: reglas operativas nuevas para divisiones
- `Dividir` se interpreta como `dividir mesa`, no como dividir borrador abstracto.
- Solo aplica a ordenes `DINE_IN` con mesa activa y al menos un item.
- Para crear una nueva division adicional (`C`, `D`, etc.), todas las divisiones existentes deben tener al menos un item.
- Al crear una nueva division, la UI debe seleccionar automaticamente la division recien creada.
- Si existe al menos una division, aparece `Eliminar division`, pero solo puede ejecutarse si esa division:
  - no fue enviada a cocina
  - no esta lista
  - no fue despachada
  - no esta pagada
  - no esta cancelada

### 4.5) Ordenes/Caja/Despacho: snapshot operativo unificado
- La clasificacion de ordenes visibles entre `Enviadas`, `Listas`, `Despachadas` y `Por cobrar` ya no debe depender de lecturas parciales de eventos.
- `Ordenes`, `Despacho`, `Cocina` y `Caja` deben apoyarse en el snapshot operativo (`get_order_operational_snapshot`) para evitar que una orden quede pegada en una pestana equivocada.
- Al despachar una orden, `Caja` debe invalidar tambien `payable-orders` para reflejar enseguida lo cobrable.
- La ventana de `Cancelar orden` ya no debe cargar la orden completa si se abre desde una tarjeta filtrada por pestana:
  - debe usar el mismo subconjunto visible de items que la tarjeta desde donde se abrio
  - si la tarjeta muestra solo una linea en `Despachadas`, el dialogo de cancelacion no debe mezclar items de otras etapas de esa misma orden
- La anulacion de orden ya no debe asumir que solo se cancela `Pendiente + Listo`:
  - una cantidad `Despachada` pero aun no `Pagada` tambien puede ser anulable
  - la UI de anulacion, las tarjetas operativas y el backend deben hablar del mismo stock anulable
  - si una cancelacion afecta cantidades despachadas, el snapshot debe restarlas del total despachado visible y registrar esa porcion como merma/perdida operativa cuando corresponda
- Cuando un usuario sin autorizacion solicita una anulacion, la orden ya no debe quedarse mezclada en `Enviadas`, `Listas` o `Despachadas`:
  - debe aparecer en una pestana dedicada `Pendiente de anulacion`
  - esa pestana lista ordenes con `cancel_requested_at` aun activo
  - la tarjeta debe mostrar solo los items/cantidades incluidos en la solicitud pendiente, no todos los items activos de la orden
  - desde ahi el supervisor/usuario autorizado resuelve la aprobacion o cancelacion final
  - tambien debe existir la accion `Negar anulacion`; al negarla se elimina la solicitud pendiente y la orden vuelve a su flujo operativo previo sin alterar cantidades reales

### 4.6) Mesas: modelo hibrido nuevo
- `restaurant_tables` no desaparece: sigue siendo la entidad interna real para FKs, ordenes y divisiones.
- La administracion visible ya no debe tratar las mesas como CRUD fila por fila.
- `branches.reference_table_count` guarda la cantidad referencial de mesas por sucursal.
- `cash_shifts.active_tables_count` guarda cuantas mesas quedan habilitadas para el turno abierto.
- Al abrir turno, Caja define la cantidad operativa del dia y esa cantidad puede ser menor o mayor a la referencia de sucursal.
- El sistema debe preparar internamente capacidad suficiente en `restaurant_tables`, pero en `Mesas` solo deben mostrarse las primeras `active_tables_count`.
- Si no hay turno abierto, `Mesas` no debe asumir automaticamente la referencia de sucursal como mesas visibles.
- La configuracion operativa de mesas ya no se resuelve creando/eliminando registros visibles uno por uno desde Admin.
- `Mesas` ya no debe aparecer como pestana visible dentro de `Admin`.
- En `Duplicar catalogo`, ya no debe existir una opcion separada para copiar `Mesas`.

### 4.7) Turno operativo: nueva superficie en Administracion
- La apertura del turno ya no debe hacerse desde `Caja`.
- Existe una pestana nueva en `Admin`: `Turno`.
- Solo debe estar disponible para:
  - administrador general
  - supervisor / administrador de sucursal con permisos `MANAGE`
- Desde esa pestana se configura:
  - numero de mesas habilitadas del turno
  - metodo de despacho del turno (lo que antes estaba en la pestana `Despacho`)
  - usuarios habilitados para el turno
  - cancelacion/anulacion directa de orden por categoria
- `Turno` debe comportarse como un solo formulario:
  - los cambios de despacho, mesas y usuarios quedan en borrador local
  - nada se persiste al cambiar switches, modo o asignaciones
  - solo se guarda al presionar `Abrir turno` o `Guardar`
- La UX vigente de usuarios del turno es:
  - combo para elegir usuario activo de la sucursal
  - boton `Agregar`
  - solo los usuarios agregados quedan visibles abajo para definir capacidades
- Los usuarios habilitados del turno se persisten por `cash_shift_users`.
- Antes de abrir o guardar turno deben cumplirse estas condiciones:
  - al menos un usuario habilitado
  - al menos un usuario habilitado para despacho; si el modo es `SPLIT`, cada vista activa debe quedar cubierta por asignacion
- En la configuracion actual de `Despacho` dentro de `Turno`:
  - `Mesa` existe si `active_tables_count > 0`
  - `Para llevar` queda disponible
  - no hay switches manuales para prender/apagar vistas
- En modo `SPLIT`, cada despachador solo puede existir una vez en asignaciones; si se vuelve a agregar, debe reemplazar su tipo anterior.
- Si un turno ya abierto reduce el numero de mesas visibles, todas las mesas que queden fuera del nuevo limite deben estar libres; no basta con que no esten activas visualmente.
- Si esa validacion falla, la advertencia al usuario debe salir como dialogo/modal con `Aceptar`, no como `toast`.
- Si no hay turno abierto:
  - los modulos operativos deben quedar bloqueados
  - solo `Administracion` sigue accesible para abrir/configurar turno
- Administrador general y supervisor de sucursal deben poder abrir/cerrar caja aunque no tengan marcada explicitamente la capacidad `Caja` en `cash_shift_users`.

### 4.7.1) Cancelacion/Anulacion directa de orden por categoria
- La configuracion vive dentro de `Admin > Turno`.
- La UI actual lista solo categorias `nivel 0` del arbol.
- Cada fila muestra un check de anulacion directa.
- La primera categoria raiz de la lista solo puede ser marcada o desmarcada por el administrador general.
- El supervisor de sucursal la ve bloqueada.
- Ya no existe una pregunta visual separada para clasificar `plato de cocina` en este bloque; la politica visible fue simplificada a categorias raiz.

### 4.1) App instalable y UX movil
- La aplicacion ahora expone `manifest.json`, iconos PWA y `service worker` para instalacion en movil y desktop.
- El `service worker` usa `cache-first` para assets estaticos y `network-first` para trafico a `supabase.co`.
- El registro del `service worker` ocurre solo en produccion, sin alterar el arranque normal en desarrollo.
- En pantallas pequenas (`max-width: 768px`) se reforzo la UX tactil en `Ordenes`, `MenuNavigator` y `Admin` sin cambiar el comportamiento desktop.
- `Admin > Turno` y su bloque interno de `Despacho` ya deben comportarse bien en movil:
  - tarjetas mas compactas
  - controles de despacho apilados
  - botones principales a ancho completo
  - bloques informativos sin depender de layouts desktop
- En tablet, `Admin` ya no debe seguir el mismo patron colapsado de telefono:
  - las tabs de `Admin` se muestran horizontales desde tablet
  - el dropdown de secciones queda solo para telefono
- `Admin > Turno` debe degradar asi:
  - metricas en 2 columnas en tablet y 1 en telefono
  - `Numero de mesas` y `Cancelacion/Anulacion por categoria` comparten fila en pantallas amplias y se apilan en telefono
  - tarjetas de usuarios del turno en 1 columna telefono, 2 columnas tablet, 3+ en desktop
- `BranchCancelPolicyEditor`, `DispatchConfig` y `UsersCrud` tambien quedaron ajustados para movil/tablet:
  - filas y badges se apilan si falta ancho
  - selects y botones pasan a ancho completo en telefono cuando corresponde
  - acciones de formularios se vuelven verticales en telefono
- Los dialogos operativos nuevos tambien deben seguir esta regla:
  - `CancelOrderDialog` usa ancho real de telefono, botones apilados y cards de item con input abajo si falta ancho
  - `CashRegisterMovementsDialog` usa un solo flujo de registro, con historial oculto detras de `Ver historial`
  - `ShiftSummary` en `Caja` ya distribuye sus acciones en grilla tactil en telefono y modales con alto/scroll controlado
- En tablet estos dialogos deben abrir mas anchos y aprovechar 2 columnas cuando ya hay espacio horizontal suficiente.
- `AdminTable` ya no debe renderizar tablas comprimidas en movil; los CRUD administrativos deben verse como tarjetas apiladas para evitar campos montados.
- La instalacion no depende solo del navegador: para ofrecerse en movil debe servirse en modo produccion y bajo origen confiable (`https` o `localhost`).
- La app muestra un prompt propio de instalacion cuando el navegador emite `beforeinstallprompt`, y en iPhone/Safari muestra una guia breve para `Agregar a pantalla de inicio`.

### 4.2) Caja: UX y reglas operativas nuevas
- La pantalla principal de `Caja` ya no debe ensuciarse con datos redundantes; el resumen `Apertura / Actual / Diferencia` vive en un modal `Resumen`.
- En `Resumen de Caja` deben distinguirse visualmente dos temas:
  - `Caja fisica`: apertura, actual y diferencia
  - `Recaudado`: cobrado total, efectivo, no efectivo y desglose por metodo
- El desglose de `Resumen de Caja` puede sumar metodos no efectivos; la `Diferencia` solo representa dinero fisico en caja.
- `Desglose de Caja` muestra denominaciones ordenadas por `display_order` ascendente y cada fila debe mostrar solo imagen, valor, cantidad y total.
- `Resumen de Caja` ya no debe sentirse como una ventana alta y angosta:
  - en desktop y tablet ancha se distribuye como tablero horizontal
  - en tablet aprovecha 2 columnas antes de degradar a una sola
  - historial y movimientos usan scroll interno, no scroll de toda la ventana
- La anulacion de apertura de caja no anula el turno operativo: se registra como historial de apertura dentro del turno y la caja vuelve a estado limpio para poder abrirse de nuevo.
- La opcion `Anular apertura` vive dentro del modal `Resumen` de `Caja`, nunca en el header principal ni en el sidebar.
- Solo debe mostrarse a administrador general o supervisor de sucursal.
- Solo puede ejecutarse si la apertura activa no tiene cobros registrados; si ya existen ventas/cobros, la UI debe advertirlo y bloquear la confirmacion.
- `Cerrar Caja` debe bloquearse si la sucursal aun tiene ordenes en cualquier estado distinto de `PAID` o `CANCELLED`, aunque no existan cobros pendientes.
- El motivo de anulacion es obligatorio y debe tener al menos 10 caracteres.
- Las aperturas anuladas deben seguir viendose en historial con badge rojo `Anulada`, motivo y usuario que realizo la anulacion.
- `Caja` ahora incluye un cuarto boton en header: `Movimientos`.
- `Movimientos` abre directamente la vista de registro de `Cambio de denominacion`.
- El historial del turno no debe ensuciar la pantalla al abrir: queda detras del boton `Ver historial`.
- El `Cambio de denominacion` no cambia el total de efectivo esperado: su impacto en caja siempre es `0.00`.
- Aun asi, si cambia la composicion real de la caja:
  - suma las denominaciones que ingresan
  - resta las denominaciones que salen
  - por eso `Desglose` y `Actual` deben reflejar el cambio inmediatamente.
- Los cobros en efectivo nuevos tambien deben mover la composicion fisica real de caja:
  - cada billete/moneda recibida entra como `PAYMENT_IN`
  - cada billete/moneda entregada como cambio sale como `CHANGE_OUT`
  - `Desglose` no debe quedarse igual que en la apertura si ya hubo cobros efectivos
- Si una denominacion sale de caja durante el cambio, la cantidad ingresada no puede exceder el stock actual de esa denominacion en `cash_shift_denoms`.
- Los movimientos deben aparecer tambien en `Resumen` del turno como parte del reporte operativo, sin mezclarse con `Diferencia`, `Apertura` o `Recaudado`.
- En `PayableOrdersList`, la vista desktop usa dos columnas: izquierda con KPIs verticales y derecha con detalle operativo mas ancho.
- En desktop las pestanas `Por cobrar` / `Pagos realizados` de Caja se colocan en una columna lateral estrecha; en movil permanecen compactas arriba.
- En `PaymentDialog`, `Efectivo` y `Transferencia` se muestran como filas compactas.
- `Efectivo` queda activo por defecto, muestra `0.00` al iniciar, no es editable manualmente y solo cambia al aceptar `Monedas y billetes`.
- `Transferencia` queda visible pero desactivada por defecto.
- El modal `Monedas y billetes` debe calcular:
  - `Aplicado`: lo realmente asignado al efectivo en ese cobro
  - `Recibido`: suma de denominaciones seleccionadas
  - `Cambio`: `Recibido - Aplicado`, solo si existe monto aplicado en efectivo
- Si el unico metodo activo es `Efectivo`, no debe autocompletarse con el total a cobrar; se mantiene en `0.00` hasta seleccionar denominaciones.
- El modal `Monedas y billetes` ahora permite:
  - sumar/restar cantidades por denominacion
  - editar cantidad manualmente
  - borrar una denominacion completa
  - advertir cuando el recibido ya cubre el pago y aun asi permitir agregar mas, previa confirmacion del usuario
- Las denominaciones se presentan en dos grupos visibles:
  - `Monedas`
  - `Billetes`

### 5) Compatibilidad transitoria con modelo legacy
- Aunque la UI ya navega con `menu_nodes`, `order_items.product_id` sigue referenciando `products(id)`.
- Para no romper el flujo actual, `MenuNodesCrud` sincroniza:
  - nodos raiz/categoria hacia estructura legacy minima
  - nodos `product` hacia `products`
- Esta compatibilidad sigue siendo necesaria mientras Ordenes, Cocina, Despacho y Ticket dependan del catalogo legacy.

## Estado Operativo que Debe Preservarse
- Login con email o username sigue activo.
- Login biometrico sigue basado en WebAuthn/passkeys:
  - la huella o PIN se valida localmente por el dispositivo
  - el servidor valida contra `webauthn_credentials` guardadas en base de datos
  - los challenges de registro/login expiran en 5 minutos
  - la app cierra sesion tras 10 minutos de inactividad
- Sucursal activa sigue resolviendose por `profiles.active_branch_id`.
- Seguridad y permisos siguen validandose en backend/BD, no en UI.
- La creacion y gestion operativa de ordenes, items, modificadores de item y divisiones de mesa depende de permisos `OPERATE` por sucursal en `mesas` y/o `ordenes`; no basta con mostrar el modulo en frontend.
- La disponibilidad/agotado de productos ya no es solo visual: si un nodo o producto esta inactivo en `menu_nodes`, `Ordenes` debe tratarlo como agotado y bloquear su seleccion.
- La visibilidad de estados operativos (`Enviadas`, `Listas`, `Despachadas`, cancelaciones parciales) depende tambien de poder leer las tablas de eventos operativos por sucursal; si RLS de esos eventos no esta alineado con permisos branch/module, las ordenes pueden desaparecer de una pestana sin caer en la siguiente.
- `OrdersList` ya debe refrescarse entre sesiones/usuarios mediante suscripciones en vivo; no confiar solo en invalidaciones locales para reflejar cambios operativos.
- En `Despacho`, la visibilidad final de tabs debe depender del modo configurado y del tipo asignado al usuario del turno:
  - `SINGLE`: puede ver `Todos`, `Mesa` y `Para llevar` segun vistas disponibles
  - `SPLIT`: ve solo el/los tipos asignados; si tiene ambos, tambien puede ver `Todos`
- Modificadores siguen usando el modelo estructurado:
  - catalogo base por `modifiers`
  - disponibilidad por `menu_node_modifiers`
  - seleccion real por `order_item_modifiers`
- La correccion de colisiones de `order_code` sigue vigente y no debe revertirse.
- La correccion de numeracion de mesas por sucursal tambien debe preservarse: nuevas mesas no deben reutilizar `table_number` existentes aunque `entity_counters` este desalineado.
- La creacion de usuarios debe seguir asignando sucursal inicial y rol de sucursal desde backend; no dejar usuarios creados solo en Auth o con sucursal sin rol.
- La apertura/cierre de turno debe seguir siendo transaccional respecto a mesas activas:
  - abrir turno configura `active_tables_count` y activa internamente las mesas del turno
  - cerrar turno desactiva internamente las mesas visibles del turno
- No debe permitirse cerrar un turno si aun existen ordenes o cobros pendientes en la sucursal.

## Riesgos Vigentes
1. No asumir que crear un nodo `product` en `menu_nodes` reemplaza automaticamente toda la operacion: la venta real sigue cerrando sobre `products`.
2. Cualquier cambio al arbol debe cuidar la sincronizacion legacy para no romper FK ni ordenes existentes.
3. No hacer deletes fisicos en catalogo con historial operativo; usar desactivacion logica.

## Checklist Rapido para Continuar
1. Confirmar que `supabase/migrations/20260312110000_add_menu_nodes_tree.sql`, `supabase/migrations/20260313143000_move_modifier_assignments_to_menu_nodes.sql` y `supabase/migrations/20260313170000_add_denomination_images.sql` esten aplicadas.
2. Validar en `Admin > Arbol Menu`:
   - crear raiz
   - crear hijo
   - crear producto desde Nivel 2
   - mover nodo de padre
   - editar imagen
   - agregar/quitar modificador propio
3. Validar en `Mesas/Ordenes`:
   - L1 como unico nivel obligatorio
   - navegacion por ramas profundas
   - producto sincronizado agregandose sin error a la orden
   - modificadores heredados/propios disponibles en el dialogo del producto
4. Si un producto del arbol no entra a la orden, revisar primero su espejo en `products`.
5. Si una mesa nueva choca por `uq_restaurant_tables_branch_table_number`, revisar trigger/contador remoto antes de culpar al frontend.


