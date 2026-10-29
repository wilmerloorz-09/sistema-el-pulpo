# Arquitectura del sistema — El Pulpo

Documento de referencia de la estructura del programa: stack, módulos de menú, permisos, base de datos, RPCs clave, flujos operativos y carpetas del código.

**Fecha de referencia:** 2026-10-28  
**Alcance:** estado actual del repositorio (incluye Gestión de Pescado fresco/cocido).

Documentación relacionada (más detalle histórico o técnico):

| Documento | Contenido |
|-----------|-----------|
| `docs/PROJECT_ARCHITECTURE.md` | Arquitectura funcional y evolución del flujo de órdenes |
| `docs/database_architecture.md` | Dominios SQL, reglas y migraciones relevantes |
| `docs/system_context.md` | Contexto operativo y decisiones de producto |
| `docs/operational-module-refresh.md` | Refresco Realtime entre módulos |
| `docs/codex_rules.md` | Reglas de trabajo del agente / convenciones |

---

## 1. Visión general

Sistema POS / operación de restaurante multi-sucursal para **El Pulpo**:

- Toma de pedidos (mesa, para llevar, express, extra, orden especial).
- Cocina / despacho / servir.
- Caja (cobro, arqueo, cierres).
- Inventario (bodega general, bodega sucursal, nevera).
- Gestión de pescado (fresco y cocido).
- Administración (usuarios, turnos, menú, reportes, monitoreo).

La **validación de negocio y permisos vive en PostgreSQL (RPCs + RLS)**. El frontend orquesta UI y llama a Supabase; no debe confiar solo en ocultar botones.

---

## 2. Stack técnico

| Capa | Tecnología |
|------|------------|
| Frontend | React + TypeScript + Vite + React Query + Tailwind / shadcn |
| Auth / BD / Realtime / Storage | Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions) |
| App móvil / tablet | Capacitor (Android) |
| Impresión térmica | Bridge TCP local (`scripts/thermal-print-bridge.mjs`) |
| Auxiliar (comprobantes) | `proof_capture_backend` (Python/FastAPI) — OCR / captura |
| Deploy frontend típico | rama `main` → producción |

**Estrategia de datos:** migración incremental hacia `menu_nodes` sin romper venta legacy sobre `products`.

---

## 3. Estructura de carpetas (frontend)

```
src/
  App.tsx                 # Rutas principales + ProtectedRoute
  pages/                  # Pantallas por módulo
  components/
    admin/                # CRUD admin, inventario, pescado, caja auxiliar…
    caja/                 # Cobro, listas, diálogos de pago
    order/                # Ítems, cancelaciones, edición
    dispatch/ kitchen/    # Despacho / cocina
    inventario/           # Shell de módulos inventario
    nav/                  # Menú lateral (useVisibleNavItems)
    reportes/ campanas/ clientes/ promociones/ autopedidos/
  contexts/               # AuthContext, BranchContext
  hooks/                  # useCaja, useOrder, useDispatchOrders…
  lib/                    # permisos, flujos de orden, utilidades
  integrations/supabase/  # Cliente Supabase
supabase/
  migrations/             # Fuente de verdad del esquema y RPCs
docs/                     # Documentación
temp/                     # Scripts locales de diagnóstico/aplicación (no productivos)
```

---

## 4. Módulos del menú (navegación)

Definidos en `src/components/nav/useVisibleNavItems.tsx` y renderizados en `SidebarNav`.

### 4.1 VENTA

| Ítem | Ruta | Notas |
|------|------|--------|
| Mesas | `/mesas` | Órdenes en mesa |
| Para llevar | `/para-llevar` | TAKEOUT |
| Express | `/express` | Flujo despacho → cobro |
| Extra | `/extra` | Solo en sucursales `CASH_THEN_DISPATCH` |
| Orden especial | `/orden-especial` | Especial / mixtas |
| Clientes | `/clientes` | CRM operativo |
| Comandas | `/ordenes` | Lista / edición de órdenes |

### 4.2 OPERATIVO

| Ítem | Ruta |
|------|------|
| Servir | `/servir` |
| Despacho | `/despacho` |
| Productos | `/productos` |
| Empaquetador | `/empaquetador` (oculto por flag) |

