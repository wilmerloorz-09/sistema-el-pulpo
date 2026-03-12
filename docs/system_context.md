# System Context

## Resumen Ejecutivo
- Sistema POS multi-sucursal en refactor incremental.
- La operacion diaria sigue gobernada por permisos efectivos por modulo y sucursal activa.
- `profiles.active_branch_id` sigue siendo el pivote de sesion y contexto operativo.
- El catalogo visible en Ordenes ya navega con arbol recursivo `menu_nodes`, pero la persistencia operativa de items sigue dependiendo de `products`.

## Cambios Aplicados en Esta Jornada (2026-03-12)

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
- En `Admin` se retiraron las pestanas `Categorias` y `Subcategorias`.
- `Admin > Arbol Menu` pasa a ser la via principal para crear, editar, reordenar y desactivar ramas del catalogo.
- El editor del arbol soporta:
  - icono por emoji libre
  - iconos sugeridos
  - imagen por URL
  - cambio de padre
  - cambio de orden
  - precio para nodos `product`
  - baja logica con `is_active=false`

### 4) Ordenes: UX actual
- Se selecciona un nodo raiz L1 y desde ahi se puede navegar la rama.
- Los chips del siguiente nivel funcionan como acceso rapido, no como requisito operativo.
- El breadcrumb aparece desde niveles profundos.
- Las cards distinguen categoria vs producto:
  - categoria: muestra conteo/indicador de profundidad, no precio
  - producto: muestra precio y permite agregarse a la orden

### 5) Compatibilidad transitoria con modelo legacy
- Aunque la UI ya navega con `menu_nodes`, `order_items.product_id` sigue referenciando `products(id)`.
- Para no romper el flujo actual, `MenuNodesCrud` sincroniza:
  - nodos raiz/categoria hacia estructura legacy minima
  - nodos `product` hacia `products`
- Esta compatibilidad sigue siendo necesaria mientras Ordenes, Cocina, Despacho y Ticket dependan del catalogo legacy.

## Estado Operativo que Debe Preservarse
- Login con email o username sigue activo.
- Sucursal activa sigue resolviendose por `profiles.active_branch_id`.
- Seguridad y permisos siguen validandose en backend/BD, no en UI.
- Modificadores siguen usando el modelo estructurado:
  - disponibilidad por `subcategory_modifiers`
  - seleccion real por `order_item_modifiers`
- La correccion de colisiones de `order_code` sigue vigente y no debe revertirse.

## Riesgos Vigentes
1. No asumir que crear un nodo `product` en `menu_nodes` reemplaza automaticamente toda la operacion: la venta real sigue cerrando sobre `products`.
2. Cualquier cambio al arbol debe cuidar la sincronizacion legacy para no romper FK ni ordenes existentes.
3. No hacer deletes fisicos en catalogo con historial operativo; usar desactivacion logica.

## Checklist Rapido para Continuar
1. Confirmar que `supabase/migrations/20260312110000_add_menu_nodes_tree.sql` este aplicada.
2. Validar en `Admin > Arbol Menu`:
   - crear raiz
   - crear hijo
   - crear producto desde Nivel 2
   - mover nodo de padre
   - editar icono o imagen
   - desactivar nodo
3. Validar en `Mesas/Ordenes`:
   - L1 como unico nivel obligatorio
   - navegacion por ramas profundas
   - producto sincronizado agregandose sin error a la orden
4. Si un producto del arbol no entra a la orden, revisar primero su espejo en `products`.
