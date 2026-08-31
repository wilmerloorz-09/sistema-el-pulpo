import { useEffect, useRef, useSyncExternalStore } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { invalidateDispatchServirQueueBundleCache } from "@/lib/dispatchServirQueueBundle";
import { invalidateOperationalQueueCache } from "@/lib/operationalQueue";
import { OPERATIONAL_ORDER_LIST_KEYS, qk } from "@/lib/queryKeys";

/** Defaults para catálogos casi estáticos (métodos de pago, denominaciones, plantillas). */
export const CATALOG_STALE_MS = 30 * 60_000;
export const CATALOG_GC_MS = 60 * 60_000;

/** Datos operativos de turno (listas de órdenes): frescos pero sin refetch por foco. */
export const OPERATIONAL_STALE_MS = 25_000;
export const OPERATIONAL_GC_MS = 5 * 60_000;

/** Gate de turno / sesión: Realtime de cash_shifts; stale generoso (9 tablets). */
export const SHIFT_GATE_STALE_MS = 60_000;
/** Respaldo muy lento si Realtime de turnos falla (migración 20260730230000). */
export const SHIFT_GATE_BACKUP_POLL_MS = 5 * 60_000;

/** Monitoreo global: Realtime primero; respaldo muy lento. */
export const MONITOR_BACKUP_POLL_MS = 5 * 60_000;

/** Auth session lock: validación periódica (foco/visibilidad cubren el resto). */
export const AUTH_SESSION_POLL_MS = 5 * 60_000;

/** Respaldo de turno/caja cuando el hub no está SUBSCRIBED. */
export const OPERATIONAL_BACKUP_POLL_MS = 60_000;

/** Respaldo de listas si Realtime no está suscrito (hub error/idle): 60s. */
export const OPERATIONAL_LIST_BACKUP_POLL_MS = 60_000;

/**
 * Safety net aunque el hub esté SUBSCRIBED.
 * Con N sucursales OPEN, el poll periódico regeneraba tormenta aunque RT
 * funcionara. Por defecto 0: confiar en Realtime; si el hub cae, usa backupMs.
 *
 * Excepción: colas críticas (Despacho/Servir) deben pasar un safetyMs > 0
 * para que un fallo de invalidación/caché no deje la UI vacía minutos.
 */
export const OPERATIONAL_LIST_SAFETY_POLL_MS = 0;

/** Techo de frescura Despacho/Servir/Empaquetador con hub SUBSCRIBED (antes 300s). */
export const DISPATCH_SERVIR_SAFETY_POLL_MS = 45_000;

/** Debounce por defecto del hub: agrupa ráfagas de cocina/ítems en un solo refetch. */
export const HUB_DEFAULT_DEBOUNCE_MS = 3_000;

/**
 * Jitter sticky por hub/sesión (0..N ms) para que N tablets no refetch
 * en el mismo tick tras el debounce compartido del evento Realtime.
 * No afecta invalidaciones directas (Cobrar/Despachar/Listo).
 */
export const HUB_DEBOUNCE_JITTER_MS = 2_000;

/**
 * Si la query se actualizó hace menos de este gap, el hub RT no la vuelve a refetch.
 * Las invalidaciones post-mutación (cobrar/despachar) no usan este techo.
 */
export const HUB_MIN_REFETCH_GAP_MS = 10_000;

/**
 * Gap corto solo para dispatch → payable-orders.
 * Evita el doble golpe mutación+Realtime sin bloquear ~10s la cola de Recaudar
 * cuando acaba de refrescarse por un alta de orden.
 */
export const HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS = 4_000;

export type HubRealtimeStatus = "idle" | "connecting" | "subscribed" | "error" | "closed";

export type HubInvalidateSource =
  | "order_items"
  | "orders"
  | "ready"
  | "dispatch"
  | "payments"
  | "shift";

function isPayableOrdersQueryKey(key: QueryKey): boolean {
  return Array.isArray(key) && key[0] === qk.payableOrders[0];
}

