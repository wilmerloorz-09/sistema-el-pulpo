# Project Architecture

## Arquitectura Vigente (Resumen)
- Frontend: React + TypeScript.
- Backend: Supabase (PostgreSQL, RLS, RPC, Edge Functions).
- Dominio clave: multi-sucursal con control operativo por permisos efectivos.

## Capas funcionales

### Identidad y sesion
- Auth Supabase + perfil en `profiles`.
- Login por email o username via Edge Function `login-with-identifier`.
- Sucursal activa de sesion: `profiles.active_branch_id`.

### Autorizacion
- Base de autorizacion: permisos efectivos por modulo + nivel de acceso.
- Roles usados para estructura y plantillas administrativas.
- Validacion final siempre en backend/BD.

### Operacion de ordenes
- Orden -> items -> modificadores.
- Modificadores guardados estructurados en `order_item_modifiers`.
- Render de modificadores separado del nombre del producto en todas las vistas operativas.

## Cambios de arquitectura aplicados hoy

### A) Modificadores por subcategoria
- Se incorporo asociacion formal subcategoria <-> modificador.
- El catalogo de modificadores ya no se trata como texto libre por producto.
- El selector de modificadores en `AddItemDialog` ahora es check multi-seleccion.

### B) Consistencia cross-modulo para detalle de item
- Se estandarizo lectura de modificadores usando join relacional a `modifiers(description)`.
- Se corrigio render de vacios y se unifico alineacion visual (modificadores bajo nombre de producto) en:
  - cards de orden
  - panel de detalle
  - cocina
  - despacho
  - ticket termico

### C) Administracion de catalogo
- `SubcategoriesCrud`: delete fisico reemplazado por desactivacion logica.
- `ModifiersCrud`: alta/edicion con categoria y subcategoria obligatorias, bloqueo si no hay subcategorias activas.

### D) Codigos legibles operativos
- Se mantiene estrategia UUID interno + codigo visible humano.
- Para ordenes, se agrego fix de colision de `order_code` con resincronizacion de contadores.

## Componentes/hook impactados hoy
- `src/components/order/AddItemDialog.tsx`
- `src/components/order/OrderItemsList.tsx`
- `src/components/order/OrderCardBase.tsx`
- `src/components/order/OrderDetailPanel.tsx`
- `src/components/order/ThermalReceipt.tsx`
- `src/components/kitchen/KitchenCard.tsx`
- `src/components/dispatch/DispatchCardBase.tsx`
- `src/components/admin/ModifiersCrud.tsx`
- `src/components/admin/SubcategoryModifiersCrud.tsx`
- `src/components/admin/SubcategoriesCrud.tsx`
- `src/hooks/useMenuData.ts`
- `src/hooks/useOrder.ts`
- `src/hooks/useOrdersByStatus.ts`
- `src/hooks/useKitchenOrders.ts`
- `src/hooks/useDispatchOrders.ts`
- `src/pages/Ordenes.tsx`
- `src/pages/Admin.tsx`

## Migraciones nuevas relevantes
- `20260310213000_subcategory_modifiers_and_item_notes.sql`
- `20260310223000_fix_order_code_generator_collision.sql`

## Riesgos/atencion para siguientes tareas
1. No volver a cargar modificadores desde columnas inexistentes en `order_item_modifiers`.
2. Mantener baja logica en entidades con historial operativo.
3. Cualquier cambio de generacion de codigos debe validar concurrencia + indice unico.
4. Mantener coherencia visual del detalle de item en todos los modulos (evitar divergencias por componente).
