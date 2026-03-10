# Codex Rules

## Objetivo
Mantener continuidad tecnica y funcional del POS entre sesiones/equipos sin perder decisiones de arquitectura.

## Reglas vigentes obligatorias

### 1) Refactor incremental, no rediseno total
- Reutilizar estructura existente antes de crear tablas o flujos nuevos.
- Evitar duplicidades funcionales (especialmente en permisos y catalogos).

### 2) Seguridad en backend/BD primero
- UI no define seguridad.
- Toda accion sensible debe respetar permisos efectivos en backend/BD.

### 3) Modificadores: estandar obligatorio
- Modificador es entidad estructurada, no texto concatenado.
- Asociacion por subcategoria en `subcategory_modifiers`.
- Seleccion por item en `order_item_modifiers`.
- Render por lineas debajo del producto en todos los modulos.

### 4) No borrar historico operativo por UI
- En entidades con posible historial, preferir baja logica (`is_active=false`).
- Caso aplicado: subcategorias.

### 5) `order_code` y codigos legibles
- Si hay error de duplicado por `uq_orders_order_code`, revisar/sincronizar contadores.
- Usar migracion de fix vigente antes de tocar app.

## Convenciones de implementacion para este proyecto

### Frontend
- Si cambia detalle de item (producto/modificadores/nota), actualizar de forma consistente:
  - ordenes
  - cocina
  - despacho
  - ticket
- Mantener alineacion visual coherente (modificadores debajo del nombre del producto).

### Backend/consultas
- Para descripciones de modificadores, leer via relacion a `modifiers(description)`.
- Filtrar descripciones vacias antes de renderizar.

### Admin
- En Modificadores, alta/edicion requiere categoria + subcategoria validas.
- Si categoria no tiene subcategorias activas, bloquear guardado con mensaje claro.

## Checklist corto antes de cerrar una tarea
1. `npx.cmd tsc --noEmit`
2. Probar flujo de orden end-to-end (mesa -> agregar item -> ver en vistas)
3. Verificar que no se rompa historial por deletes fisicos
4. Documentar migraciones nuevas en `docs/database_architecture.md`
5. Documentar impacto funcional en `docs/system_context.md`

## Estado base que debe preservarse
- Login con email o username funcional.
- Sucursal activa como contexto operativo.
- Permisos efectivos por modulo/sucursal.
- Modificadores por subcategoria con persistencia estructurada.
- Codigos legibles sin colisiones en creacion de ordenes.
