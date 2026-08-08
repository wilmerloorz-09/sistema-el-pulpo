# Refresco entre módulos operativos

Fecha: 2026-08-07  
Alcance: latencia de actualización entre Despacho, Servir, Recaudar/Caja, Cocina, Mesas, Órdenes, Extra/Express/Para llevar/Especial.

---

## Problema que se resolvió

Con Realtime-first (Fase 1–2), si el hub no estaba `SUBSCRIBED` o un dispositivo perdía eventos, algunas pantallas quedaban minutos desfasadas respecto a otras. Unos tablets sí veían el cambio y otros no.

## Estrategia vigente (Fase 1.5 — latencia)

| Capa | Comportamiento |
|------|----------------|
| Hub Realtime | Canal compartido `branch-ops-hub:{branchId}` (`src/lib/queryEgress.ts`). |
| Poll si hub cae | `OPERATIONAL_LIST_BACKUP_POLL_MS = 15_000` cuando hub ≠ `SUBSCRIBED`. |
| Safety con hub sano | `OPERATIONAL_LIST_SAFETY_POLL_MS = 15_000` aunque esté `SUBSCRIBED` (recupera eventos perdidos en tablet/PWA). |
| Foco / red | Listas operativas con `refetchOnWindowFocus: true` y `refetchOnReconnect: true` (overrides locales; el default global en `App.tsx` sigue en `false`). |
| Invalidaciones | Tras cocina → servir/caja; tras `sendToKitchen` → servir; helper `invalidateOperationalOrderQueries`. |
| Indicador UI | Badge **Sync lenta** en `AppLayout` cuando el hub no está suscrito. |

### Visibilidad y lecturas (2026-08-07)

- Las listas de Caja/Despacho/Servir filtran por turno abierto. Una orden activa **sin** `cash_shift_id` puede quedar invisible aunque el Realtime/poll funcionen.
- Trigger `assign_open_cash_shift_to_order` + RPC `repair_open_shift_order_cash_shift_ids` (migración `20260807121000`).
- Cliente: `repairOpenShiftOrderCashShiftIds` (throttle 60s **solo tras éxito**) al refrescar Despacho/Servir/Recaudar/**Cocina**/Órdenes.
- Lecturas de listas operativas usan `dbSelectStrict` (sin fallback Dexie que vacíe la UI ante fallo de red), también en Cocina y `useOrdersByStatus`.
- Recaudar (Despacho primero): **no** ocultar órdenes con `ready_to_collect=false`; se muestran con botón Cobrar rojo (`PayableOrdersList`).
- **Gate de turno:** si `get_my_branch_shift_gate` hace timeout/falla, `useBranchShiftGate` **re-lanza** el error (no devuelve `shiftId: null`). Con `keepPreviousData` se conserva el último gate válido y no se vacían las listas por cambio de query key.

### Constantes (`src/lib/queryEgress.ts`)

| Constante | Valor | Uso |
|-----------|-------|-----|
| `OPERATIONAL_STALE_MS` | 15 s | staleTime de listas |
| `OPERATIONAL_LIST_BACKUP_POLL_MS` | 15 s | poll si hub ≠ SUBSCRIBED |
| `OPERATIONAL_LIST_SAFETY_POLL_MS` | 15 s | safety poll aunque hub = SUBSCRIBED |
| `OPERATIONAL_BACKUP_POLL_MS` | 60 s | turno/caja si hub cae |
| `SHIFT_GATE_BACKUP_POLL_MS` | 5 min | gate de turno |
| `MONITOR_BACKUP_POLL_MS` | 5 min | Monitoreo Global |

### Pantallas que usan el poll adaptativo de listas

- Despacho (`useDispatchOrders`)
- Cocina (`useKitchenOrders`)
- Caja / Recaudar (`useCaja`)
- Órdenes por estado (`useOrdersByStatus`)
- Mesas (`useTablesWithStatus`)
- Extra / Express / Para llevar / Orden especial

API: `useAdaptiveRefetchInterval(OPERATIONAL_LIST_BACKUP_POLL_MS)` + `useOperationalOrdersRealtime` / `useHubRealtimeStatus`.

## Requisitos en remoto

1. Migración `20260730230000_realtime_turnos_y_snapshots_lite.sql` aplicada (Realtime de turnos/pagos/despacho/`order_items`, columna `order_items.sucursal_id`, RPC lite de snapshots).
2. Sin esa migración el hub puede no suscribirse bien → el poll de 15 s permanece activo (seguro, más Egress).

## Qué **no** sustituye el plan Free→Pro de Supabase

Subir de Free a Pro ayuda con límites de Realtime/conexiones, pero **no** reemplaza esta Fase 1.5: el poll adaptativo + invalidaciones locales siguen siendo necesarios cuando el canal cae o un dispositivo pierde eventos.

## Fases pendientes (no implementadas)

- **Fase 2+ residual:** denormalizar `sucursal_id` en `order_ready_events` / más eventos.
- **Fase 3 (idea):** sync por versión / snapshots más agresivos para menos Egress.

Ver también: `docs/supabase-performance-audit-phase2.md`.