function isDispatchQueueQueryKey(key: QueryKey): boolean {
  const head = queryKeyHead(key);
  return (
    head === qk.dispatchOrders[0]
    || head === qk.servirOrders[0]
    || head === qk.packingOrders[0]
    || head === qk.dispatchServirQueueBundle[0]
    || head === qk.kitchenOrders[0]
  );
}

function queryKeyHead(key: QueryKey): unknown {
  return Array.isArray(key) ? key[0] : key;
}

/**
 * Fan-out de consumers montados: en `order_items` (muy frecuente) no refrescar
 * Recaudar ni turno de caja. Sigue actualizándose en `orders`, `dispatch` y `payments`.
 */
export function shouldFanOutConsumerKeyOnHubSource(
  source: HubInvalidateSource,
  key: QueryKey,
): boolean {
  if (source !== "order_items") return true;
  const head = queryKeyHead(key);
  return (
    head !== qk.payableOrders[0]
    && head !== qk.completedPayments[0]
    && head !== qk.currentShift[0]
    && head !== qk.openCashShift[0]
    && head !== qk.cashRegisterMovements[0]
  );
}

/**
 * Gap efectivo del hub por (source, query).
 * dispatch → payable usa gap corto (no el skip total anterior) para cortar
 * el doble refetch mutación+RT sin retrasar Recaudar ~10s tras un alta de orden.
 */
export function hubMinRefetchGapMs(source: HubInvalidateSource, key: QueryKey): number {
  if (source === "dispatch" && isPayableOrdersQueryKey(key)) {
    return HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS;
  }
  if (source === "payments" && isDispatchQueueQueryKey(key)) {
    return HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS;
  }
  return HUB_MIN_REFETCH_GAP_MS;
}

/**
 * @deprecated Ya no se salta el gap: dispatch→payable usa
 * HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS vía hubMinRefetchGapMs.
 */
export function shouldSkipHubMinRefetchGap(_source: HubInvalidateSource, _key: QueryKey): boolean {
  return false;
}

export function hubShouldInvalidateQuery(params: {
  source: HubInvalidateSource;
  queryKey: QueryKey;
  updatedAt: number;
  now?: number;
}): boolean {
  if (!params.updatedAt) return true;
  const gapMs = hubMinRefetchGapMs(params.source, params.queryKey);
  return (params.now ?? Date.now()) - params.updatedAt >= gapMs;
}

/**
 * Sets de invalidación por tipo de evento Realtime.
 * Antes: cada order_items invalidaba TODO el set operativo (Caja incluida).
 * Ahora: solo módulos afectados; las pantallas montadas siguen vía consumer keys.
 */
function keysForHubSource(source: HubInvalidateSource): readonly QueryKey[] {
  const kitchenQueue: QueryKey[] = [
    qk.kitchenOrders,
    qk.dispatchOrders,
    qk.servirOrders,
    qk.packingOrders,
    qk.dispatchServirQueueBundle,
  ];
  const tables: QueryKey[] = [qk.tablesWithStatus, qk.tableOrders];
  const channelCards: QueryKey[] = [
    qk.orders,
    qk.takeoutOrders,
    qk.expressOrders,
    qk.extraOrders,
    qk.specialOrders,
  ];

  switch (source) {
    case "order_items":
      // Alta frecuencia: cocina/despacho/mesas; sin payable (Recaudar en orders/dispatch/payments).
      // Canales Extra/Express/… bastan con `orders`.
      return [...kitchenQueue, ...tables, qk.orderPrefix];
    case "orders":
      // Cambio de cabecera/estado: Caja por cobrar sí importa.
      return [...kitchenQueue, ...tables, qk.orderPrefix, ...channelCards, qk.payableOrders];
    case "ready":
      return [...kitchenQueue, qk.orderPrefix];
    case "dispatch":
      return [
        ...kitchenQueue,
        ...tables,
        qk.orderPrefix,
        qk.payableOrders,
        qk.orders,
      ];
    case "payments":
      // Colas de cobro/despacho/mesas/empaque. Sin canales Extra/Express/… ni historial.
      return [
        qk.payableOrders,
        ...tables,
        qk.dispatchOrders,
        qk.servirOrders,
        qk.packingOrders,
        qk.dispatchServirQueueBundle,
      ];
    case "shift":
      return [qk.branchShiftGate, qk.currentShift, qk.openCashShift];
    default:
      return [...OPERATIONAL_ORDER_LIST_KEYS];
  }
}

