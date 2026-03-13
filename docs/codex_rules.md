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

## Convenciones de Implementacion

### Frontend
- Si cambia la navegacion del catalogo o el detalle de item, revisar consistencia en:
  - Ordenes
  - Cocina
  - Despacho
  - Ticket
- Distinguir visualmente categoria vs producto; una categoria no debe mostrarse como item vendible con precio.

### Admin
- `Arbol Menu` es la via principal para altas, ediciones, reordenamiento y bajas logicas del catalogo; no debe reintroducirse una pestana visible de `Productos` como superficie principal.
- `image_url` es la representacion visual principal del nodo y debe llenarse desde la subida de archivo a Storage.
- El campo `icon` ya no debe exponerse en `Admin > Arbol Menu`; si persiste en BD, tratarlo solo como remanente legacy.
- La pestana `Modificadores` solo administra el catalogo base; la asignacion a nodos debe hacerse en `Arbol Menu`.

### Backend y consultas
- Para modificadores, leer descripciones desde la relacion con `modifiers`.
- La disponibilidad operativa del modificador debe resolverse desde `menu_node_modifiers`.
- Filtrar datos vacios o inconsistentes antes de renderizar.

## Checklist Minimo Antes de Cerrar una Tarea
1. `npx.cmd tsc --noEmit`
2. Probar alta/edicion relevante en `Admin > Arbol Menu` si el cambio toca catalogo
3. Probar flujo de orden si el cambio toca seleccion de productos
4. Documentar impacto en:
   - `docs/system_context.md`
   - `docs/PROJECT_ARCHITECTURE.md`
   - `docs/database_architecture.md`
   - `docs/codex_rules.md`

## Estado Base que Debe Mantenerse
- Login con email o username.
- Sucursal activa como contexto operativo.
- Permisos efectivos por modulo/sucursal.
- Modificadores estructurados por nodo e item.
- Navegacion del menu basada en arbol, con Nivel 1 como unica obligatoriedad.
