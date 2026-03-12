# Database Architecture

## Resumen
- BD en PostgreSQL (Supabase).
- UUID se mantiene como PK tecnica.
- Se usan codigos legibles para operacion donde aplica (`order_code`, etc.).

## Estructura relevante para cambios de hoy

### Modificadores
- `modifiers`
  - catalogo de modificadores por sucursal.
- `subcategory_modifiers` (nuevo uso activo)
  - relacion subcategoria <-> modificador
  - soporta `is_active` y `display_order`
- `order_item_modifiers`
  - seleccion real de modificadores por item de orden
- `order_items.item_note`
  - nota opcional por item (columna agregada para soporte de detalle)

### Catalogo de menu
- `categories` (por sucursal)
- `subcategories` (relacionadas a categoria)
- `products` (relacionados a subcategoria)

## Migraciones creadas hoy

### 1) Modificadores por subcategoria + item_note
- `supabase/migrations/20260310213000_subcategory_modifiers_and_item_notes.sql`
- Incluye:
  - creacion/normalizacion de `subcategory_modifiers`
  - RLS/policies para esta tabla
  - `ALTER TABLE order_items ADD COLUMN item_note`
  - backfill base de asociaciones

### 2) Fix colisiones de `order_code`
- `supabase/migrations/20260310223000_fix_order_code_generator_collision.sql`
- Incluye:
  - resincronizacion de `entity_counters` para `orders_daily`
  - `generate_order_code()` robusto con reintento ante colision

## Regla de integridad aplicada
- No eliminar fisicamente subcategorias que pueden tener historial de ordenes asociado.
- En app se implemento desactivacion logica para subcategorias.

## Consultas/joins recomendados para modificadores
- No consultar `order_item_modifiers.description` (no es fuente valida en el modelo actual).
- Consultar descripcion desde `modifiers` via join relacional:
  - `order_item_modifiers(order_item_id, modifier_id)` + `modifiers(description)`

## RLS y seguridad
- Mantener validaciones por sucursal activa y permisos efectivos.
- No confiar en filtro solo frontend.
- Para nuevas tablas o cambios de acceso, agregar policies explicitas y probar con usuario no admin.

## Verificaciones recomendadas post-migracion
1. Crear orden y agregar item con multiples modificadores.
2. Confirmar persistencia en `order_item_modifiers`.
3. Confirmar visualizacion en Ordenes/Cocina/Despacho/Ticket.
4. Crear orden desde mesas y validar ausencia de colision `uq_orders_order_code`.
5. Desactivar subcategoria desde Admin y verificar que no haya error FK por historial.

### Arbol de menu - menu_nodes
- Tabla menu_nodes: arbol recursivo de profundidad indefinida.
- parent_id = NULL -> nodo raiz (L1).
- node_type: category | product.
- depth calculado por trigger trg_menu_node_depth.
- Migracion: 20260312110000_add_menu_nodes_tree.sql.
- Tablas originales categories, subcategories, products conservadas como respaldo.