function isShiftGateQueryKey(key: QueryKey): boolean {
  const head = Array.isArray(key) ? key[0] : key;
  return (
    head === qk.branchShiftGate[0]
    || head === qk.currentShift[0]
    || head === qk.openCashShift[0]
  );
}


/**
 * Invalida queries operativas de órdenes afectadas por un cambio de cobro/despacho.
 * Evita tocar catálogos; el gate/turno solo si se pide explícitamente.
 * Con `branchId`, solo invalida caches de esa sucursal (keys `[prefix, branchId, ...]`).
 */
export function invalidateOperationalOrderQueries(
  qc: QueryClient,
  options?: {
    branchId?: string | null;
    includeCompletedPayments?: boolean;
    includeTables?: boolean;
    includePromotions?: boolean;
    includeShiftGate?: boolean;
    includeCurrentShift?: boolean;
    includeCashMovements?: boolean;
    includeAutopedidos?: boolean;
    orderId?: string | null;
  },
) {
  const {
    branchId = null,
    includeCompletedPayments = true,
    includeTables = true,
    includePromotions = false,
    includeShiftGate = false,
    includeCurrentShift = false,
    includeCashMovements = false,
    includeAutopedidos = false,
    orderId = null,
  } = options ?? {};

  const invalidatePrefixed = (prefix: readonly unknown[]) => {
    const head = prefix[0];
    if (branchId) {
      void qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === head && key[1] === branchId;
        },
      });
      return;
    }
    void qc.invalidateQueries({ queryKey: prefix });
  };

  for (const key of OPERATIONAL_ORDER_LIST_KEYS) {
    invalidatePrefixed(key);
  }

  if (includeTables) {
    // ["tables-with-status", branchId, ...]
    invalidatePrefixed(qk.tablesWithStatus);
    // ["table-orders", tableId] — sin branch en la key
    void qc.invalidateQueries({ queryKey: qk.tableOrders });
  }
  if (includeCompletedPayments) {
    // ["completed-payments", branchId, ...]
    invalidatePrefixed(qk.completedPayments);
  }
  if (includePromotions) {
    invalidatePrefixed(qk.promocionesOrdenes);
  }
  if (includeShiftGate) {
    invalidatePrefixed(qk.branchShiftGate);
  }
  if (includeCurrentShift) {
    invalidatePrefixed(qk.currentShift);
  }
  if (includeCashMovements) {
    // ["cash-register-movements", shiftId] — sin branch en la key
    void qc.invalidateQueries({ queryKey: qk.cashRegisterMovements });
  }
  if (includeAutopedidos) {
    invalidatePrefixed(qk.autopedidosQr);
  }
  // Detalle de orden: una concreta y/o el prefijo (splits, siblings, listas).
  if (orderId) {
    void qc.invalidateQueries({ queryKey: qk.order(orderId) });
  }
  void qc.invalidateQueries({ queryKey: qk.orderPrefix });
}

type ConsumerConfig = {
  queryKeys: QueryKey[];
  includePayments: boolean;
  includeShiftGate: boolean;
  shiftId: string | null;
  debounceMs: number;
};

type ConsumerEntry = {
  config: ConsumerConfig;
  /** Varios hooks pueden compartir el mismo channelPrefix (p.ej. gate). */
  refCount: number;
};

type BranchRealtimeHub = {
  branchId: string;
  queryClient: QueryClient;
  consumers: Map<string, ConsumerEntry>;
  shiftId: string | null;
  channel: RealtimeChannel | null;
  debounceTimer: number | null;
  debounceMs: number;
  /** Offset fijo de esta sesión de hub (no se regenera por evento). */
  jitterMs: number;
  /** Eventos RT llegados con la app/pestaña oculta; se vacían al volver a visible. */
  pendingSources: Set<HubInvalidateSource>;
  status: HubRealtimeStatus;
  retryTimer: number | null;
  retryAttempt: number;
};