### 4.3 FINANZAS

| Ítem | Ruta |
|------|------|
| Recaudar / Pagos del turno | `/caja`, `/caja?tab=completed` |
| Cierres de caja | `/cierres-caja` |
| Cambio de monedas | `/cambio-monedas` (auxiliar) |

### 4.4 PROMOCIONES

Sección deshabilitada en menú (`SHOW_PROMOCIONES_NAV = false`); rutas existen (`/promociones`, `/campanas`).

### 4.5 INVENTARIO

| Ítem | Ruta | Tabs típicas |
|------|------|--------------|
| Bodega General | `/inventario/bodega-general` | Productos, Compra, Movimiento a sucursal, Historial |
| Bodega Sucursal | `/inventario/bodega-sucursal` | Productos, movimientos, historial |
| Nevera | `/inventario/nevera` | Productos / historial por sucursal |

### 4.6 GESTIÓN DE PESCADO

| Ítem | Ruta | Contenido |
|------|------|-----------|
| Pescado fresco | `/gestion-pescado/fresco` | Compra · Ajuste de cantidades · Historial |
| Pescado cocido | `/gestion-pescado/cocido` | Sucursales · Ingreso/salida · Movimientos · Historial |

Compatibilidad: `/inventario/gestion-pescado` → redirige a `/gestion-pescado/cocido`.

### 4.7 ADMINISTRACIÓN

| Ítem | Ruta |
|------|------|
| Reportes | `/reportes` |
| Turno | `/turno` |
| Forzar cierre de turno | `/forzar-cierre-turno` |
| Personal | `/personal` |
| Admin | `/admin` |
| Monitoreo global | `/monitoreo-global` |

---

## 5. Permisos y roles

### 5.1 Niveles

`NONE` < `VIEW` < `OPERATE` < `MANAGE`  
Helpers frontend: `canView` / `canOperate` / `canManage` (`src/lib/permissions.ts`).

### 5.2 Módulos de permiso (tabla `modules`)

Incluyen, entre otros:

- Operación: `mesas`, `ordenes`, `caja`, `despacho_mesa`, `despacho_para_llevar`, `despacho_total`
- Admin: `admin_sucursal`, `admin_global`, `sucursales`, reportes
- Inventario: `bodega_general`, `bodega_sucursal`, `inventario_movimientos`
- Pescado: `gestion_pescado`
- Otros: personal / jornadas, turno, etc. (según migraciones)

### 5.3 Dos capas de acceso

1. **Permisos efectivos** por usuario/rol/sucursal → `get_my_access_context` (y variantes).
2. **Gate de turno** → `get_my_branch_shift_gate` + flags en `cash_shift_users`  
   (`can_serve_tables`, `can_use_caja`, `can_pack_orders`, `can_serve_plates`, …).

Inventario y Gestión de Pescado pueden verse **sin turno abierto** si el usuario tiene permiso de módulo.

### 5.4 Roles base (ejemplos)

`administrador` (global), `supervisor`, `mesero`, `despachador*`, `cajero`, `bodeguero_general`, etc.  
Asignación: `user_branch_roles`, `user_global_roles`, `role_permissions`.

---

## 6. Base de datos — dominios principales

Motor: **PostgreSQL (Supabase)**. PKs UUID. Migraciones en `supabase/migrations/`.

### 6.1 Identidad y sucursales

| Tabla / concepto | Uso |
|------------------|-----|
| `profiles` | Usuario operativo (`username`, `alias`, sesión activa) |
| `branches` | Sucursales; `workflow_mode` (`CASH_THEN_DISPATCH` / `DISPATCH_THEN_CASH`) |
| `user_branches`, `user_branch_roles`, `user_branch_modules` | Acceso |
| `modules`, `roles`, `role_permissions` | Catálogo de permisos |

### 6.2 Catálogo / menú

| Tabla | Uso |
|-------|-----|
| `menu_nodes` | Árbol visual POS (TABLE / TAKEOUT / BULK) |
| `menu_node_modifiers`, `modifiers` | Modificadores |
| `products`, `categories`, `subcategories` | Legacy transaccional (FK de `order_items.product_id`) |
| `extra_frequent_products` | Productos frecuentes |

