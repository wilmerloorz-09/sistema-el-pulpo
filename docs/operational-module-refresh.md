# Refresco entre módulos operativos

Fecha: 2026-08-10  
Alcance: latencia de actualización entre Despacho, Servir, Recaudar/Caja, Cocina, Mesas, Órdenes, Extra/Express/Para llevar/Especial; visibilidad tras cerrar/abrir turno; cola bundle Despacho/Servir.

---

## Problema que se resolvió

Con Realtime-first (Fase 1–2), si el hub no estaba `SUBSCRIBED` o un dispositivo perdía eventos, algunas pantallas quedaban minutos desfasadas respecto a otras. Unos tablets sí veían el cambio y otros no.

En ago 10 se corrigieron además:

1. **Cola vacía tras cerrar/abrir turno** — prefetch del bundle vacío + dedupe de React Query envenenaba Despacho/Servir; órdenes con `cash_shift_id` del turno `CLOSED` quedaban invisibles.
2. **Platos en Despacho con Servir activo** — catálogo PLATOS vacío cacheado 30 min impedía separar módulos.

## Estrategia vigente (Fase 1.5 + hardening ago 10)

| Capa | Comportamiento |
|------|----------------|
| Hub Realtime | Canal compartido `branch-ops-hub:{branchId}` (`src/lib/queryEgress.ts`). Eventos operational/payments invalidan **todo** `OPERATIONAL_ORDER_LIST_KEYS` (+ tables / `order` prefix; payments → completedPayments), no solo el módulo montado. |
| Poll si hub cae | `OPERATIONAL_LIST_BACKUP_POLL_MS = 30_000` cuando hub ≠ `SUBSCRIBED`. |
| Safety con hub sano | `OPERATIONAL_LIST_SAFETY_POLL_MS = 0` (sin safety global). **Excepción:** Despacho/Servir usan `DISPATCH_SERVIR_SAFETY_POLL_MS = 15_000`. |
| Foco / red | Listas operativas con `refetchOnWindowFocus: true` y `refetchOnReconnect: true` (overrides locales; el default global en `App.tsx` sigue en `false`). |
| Invalidaciones | Helper `invalidateOperationalOrderQueries`; tras `sendToKitchen` / `sendToDispatch` también `removeQueries` del bundle + `refetchQueries` activos de Despacho/Servir. |
| Indicador UI | Badge **Sync lenta** en `AppLayout` cuando el hub no está suscrito. |

### Cola Despacho/Servir (bundle, 2026-08-10)

- RPC `get_dispatch_servir_queue_bundle(p_branch_id, p_shift_id)` (`20260810160000`, endurecida en `20260810250000`).
- Cliente: `fetchDispatchServirQueueBundle` **directo a red** (sin `ensureQueryData` / cache RQ del bundle). Prefetch warm **no** precarga el bundle (`useWarmDispatchServirCaches` solo bootstrap + platos).
- Al cambiar de turno: `removeQueries` de bundle / dispatch-orders / servir-orders; `resetRepairOpenShiftThrottle`.
- Si la cola viene vacía: `repairOpenShiftOrderCashShiftIds(..., { force: true })` + 1 reintento de RPC.
- La RPC es `VOLATILE`: al inicio llama `repair_open_shift_order_cash_shift_ids` e incluye órdenes del turno OPEN aunque el tag esté NULL o apunte a un turno `CLOSED` (huérfanas temporales).

### Visibilidad y `cash_shift_id` (2026-08-07 → 2026-08-10)

- Las listas de Caja/Despacho/Servir filtran por turno abierto.
- Trigger `assign_open_cash_shift_to_order`: completa NULL → OPEN; desde `20260810240000` / `20260810250000` **también reetiqueta** si el turno taggeado está `CLOSED`.
- Repair: `repair_open_shift_order_cash_shift_ids(p_branch_id)` (NULL o tag `CLOSED` → turno OPEN actual, si la orden pertenece temporalmente al turno).
- Cliente: `repairOpenShiftOrderCashShiftIds` (throttle 120 s **solo tras éxito**; se resetea al cambiar turno).
- Lecturas de listas operativas usan `dbSelectStrict` / turno OPEN via `getOpenCashShiftForBranch(..., { strict: true })`.
- Gate: si `get_my_branch_shift_gate` / v2 hace timeout/falla, `useBranchShiftGate` **re-lanza** (no devuelve `shiftId: null`). Con `keepPreviousData` se conserva el último gate válido.

### Separación Servir / PLATOS (2026-08-10)

- Condición para separar: `bundle.has_plate_servers` **OR** `shiftGate.canServePlates`.
- Despacho oculta PLATOS; Servir muestra solo PLATOS (`menuPlatosCategory.ts` + `isPlatosOrderItem`).
- **No cachear** catálogo PLATOS vacío (memoria / localStorage / RQ): un `[]` fresco envenenaba Despacho (todos los ítems ahí) y vaciaba Servir.
- Si hace falta separar y el set viene vacío → invalidar y recargar una vez.

### Constantes (`src/lib/queryEgress.ts`)

| Constante | Valor | Uso |
|-----------|-------|-----|
| `OPERATIONAL_STALE_MS` | 15 s | staleTime de listas |
| `OPERATIONAL_LIST_BACKUP_POLL_MS` | **30 s** | poll si hub ≠ SUBSCRIBED |
| `OPERATIONAL_LIST_SAFETY_POLL_MS` | **0** | sin safety global |
| `DISPATCH_SERVIR_SAFETY_POLL_MS` | **15 s** | safety solo Despacho/Servir |
| `OPERATIONAL_BACKUP_POLL_MS` | 60 s | turno/caja si hub cae |
| `SHIFT_GATE_BACKUP_POLL_MS` | 5 min | gate de turno |
| `MONITOR_BACKUP_POLL_MS` | 5 min | Monitoreo Global |
| `HUB_DEFAULT_DEBOUNCE_MS` | 1,2 s | debounce del hub |

### Pantallas que usan el poll adaptativo de listas

- Despacho / Servir (`useDispatchOrders` + safety 15 s)
- Cocina (`useKitchenOrders`)
- Caja / Recaudar (`useCaja`)
- Órdenes por estado (`useOrdersByStatus`)
- Mesas (`useTablesWithStatus`)
- Extra / Express / Para llevar / Orden especial

API: `useAdaptiveRefetchInterval(backupMs, enabled, safetyMs?)` + `useOperationalOrdersRealtime` / `useHubRealtimeStatus`.

## Requisitos en remoto

1. Migración `20260730230000_realtime_turnos_y_snapshots_lite.sql` (Realtime base).
2. `20260810120000_branch_id_ready_dispatch_events.sql` — filtro Realtime por sucursal en ready/dispatch.
3. `20260810160000` + **`20260810250000`** — bundle cola + self-heal / retag.
4. `20260810240000` (retag al enviar) — cubierta también por `…250000` si se aplica completa.
5. Sin esas migraciones: cola puede quedar vacía post-turno o Realtime ruidoso; el poll de respaldo mitiga UI pero no arregla tags en BD.

## Qué **no** sustituye el plan Free→Pro de Supabase

Subir de Free a Pro ayuda con límites de Realtime/conexiones, pero **no** reemplaza esta Fase 1.5 ni el self-heal de cola: el poll adaptativo + fetch directo del bundle + repair siguen siendo necesarios.

## Fases pendientes (no implementadas)

- **Fase 3 (idea):** sync por versión / snapshots más agresivos para menos Egress.

Ver también: `docs/supabase-performance-audit-phase2.md`.