const hubsByBranch = new Map<string, BranchRealtimeHub>();
const statusListeners = new Set<() => void>();
const visibilityListeners = new Set<() => void>();

let pageVisible =
  typeof document === "undefined" ? true : document.visibilityState !== "hidden";

function notifyStatusListeners() {
  for (const listener of statusListeners) {
    listener();
  }
}

function notifyVisibilityListeners() {
  for (const listener of visibilityListeners) {
    listener();
  }
}

function isPageVisible(): boolean {
  return pageVisible;
}

function setPageVisible(next: boolean) {
  if (pageVisible === next) return;
  pageVisible = next;
  notifyVisibilityListeners();
  if (!next) return;
  for (const hub of hubsByBranch.values()) {
    flushPendingHubInvalidates(hub);
    if (
      hub.consumers.size > 0
      && (hub.status === "error" || hub.status === "closed")
    ) {
      rebuildHubChannel(hub);
    }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    setPageVisible(document.visibilityState !== "hidden");
  });
}

/**
 * true si la pestaña/WebView está visible (tablets en segundo plano no refrescan).
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      visibilityListeners.add(listener);
      return () => {
        visibilityListeners.delete(listener);
      };
    },
    () => pageVisible,
    () => true,
  );
}

function setHubStatus(hub: BranchRealtimeHub, status: HubRealtimeStatus) {
  if (hub.status === status) return;
  hub.status = status;
  notifyStatusListeners();
}

export function getHubRealtimeStatus(branchId: string | null | undefined): HubRealtimeStatus {
  if (!branchId) return "idle";
  return hubsByBranch.get(branchId)?.status ?? "idle";
}

export function isHubRealtimeSubscribed(branchId: string | null | undefined): boolean {
  return getHubRealtimeStatus(branchId) === "subscribed";
}

function subscribeHubStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Estado de suscripción del hub operativo de la sucursal (reactivo).
 */
export function useHubRealtimeStatus(branchId: string | null | undefined): HubRealtimeStatus {
  return useSyncExternalStore(
    subscribeHubStatus,
    () => getHubRealtimeStatus(branchId),
    () => "idle" as HubRealtimeStatus,
  );
}

/**
 * Polling adaptativo de listas operativas:
 * - Pestaña/app oculta → sin poll
 * - Realtime SUBSCRIBED → sin poll (safetyMs=0) o safetyMs si se pide explícito
 * - Desconectado / error / idle → backupMs
 */
export function useAdaptiveRefetchInterval(
  branchId: string | null | undefined,
  backupMs: number,
  enabled = true,
  safetyMs: number = OPERATIONAL_LIST_SAFETY_POLL_MS,
): number | false {
  const status = useHubRealtimeStatus(branchId);
  const visible = usePageVisible();
  if (!enabled || !visible) return false;
  if (status === "subscribed") {
    return safetyMs > 0 ? safetyMs : false;
  }
  return backupMs;
}

function mergeConsumerNeeds(hub: BranchRealtimeHub) {
  let includePayments = false;
  let includeShiftGate = false;
  let shiftId: string | null = null;
  let debounceMs = HUB_DEFAULT_DEBOUNCE_MS;
  const keys: QueryKey[] = [];
  const seen = new Set<string>();

  for (const entry of hub.consumers.values()) {
    const consumer = entry.config;
    if (consumer.includePayments) includePayments = true;
    if (consumer.includeShiftGate) includeShiftGate = true;
    if (consumer.shiftId) shiftId = consumer.shiftId;
    debounceMs = Math.max(debounceMs, consumer.debounceMs);
    for (const key of consumer.queryKeys) {
      const stamp = JSON.stringify(key);
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      keys.push(key);
    }
  }

  return { includePayments, includeShiftGate, shiftId, keys, debounceMs };
}

