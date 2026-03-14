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

## Denominaciones
- `denominations` ahora soporta `image_url` para representar visualmente monedas y billetes.
- `denominations.denomination_type` define explicitamente si una denominacion es `coin` o `bill`.
- La imagen se carga a Storage en el bucket publico `denomination-images` y se reutiliza en Admin/Caja.
- El flujo de Caja debe leer `image_url` junto con `label`, `denomination_type`, `value` y `display_order`.

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

## Reglas de Integridad
1. No hacer deletes fisicos en entidades con historial operativo.
2. Si se altera catalogo legacy, validar impacto en FK de `orders` y `order_items`.
3. Toda tabla nueva o cambio de acceso requiere revisar RLS/policies por sucursal.
4. Los archivos de `menu-node-images` deben quedar protegidos por policies de Storage alineadas con permisos administrativos por sucursal.
5. Si aparece error en insercion de items, revisar primero la correspondencia entre `menu_nodes.product` y `products`.


