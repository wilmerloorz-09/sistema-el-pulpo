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

### Catalogo
- Fuente de navegacion actual: `menu_nodes`.
- Fuente operativa legacy aun activa: `categories`, `subcategories`, `products`.
- `MenuNodesCrud` es la interfaz principal para administrar la estructura del menu.
- El modulo `ProductsCrud` puede seguir coexistiendo como superficie legacy mientras no se retire definitivamente el modelo operativo anterior.

### Ordenes
- La navegacion de seleccion usa `MenuNavigator` + `useMenuTree`.
- El unico nivel obligatorio para navegar es L1.
- La persistencia del item sigue usando `order_items.product_id`, por lo que `products` aun es obligatorio.
- El resto del flujo operativo (modificadores, cocina, despacho, ticket) continua apoyandose en el modelo existente.

## Cambios Arquitectonicos de Esta Jornada

### A) Arbol recursivo de profundidad indefinida
- Se agrego `menu_nodes` con `parent_id`, `depth`, `node_type`, `display_order`, `icon`, `image_url`, `price` e `is_active`.
- La UI de Ordenes ya trabaja sobre esa jerarquia en memoria, sin consultas por cada nivel.

### B) Navegacion con L1 como unica obligatoriedad
- Se elimino la dependencia funcional de elegir L2 para empezar a navegar.
- Los hijos directos de L1 pueden mostrarse inmediatamente.
- La navegacion profunda se resuelve con breadcrumb, drill-down y retroceso por rama.

### C) Admin orientado al arbol
- Se retiraron de `Admin` las pestanas de `Categorias` y `Subcategorias`.
- `Arbol Menu` es la fuente principal para construir la jerarquia del catalogo.
- Los productos se permiten desde Nivel 2 en adelante.

### D) Capa de compatibilidad legacy
- Al guardar nodos del arbol, se replica la estructura minima necesaria en tablas legacy.
- Los nodos `product` se sincronizan hacia `products` para que puedan entrar a `order_items`.
- Esta capa debe tratarse como compatibilidad transitoria, no como arquitectura destino.

## Componentes Impactados
- `src/hooks/useMenuTree.ts`
- `src/components/order/MenuNavigator.tsx`
- `src/pages/Ordenes.tsx`
- `src/components/admin/MenuNodesCrud.tsx`
- `src/pages/Admin.tsx`

## Principios para los Siguientes Cambios
1. No reintroducir la obligatoriedad de L2 salvo redefinicion funcional explicita.
2. No asumir que `menu_nodes` ya reemplazo por completo a `products`.
3. Si se toca catalogo o detalle de item, validar consistencia en Ordenes, Cocina, Despacho y Ticket.
4. Mantener la migracion al arbol como refactor incremental, no como corte brusco del modelo legacy.
