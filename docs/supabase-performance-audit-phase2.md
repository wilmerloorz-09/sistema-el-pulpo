# Auditoría de rendimiento Supabase — Fase 2

Fecha: 2026-07-30  
Alcance: optimización de Egress / consultas / Realtime / renders **sin cambios funcionales** (misma lógica de negocio, permisos, estados, UX).

---

## Resumen ejecutivo

La Fase 1 centralizó parte de la estrategia (`queryEgress.ts`), subió `staleTime`, redujo polls y unificó Realtime operativo.  
La Fase 2 lleva el sistema a un régimen **casi óptimo** con:

1. **Polling adaptativo** ligado al estado `SUBSCRIBED` del hub Realtime.
2. **Query keys centralizadas** (`src/lib/queryKeys.ts`).
3. **Contexts memoizados** (Auth, Branch, Network) para menos re-renders.
4. **Invalidaciones** unificadas vía `invalidateOperationalOrderQueries` en anulaciones.
5. **Payload** más estrecho en admin (cuentas bancarias, menu nodes).
6. **Realtime**: filtro `cash_shift_users` por `shift_id` cuando hay turno; cierre limpio; polls de respaldo solo si el canal cae.

---

## Cambios realizados

### 1. Hub Realtime + polling adaptativo (`src/lib/queryEgress.ts`)

| Pieza | Detalle |
|--------|---------|
| Estado del hub | `idle` / `connecting` / `subscribed` / `error` / `closed` |
| API | `getHubRealtimeStatus`, `useHubRealtimeStatus`, `useAdaptiveRefetchInterval` |
| Regla | `SUBSCRIBED` → `refetchInterval: false`; si no → poll de respaldo |
| `cash_shift_users` | Filtro `shift_id=eq.{shiftId}` cuando el hub conoce el turno |

### 2. Polling eliminado / adaptado

| Antes | Después | Archivo |
|--------|----------|---------|
| Gate siempre cada 5 min | Solo si hub ≠ SUBSCRIBED | `useBranchShiftGate.ts` |
| `current-shift` cada 60 s | Solo si hub ≠ SUBSCRIBED | `useCaja.ts` |
| Reportes remotos cada 5 min | Solo si hub ≠ SUBSCRIBED | `useReportesData.ts` |
| Mesero ready alerts cada 60 s siempre | Poll solo si Realtime no SUBSCRIBED | `useMeseroOrderReadyNotification.tsx` |
| Monitoreo Global backup 5 min siempre | Backup solo si canal no SUBSCRIBED | `MonitoreoGlobal.tsx` |
| Network HEAD cada 60 s | HEAD cada **3 min** | `NetworkContext.tsx` |

**Justificación de los polls que quedan (adaptativos):**

- **Gate / current-shift**: el hub cubre turnos/órdenes/pagos; el poll es red de seguridad si Realtime falla o la migración no está aplicada.
- **Reportes remotos**: la pantalla no tiene canal propio; reutiliza el estado del hub de la app (gate montado en layout).
- **Mesero / Monitoreo**: canales dedicados; mismo patrón adaptativo local.

### 3. Invalidaciones optimizadas

- `invalidateOperationalOrderQueries` ahora usa `qk.*` y opcional `includeAutopedidos`.
- `useCancellation.ts`: bloques repetidos de 4–6 `invalidateQueries` → helper único (mantiene `setQueryData` optimista + `refetchQueries` de `orders` donde ya existía para UX).
- Se evita invalidar catálogos en mutaciones operativas.

### 4. Query Keys

Nuevo archivo: `src/lib/queryKeys.ts` (`qk`, `OPERATIONAL_ORDER_LIST_KEYS`).

Consumidores actualizados parcialmente (gate, caja, reportes, cancellation). El resto puede migrar de forma incremental sin romper invalidaciones por prefijo string.

### 5. Payload reducido

