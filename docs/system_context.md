# System Context

## Resumen Ejecutivo
- Sistema POS multi-sucursal para restaurante en estado de refactor incremental (no greenfield).
- El acceso operativo sigue basado en permisos efectivos por modulo y sucursal activa.
- Roles existen como estructura administrativa y de plantilla; la operacion diaria se valida por permisos efectivos.
- `profiles.active_branch_id` sigue siendo pivote de sesion.

## Cambios Aplicados Hoy (2026-03-10)

### 1) Modificadores por subcategoria (BD + App)
- Se implemento el modelo de modificadores por subcategoria.
- Ya no se trata el modificador como texto concatenado al nombre del producto.
- Se agrega soporte de nota por item a nivel BD (`order_items.item_note`) para uso opcional.
- Migracion creada:
  - `supabase/migrations/20260310213000_subcategory_modifiers_and_item_notes.sql`

### 2) Flujo de ordenes con detalle estructurado
- Al agregar item, se guardan `modifier_ids` en `order_item_modifiers`.
- En UI, item y modificadores se muestran separados:
  - linea del producto
  - debajo, una linea por modificador
- Se aplico en:
  - Ordenes
  - Cocina
  - Despacho
  - Ticket/impresion

### 3) UX del popup de agregar item
- Modificaciones se seleccionan por checks (multi-seleccion), no por ingreso manual.
- La cantidad ahora permite:
  - boton `-`
  - boton `+`
  - ingreso manual numerico en el mismo popup
- Se removio la nota manual del popup en esta iteracion para evitar ingreso libre en ese punto.

### 4) Correcciones de datos de modificadores en vistas
- Se corrigio carga de descripciones de modificadores para evitar items con `-` vacio.
- Se estandarizo lectura desde relacion `order_item_modifiers -> modifiers(description)`.
- Se filtro cualquier descripcion vacia antes de renderizar.

### 5) Subcategorias: eliminacion segura
- En Admin > Subcategorias, la accion de eliminar pasa a desactivacion logica (`is_active=false`).
- Motivo: evitar romper historial y FKs con ordenes historicas.

### 6) Modulo Modificadores (Admin)
- Alta/edicion exige categoria + subcategoria.
- Si categoria no tiene subcategorias activas, se bloquea guardado.
- Se corrigio carga para que categoria/subcategoria aparezcan correctamente al editar.
- Se mantiene bloque "Asociacion por subcategoria" para asociaciones adicionales y orden visual.

### 7) Ordenes: colision de `order_code`
- Se detecto colision por contador desincronizado (`uq_orders_order_code`).
- Se creo fix para:
  - resincronizar contadores diarios por sucursal
  - endurecer generador para evitar colision en insercion
- Migracion creada:
  - `supabase/migrations/20260310223000_fix_order_code_generator_collision.sql`

## Proyecto Supabase remoto
- `apmsuigcveqtjzbpfihb`

## Checklist rapido para continuar en otro equipo
1. Verificar migraciones aplicadas en remoto (especialmente las dos de hoy).
2. Levantar app y validar:
   - crear orden desde mesas
   - agregar item con multiples modificadores
   - ver modificadores en Ordenes/Cocina/Despacho/Ticket
3. Validar Admin > Modificadores (alta/edicion con categoria+subcategoria).
4. Validar Admin > Subcategorias (baja logica, sin delete fisico).
5. Si aparece error de `order_code`, aplicar/confirmar migracion `20260310223000`.

### 8) Arbol de menu con navegacion drill-down
- Se implemento menu_nodes para reemplazar la estructura fija de 3 niveles.
- La navegacion en UI usa patron L1 (tabs) + L2 (chips) siempre visibles + breadcrumb desde L3+.
- Hook useMenuTree carga el arbol completo una vez y navega en memoria.
- Componente MenuNavigator integrado en el modulo de ordenes.
- Admin: MenuNodesCrud para gestion del arbol con baja logica.

