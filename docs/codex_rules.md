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

### 8) Snapshot operativo compartido
- Si una pantalla clasifica estados de orden (`Enviada`, `Lista`, `Despachada`, `Por cobrar`), preferir snapshot operativo compartido sobre lecturas parciales.
- No reconstruir reglas operativas criticas desde una sola tabla si ya existe un snapshot consolidado.

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
- En movil, evitar tablas comprimidas o filas montadas; preferir tarjetas apiladas o layouts de una sola responsabilidad visual.
- No forzar layouts desktop partidos en ancho insuficiente; si una pantalla no cabe bien en dos columnas, degradar a una sola columna estable.

### Admin
- `Arbol Menu` es la via principal para altas, ediciones, reordenamiento y bajas logicas del catalogo; no debe reintroducirse una pestana visible de `Productos` como superficie principal.
- `image_url` es la representacion visual principal del nodo y debe llenarse desde la subida de archivo a Storage.
- El campo `icon` ya no debe exponerse en `Admin > Arbol Menu`; si persiste en BD, tratarlo solo como remanente legacy.
- La pestana `Modificadores` solo administra el catalogo base; la asignacion a nodos debe hacerse en `Arbol Menu`.
- `AdminTable` debe seguir siendo la base para listados administrativos y en movil debe mostrarse como tarjetas, no como tabla apretada.

### Backend y consultas
- Para modificadores, leer descripciones desde la relacion con `modifiers`.
- La disponibilidad operativa del modificador debe resolverse desde `menu_node_modifiers`.
- Filtrar datos vacios o inconsistentes antes de renderizar.
- Si se toca Ordenes o Despacho, revisar tambien:
  - RLS de tablas de eventos operativos
  - reflejo en vivo entre usuarios/sesiones
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