| Ubicación | Cambio |
|-----------|--------|
| `CuentasBancariasDestinoAdmin` | Columnas explícitas (sin `*`) |
| `MenuNodesCrud` listado | Columnas de `menu_nodes` explícitas |
| `MenuNodesCrud` insert return | `.select("id")` en lugar de `*` |
| CloneBranchCatalog | Se deja `*` (copia one-shot admin; coste bajo vs riesgo de omitir columnas) |

Las rutas operativas de Caja/Despacho ya usaban SELECT estrechos desde Fase 1.

### 6. Realtime

- Un canal operativo por sucursal: `branch-ops-hub:{branchId}` (confirmado).
- Canales **justificados** fuera del hub:
  - `mesero-ready-alerts:{branch}:{user}` — alertas de mesero.
  - `kitchen-notifications:{uuid}` — banner cocina (nombre único por montaje; cleanup en unmount).
  - `global-monitor:...` — admin multi-sucursal.
- Cleanup: `removeChannel` en todos los paths revisados.
- Hub: `removeChannel` al vaciar consumidores; status → `idle`.

### 7. Context Providers

- `AuthContext`: `useMemo` del value; `signIn` en `useCallback`.
- `BranchContext`: `useMemo` del value; `setActiveBranch` en `useCallback`; `allowedModules` memoizado.
- `NetworkContext`: value memoizado; ping menos frecuente.

### 8. RPC (auditoría — sin cambio de contrato)

| RPC | Hallazgo | Acción Fase 2 |
|-----|----------|----------------|
| `get_orders_operational_snapshots_lite` | Preferida en cliente (Fase 1) | Mantener; requiere migración remota |
| `get_orders_operational_snapshots` / unitaria | Fallback | Sin cambio |
| `get_my_branch_shift_gate` | Una lectura por gate; poll adaptativo | Menos llamadas con Realtime OK |
| `get_my_access_context` | BranchContext al login / cambio sucursal | Sin cambio (correcto) |
| `list_cash_register_movements` | Por turno, on demand | Sin cambio |
| `listar_autopedidos_pendientes` | Via hub Realtime | Sin poll |
| `get_mesero_ready_alerts` | Solo en INSERT Realtime + backup adaptativo | Menos polls |

No se alteraron firmas SQL ni RLS.

---

## Archivos modificados

- `src/lib/queryEgress.ts` (hub status + adaptive poll + filtro shift users)
- `src/lib/queryKeys.ts` (**nuevo**)
- `src/hooks/useBranchShiftGate.ts`
- `src/hooks/useCaja.ts`
- `src/hooks/useReportesData.ts`
- `src/hooks/useCancellation.ts`
- `src/hooks/useMeseroOrderReadyNotification.tsx`
- `src/hooks/useKitchenNotifications.tsx`
- `src/pages/MonitoreoGlobal.tsx`
- `src/contexts/AuthContext.tsx`
- `src/contexts/BranchContext.tsx`
- `src/contexts/NetworkContext.tsx`
- `src/components/admin/CuentasBancariasDestinoAdmin.tsx`
- `src/components/admin/MenuNodesCrud.tsx`
- `docs/supabase-performance-audit-phase2.md` (este documento)

---

## Estimación de ahorro de Egress

Escenario: **8 tablets** × turno de **12 h**, sucursal activa con hub SUBSCRIBED.

| Concepto | Antes (aprox.) | Después | Ahorro relativo |
|----------|----------------|---------|-----------------|
| Gate poll 5 min | ~96 reads/tablet/día | ~0 si RT OK | ~100 % de ese poll |
| current-shift 60 s | ~720 reads/tablet/día | ~0 si RT OK | ~100 % de ese poll |
| Reportes 5 min (si abierta) | ~144 reads | ~0 si RT OK | alto en esa pantalla |
| Mesero alerts 60 s | ~720 RPC/tablet | ~0 si RT OK | alto |
| Network HEAD 60 s | ~720 HEAD/tablet | ~240 HEAD | ~67 % |
| Invalidaciones cancelación | 4–6 keys sueltas | helper (mismas keys operativas, menos código inconsistente) | menor/mediano en refetch accidental |