function hubInvalidateKey(
  hub: BranchRealtimeHub,
  key: QueryKey,
  seen: Set<string>,
  source: HubInvalidateSource,
) {
  const stamp = JSON.stringify(key);
  if (seen.has(stamp)) return;
  seen.add(stamp);
  const now = Date.now();
  void hub.queryClient.invalidateQueries({
    queryKey: key,
    refetchType: "active",
    predicate: (query) => hubShouldInvalidateQuery({
      source,
      queryKey: key,
      updatedAt: query.state.dataUpdatedAt,
      now,
    }),
  });
}

function runHubInvalidateNow(hub: BranchRealtimeHub, source: HubInvalidateSource) {
  const { keys } = mergeConsumerNeeds(hub);
  // El bundle no vive en React Query: el hub debe limpiar explícitamente su
  // cache local antes de que las colas activas se rehidraten.
  if (source !== "shift") {
    invalidateDispatchServirQueueBundleCache(hub.branchId);
    invalidateOperationalQueueCache(hub.branchId);
  }
  // Eventos de órdenes/ítems/listo/despacho NO deben refetch el gate
  // (antes cada plato listo re-disparaba 4–5 RPCs de turno en cada tablet).
  const filtered =
    source === "shift"
      ? keys
      : keys.filter((key) => !isShiftGateQueryKey(key));

  const seen = new Set<string>();

  for (const key of keysForHubSource(source)) {
    hubInvalidateKey(hub, key, seen, source);
  }

  // payments: sin fan-out a consumidores (Extra/Express/historial); solo set acotado.
  if (source !== "payments") {
    for (const key of filtered) {
      if (!shouldFanOutConsumerKeyOnHubSource(source, key)) continue;
      hubInvalidateKey(hub, key, seen, source);
    }
  }
  if (source === "shift") {
    hubInvalidateKey(hub, qk.branchShiftGate, seen, source);
    hubInvalidateKey(hub, qk.currentShift, seen, source);
    hubInvalidateKey(hub, qk.openCashShift, seen, source);
  }
}

function flushPendingHubInvalidates(hub: BranchRealtimeHub) {
  if (hub.pendingSources.size === 0) return;
  const sources = Array.from(hub.pendingSources);
  hub.pendingSources.clear();
  for (const source of sources) {
    runHubInvalidateNow(hub, source);
  }
}

function scheduleHubInvalidate(hub: BranchRealtimeHub, source: HubInvalidateSource = "order_items") {
  if (!isPageVisible()) {
    hub.pendingSources.add(source);
    if (hub.debounceTimer != null) {
      window.clearTimeout(hub.debounceTimer);
      hub.debounceTimer = null;
    }
    return;
  }

  if (hub.debounceTimer != null) {
    window.clearTimeout(hub.debounceTimer);
  }
  hub.debounceTimer = window.setTimeout(() => {
    hub.debounceTimer = null;
    if (!isPageVisible()) {
      hub.pendingSources.add(source);
      return;
    }
    runHubInvalidateNow(hub, source);
  }, hub.debounceMs + hub.jitterMs);
}

function clearHubRetry(hub: BranchRealtimeHub) {
  if (hub.retryTimer != null) {
    window.clearTimeout(hub.retryTimer);
    hub.retryTimer = null;
  }
}

function scheduleHubReconnect(hub: BranchRealtimeHub) {
  if (hub.consumers.size === 0) return;
  if (hub.retryTimer != null) return;

  const delay = Math.min(30_000, 2_000 * 2 ** Math.min(hub.retryAttempt, 4));
  hub.retryTimer = window.setTimeout(() => {
    hub.retryTimer = null;
    hub.retryAttempt += 1;
    if (hub.consumers.size > 0) {
      rebuildHubChannel(hub);
    }
  }, delay);
}