### 6.3 Órdenes y mesas

| Tabla | Uso |
|-------|-----|
| `orders` | Cabecera (`order_code`, `order_number`, estado, tipo, turno) |
| `order_items`, `order_item_modifiers` | Líneas |
| `order_*_events` / cancelaciones | Despacho, listo, anulaciones |
| `restaurant_tables` | Mesas físicas |

**Estados canónicos de orden (resumen):**

| Estado | Significado operativo |
|--------|------------------------|
| `DRAFT` | Borrador con ítems, aún no enviado a caja/cola |
| `SENT_TO_KITCHEN` | En caja / lista para flujo según modo |
| `PAID` | Pagada (terminal salvo anulación) |
| `KITCHEN_DISPATCHED` | Despachada |
| `CANCELLED` | Anulada / cerrada por void |

Tipos: `DINE_IN` / mesa, `TAKEOUT`, `EXPRESS`, `EXTRA`, especial (`is_special`).

### 6.4 Caja y pagos

| Tabla | Uso |
|-------|-----|
| `cash_shifts`, `cash_shift_users` | Turno y capacidades |
| `cash_register_openings`, `cash_shift_denoms` | Apertura y denominaciones por cajero |
| `payments`, `payment_items` | Cobros |
| `payment_void_requests` | Anulaciones |
| `bancos`, comprobantes / proofs | Transferencias |

### 6.5 Inventario de productos

| Tabla | Uso |
|-------|-----|
| `productos_globales` | Catálogo global |
| `inventario_bodega_general`, `movimientos_bodega_general` | Stock central |
| `compras_bodega_general` (+ detalle) | Compras a proveedor |
| Inventario sucursal / nevera | Stock por sucursal y movimientos |
| `proveedores` | Proveedores de compra |

### 6.6 Pescado cocido (`gestion_pescado`)

Stock **separado** del inventario de productos; unidad principal: **libras**.

| Tabla | Uso |
|-------|-----|
| `pescado_stock_central` | Stock cocido en bodega general |
| `pescado_stock_sucursal` | Stock cocido por sucursal |
| `pescado_ingresos` / `pescado_salidas` | Ingreso/salida |
| `pescado_traslados` | Movimientos entre ubicaciones |
| `pescado_movimientos` | Historial contable |

Orígenes de ingreso: `PREPARACION_INICIAL`, `PREPARACION_EXTRA`, `OTROS`.  
En preparación inicial/extra se registran `bonito_lb` / `albacora_lb` y se descuenta fresco.

### 6.7 Pescado fresco

| Tabla | Uso |
|-------|-----|
| `pescado_fresco_productos` | Catálogo (Bonito, Albacora) |
| `pescado_fresco_stock` | Stock en lb |
| `pescado_fresco_compras` (+ detalle) | Compra con proveedor / factura |
| `pescado_fresco_movimientos` | COMPRA / INGRESO / SALIDA / AJUSTE |

### 6.8 Otros dominios

Clientes, campañas/promociones, personal/jornadas, tokens QR de mesa (`tokens_qr_mesas`), caja auxiliar, etc.

---

## 7. RPCs / funciones clave (muestra)

La lista completa evoluciona con migraciones; estas son las más usadas por área.

### Órdenes / cocina

- `submit_order_draft_items` — enviar borrador  
- `add_dine_in_order_item` / `add_tray_order_item` / `set_draft_order_item_quantity`  
- `dispatch_order_quantities` — despachar  
- `cancel_order_quantities` — anular / reducir (incluye edición de orden)  
- `get_order_operational_snapshot`  
- `get_dispatch_servir_queue_bundle` — cola Despacho/Servir  
- `get_caja_payable_queue_bundle` — cola cobrable  

### Caja / turno

- `open_cash_shift_with_tables` / `open_cash_register` / `close_cash_register`  
- `register_payment_with_items` — cobro atómico  
- `force_close_cash_shift`  
- `get_my_branch_shift_gate` / `get_my_access_context`  

### Inventario productos

- `registrar_compra_bodega_general`  
- `registrar_movimiento_bodega_general`  
- Traslados bodega general → sucursal / nevera  

