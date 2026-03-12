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
  - `icon`
  - `image_url`
  - `description`
  - `price`

### Modelo legacy que sigue vivo
- `categories`
- `subcategories`
- `products`

Este modelo legacy no ha sido eliminado porque el flujo operativo de ordenes sigue dependiendo de `products`.

## Regla Funcional del Arbol
- `parent_id IS NULL` identifica nodos raiz (Nivel 1).
- Los productos solo pueden existir desde Nivel 2 en adelante.
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
- `modifiers`: catalogo de modificadores.
- `subcategory_modifiers`: disponibilidad de modificadores por subcategoria.
- `order_item_modifiers`: seleccion real de modificadores por item.
- `order_items.item_note`: nota opcional por item.

## Consultas Correctas para Modificadores
- No leer descripcion desde `order_item_modifiers` como fuente principal.
- Leer descripcion desde `modifiers(description)` mediante join relacional.

## Migraciones Relevantes
- `supabase/migrations/20260310213000_subcategory_modifiers_and_item_notes.sql`
  - normalizacion de modificadores por subcategoria
  - columna `order_items.item_note`
- `supabase/migrations/20260310223000_fix_order_code_generator_collision.sql`
  - correccion de colisiones en `order_code`
- `supabase/migrations/20260312110000_add_menu_nodes_tree.sql`
  - tabla `menu_nodes`
  - trigger/calculo de profundidad
  - base inicial para navegacion del arbol

## Reglas de Integridad
1. No hacer deletes fisicos en entidades con historial operativo.
2. Si se altera catalogo legacy, validar impacto en FK de `orders` y `order_items`.
3. Toda tabla nueva o cambio de acceso requiere revisar RLS/policies por sucursal.
4. Si aparece error en insercion de items, revisar primero la correspondencia entre `menu_nodes.product` y `products`.