function rebuildHubChannel(hub: BranchRealtimeHub) {
  clearHubRetry(hub);

  if (hub.channel) {
    void supabase.removeChannel(hub.channel);
    hub.channel = null;
  }

  if (hub.consumers.size === 0) {
    setHubStatus(hub, "idle");
    hubsByBranch.delete(hub.branchId);
    notifyStatusListeners();
    return;
  }

  const { includePayments, includeShiftGate, shiftId, debounceMs } = mergeConsumerNeeds(hub);
  hub.shiftId = shiftId;
  hub.debounceMs = debounceMs;
  const onOrderItems = () => scheduleHubInvalidate(hub, "order_items");
  const onOrders = () => scheduleHubInvalidate(hub, "orders");
  const onReady = () => scheduleHubInvalidate(hub, "ready");
  const onDispatchEvt = () => scheduleHubInvalidate(hub, "dispatch");
  const onShift = () => scheduleHubInvalidate(hub, "shift");
  const onPayments = () => scheduleHubInvalidate(hub, "payments");

  setHubStatus(hub, "connecting");

  let channel = supabase
    .channel(`branch-ops-hub:${hub.branchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `branch_id=eq.${hub.branchId}`,
      },
      onOrders,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "order_items",
        // Requiere migración 20260730230000 (sucursal_id).
        filter: `sucursal_id=eq.${hub.branchId}`,
      },
      onOrderItems,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "order_ready_events",
        // Requiere migración 20260810120000 (branch_id).
        filter: `branch_id=eq.${hub.branchId}`,
      },
      onReady,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "order_dispatch_events",
        // Requiere migración 20260810120000 (branch_id).
        filter: `branch_id=eq.${hub.branchId}`,
      },
      onDispatchEvt,
    );

  // Sin shiftId no suscribir payments/cash_shift_users globales: con N sucursales
  // abiertas eso retransmitía el tráfico de todos los locales. La apertura del
  // turno ya invalida vía cash_shifts (filtro por branch_id) y reconstruye el hub.
  if (includePayments && hub.shiftId) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "payments",
        filter: `shift_id=eq.${hub.shiftId}`,
      },
      onPayments,
    );
  }

  if (includeShiftGate) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cash_shifts",
        filter: `branch_id=eq.${hub.branchId}`,
      },
      onShift,
    );

    if (hub.shiftId) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cash_shift_users",
          filter: `shift_id=eq.${hub.shiftId}`,
        },
        onShift,
      );
    }
  }

  hub.channel = channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      hub.retryAttempt = 0;
      clearHubRetry(hub);
      setHubStatus(hub, "subscribed");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setHubStatus(hub, "error");
      scheduleHubReconnect(hub);
    } else if (status === "CLOSED") {
      setHubStatus(hub, "closed");
      scheduleHubReconnect(hub);
    }
  });
}

function getOrCreateHub(branchId: string, queryClient: QueryClient): BranchRealtimeHub {
  let hub = hubsByBranch.get(branchId);
  if (!hub) {
    hub = {
      branchId,
      queryClient,
      consumers: new Map(),
      shiftId: null,
      channel: null,
      debounceTimer: null,
      debounceMs: HUB_DEFAULT_DEBOUNCE_MS,
      jitterMs: Math.floor(Math.random() * (HUB_DEBOUNCE_JITTER_MS + 1)),
      pendingSources: new Set(),
      status: "idle",
      retryTimer: null,
      retryAttempt: 0,
    };
    hubsByBranch.set(branchId, hub);
  } else {
    hub.queryClient = queryClient;
  }
  return hub;
}

function upsertHubConsumer(
  branchId: string,
  queryClient: QueryClient,
  consumerId: string,
  config: ConsumerConfig,
  /** true = nuevo mount del hook; false = solo actualizar config (deps). */
  isNewMount: boolean,
) {
  const hub = getOrCreateHub(branchId, queryClient);
  const prevEntry = hub.consumers.get(consumerId);
  const prev = prevEntry?.config;

  if (!prevEntry) {
    if (!isNewMount) return;
    hub.consumers.set(consumerId, { config, refCount: 1 });
  } else {
    prevEntry.config = config;
    if (isNewMount) prevEntry.refCount += 1;
  }

  const merged = mergeConsumerNeeds(hub);
  const shiftChanged = hub.shiftId !== merged.shiftId;
  hub.shiftId = merged.shiftId;
  hub.debounceMs = merged.debounceMs;

  const needsRebuild =
    !hub.channel ||
    shiftChanged ||
    !prev ||
    prev.includePayments !== config.includePayments ||
    prev.includeShiftGate !== config.includeShiftGate ||
    prev.shiftId !== config.shiftId;

  if (needsRebuild) {
    rebuildHubChannel(hub);
  }
}

function removeHubConsumer(branchId: string, consumerId: string) {
  const hub = hubsByBranch.get(branchId);
  if (!hub) return;

  const entry = hub.consumers.get(consumerId);
  if (!entry) return;

  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  hub.consumers.delete(consumerId);
  if (hub.consumers.size === 0) {
    if (hub.debounceTimer != null) {
      window.clearTimeout(hub.debounceTimer);
      hub.debounceTimer = null;
    }
    clearHubRetry(hub);
    if (hub.channel) {
      void supabase.removeChannel(hub.channel);
      hub.channel = null;
    }
    setHubStatus(hub, "idle");
    hubsByBranch.delete(branchId);
    notifyStatusListeners();
    return;
  }

  const merged = mergeConsumerNeeds(hub);
  hub.shiftId = merged.shiftId;
  hub.debounceMs = merged.debounceMs;
  rebuildHubChannel(hub);
}

type UseOperationalOrdersRealtimeOptions = {
  branchId: string | null | undefined;
  queryClient: QueryClient;
  /** Identificador estable del consumidor (antes channelPrefix). */
  channelPrefix: string;
  enabled?: boolean;
  queryKeys: QueryKey[];
  debounceMs?: number;
  includePayments?: boolean;
  /** Invalidar branch-shift-gate / current-shift ante cambios de turno. */
  includeShiftGate?: boolean;
  /** Filtra payments por shift_id cuando está disponible. */
  shiftId?: string | null;
};

/**
 * Suscripción Realtime operativa por sucursal.
 * Varias pantallas comparten UN solo canal (`branch-ops-hub:{branchId}`).
 */
export function useOperationalOrdersRealtime({
  branchId,
  queryClient,
  channelPrefix,
  enabled = true,
  queryKeys,
  debounceMs = HUB_DEFAULT_DEBOUNCE_MS,
  includePayments = false,
  includeShiftGate = false,
  shiftId = null,
}: UseOperationalOrdersRealtimeOptions) {
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  // Piso: nunca bajar el hub por debajo del default (Mesas/OrdersList pedían 250ms).
  const effectiveDebounceMs = Math.max(HUB_DEFAULT_DEBOUNCE_MS, debounceMs);

  const buildConfig = (): ConsumerConfig => ({
    queryKeys: keysRef.current,
    includePayments,
    includeShiftGate,
    shiftId: shiftId ?? null,
    debounceMs: effectiveDebounceMs,
  });

  // Lifecycle: +1 / -1 refCount. Varios callers con el mismo prefix coexisten.
  useEffect(() => {
    if (!enabled || !branchId || queryKeys.length === 0) return;

    upsertHubConsumer(branchId, queryClient, channelPrefix, buildConfig(), true);

    return () => {
      removeHubConsumer(branchId, channelPrefix);
    };
  }, [branchId, channelPrefix, enabled, queryClient, queryKeys.length]);

  // Actualizar needs (shiftId, payments, debounce) sin tocar refCount.
  useEffect(() => {
    if (!enabled || !branchId || queryKeys.length === 0) return;
    upsertHubConsumer(branchId, queryClient, channelPrefix, buildConfig(), false);
  }, [
    branchId,
    channelPrefix,
    effectiveDebounceMs,
    enabled,
    includePayments,
    includeShiftGate,
    queryClient,
    queryKeys.length,
    shiftId,
  ]);
}

/**
 * Alias explícito del hub unificado (misma implementación).
 */
export const useBranchOperationalRealtime = useOperationalOrdersRealtime;