### Pescado

- `listar_stock_pescado` / `listar_stock_pescado_fresco`  
- `registrar_ingreso_pescado` — cocido; con `p_bonito_lb` / `p_albacora_lb` descuenta fresco  
- `registrar_salida_pescado` / `trasladar_pescado`  
- `registrar_compra_pescado_fresco` / `registrar_movimiento_pescado_fresco`  

---

## 8. Flujos operativos resumidos

### 8.1 Pedido → cobro → despacho

Depende de `branches.workflow_mode`:

- **Caja primero (`CASH_THEN_DISPATCH`):** borrador → enviar → Recaudar → Despacho/Servir.  
- **Despacho primero (`DISPATCH_THEN_CASH`):** cocina puede avanzar antes del cobro; Express típico despacho → caja.

### 8.2 Turno de caja

Abrir turno (mesas activas + usuarios/capacidades) → cada cajero abre su caja → cobros → cierre / aprobación de cierres → opcional forzar cierre.

### 8.3 Inventario productos

Compra en Bodega General → stock central → movimiento a sucursal / nevera → descuento por venta (waterfall nevera/bodega según reglas).

### 8.4 Pescado fresco → cocido

1. **Fresco:** compra (Bonito/Albacora) o ajuste → stock fresco.  
2. **Cocido – Ingreso** (preparación inicial/extra):  
   - Captura crudo Bonito + Albacora (lb).  
   - Valida stock fresco.  
   - Exige **(Bonito + Albacora) > peso entregado**.  
   - Descuenta fresco y aumenta stock cocido central (peso total = verificado − bandejas).  
3. **Movimientos:** traslados central ↔ sucursales.  

---

## 9. Capas del frontend (contexto)

| Pieza | Responsabilidad |
|-------|-----------------|
| `AuthContext` | Sesión Supabase, perfil, sesión única/doble |
| `BranchContext` | Sucursal activa, permisos, admin global |
| `ProtectedRoute` | Módulos, turno, roles de shift, restricciones temporales |
| React Query | Cache de colas, catálogos, inventarios |
| Realtime hub | Invalidación entre Caja / Despacho / Servir / Órdenes |

---

## 10. Clientes adicionales

| Superficie | Descripción |
|------------|-------------|
| App web / PWA | Operación principal |
| APK Android (Capacitor) | Tablets en sucursal |
| Autopedido QR | Cliente anónimo en mesa (`/qr…`, tokens) |
| Pedidos Express (staff) | Flujo express interno |

---

## 11. Convenciones importantes

1. **Permisos en BD:** la UI puede ocultar; la RPC es la autoridad.  
2. **Alias operativo:** en operación se muestra `profiles.alias` (no nombre legal).  
3. **Un orden visible en Despacho** = una tarjeta por `orders.id` / `order_code`.  
4. **`PAID` es terminal** salvo anulación explícita de pago.  
5. **Pescado ≠ inventario de productos:** tablas y stock independientes.  
6. **Migraciones:** cambios de esquema/RPC van en `supabase/migrations/` y se aplican al remoto; el frontend se despliega vía `main`.

---

## 12. Mapa rápido “dónde tocar qué”

| Quiero cambiar… | Empieza en… |
|-----------------|-------------|
| Ítems del menú lateral | `src/components/nav/useVisibleNavItems.tsx` |
| Rutas | `src/App.tsx` |
| Pantalla de un módulo | `src/pages/…` + `src/components/…` |
| Regla de negocio / stock | `supabase/migrations/*.sql` (RPC) |
| Permiso de módulo | tablas `modules` / `role_permissions` + `get_my_access_context` |
| Flujo caja vs despacho | `branches.workflow_mode` + `src/lib/orderFlow.ts` |
| Compra fresco | `CompraPescadoFrescoAdmin` + `registrar_compra_pescado_fresco` |
| Ingreso cocido + crudo | `GestionPescadoAdmin` + `registrar_ingreso_pescado` |

---

*Documento generado como mapa estructural. Para detalle fino de migraciones o reglas históricas, consultar `database_architecture.md` y `PROJECT_ARCHITECTURE.md`.*