**Orden de magnitud global Fase 1+2:** respecto al baseline previo a Fase 1 (~15 GB/mes reportado), es razonable esperar **40–70 %** menos Egress operativo en horario pico si la migración Realtime (`20260730230000`) está aplicada y los hubs permanecen `SUBSCRIBED`. La banda depende del tráfico de cobros/despachos (invalidaciones legítimas) y de admin (clonado de catálogo).

---

## Riesgos encontrados

1. **Migración `20260730230000` no aplicada** → filtro `order_items.sucursal_id` y publicación de turnos fallan; el poll adaptativo se mantiene activo (comportamiento seguro, más Egress).
2. **`order_ready_events` / `order_dispatch_events` sin `sucursal_id`** → el hub sigue recibiendo eventos globales de esas tablas (ruido entre sucursales). Mitigación futura: denormalizar sucursal (como `order_items`) sin cambiar UX.
3. **`setQueryData` agresivo** en listas grandes no se generalizó: riesgo de desync UX; se priorizó invalidación acotada + cache optimista solo donde ya existía (anulaciones).
4. **Reportes remotos** dejan de refrescarse solos mientras el hub esté SUBSCRIBED: al abrir la pantalla, `staleTime` 60 s + focus defaults siguen aplicando; si se necesita frescura al entrar, `refetchOnMount` ya es el default de RQ cuando stale.
5. **CloneBranchCatalog** conserva `select("*")` a propósito (one-shot).

---

### Follow-up post-auditoría (mismo día)

Aplicado tras hallazgos de invalidaciones amplias residuales:

- Eliminado poll diferido 2.5 s post-despacho (`useDispatchOrders`) y invalidaciones a cocina/caja/reportes en ese hot path (hub Realtime).
- Cocina “listo”: solo `kitchen-orders` + `dispatch-orders`.
- Autopedidos aprobar/rechazar: sin `orders`/`dispatch-orders` forzados.
- Extra/Express/Para llevar/Orden especial/Bandeja/Merge-split: invalidación acotada a la pantalla + mesas cuando aplica.
- Enviar a cocina: quitados `completed-payments` / `reportes-pagos`.
- Auth: `SINGLE_SESSION_CHECK_INTERVAL_MS` usa `AUTH_SESSION_POLL_MS`.

Archivos adicionales: `useDispatchOrders.ts`, `useKitchenOrders.ts`, `useAutopedidosQrPendientes.ts`, `useTrayOrder.ts`, `Extra.tsx`, `Express.tsx`, `ParaLlevar.tsx`, `OrdenEspecial.tsx`, `useOrder.ts`, `MergeSplitOrdersDialog.tsx`, `AuthContext.tsx`.

---

## Criterio de detención

Mejoras residuales significativas **sin tocar negocio** quedan limitadas a:

- Denormalizar `sucursal_id` en eventos ready/dispatch (migración).
- Migrar el resto de literales de query keys a `qk.*`.
- RPC batch más delgadas solo si el dashboard de Egress sigue mostrando hotspots concretos.

Con Realtime sano y migración aplicada, el perfil de consumo es **prácticamente óptimo** para un POS multi-tablet.

---

## Checklist de verificación manual

- [ ] Aplicar `20260730230000_realtime_turnos_y_snapshots_lite.sql` en remoto.
- [ ] Abrir Caja / Mesas / Despacho: un solo canal `branch-ops-hub:{id}` en Network/Realtime.
- [ ] Cortar red o forzar CHANNEL_ERROR: deben reaparecer polls lentos; al reconectar, deben parar.
- [ ] Cobrar / despachar / anular: pantallas hermanas se actualizan igual que antes.
- [ ] Login / cambio de sucursal / Monitoreo Global / alertas mesero: sin regresiones UX.
