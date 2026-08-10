import { useEffect, useRef, useSyncExternalStore } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { OPERATIONAL_ORDER_LIST_KEYS, qk } from "@/lib/queryKeys";

/** Defaults para catálogos casi estáticos (métodos de pago, denominaciones, plantillas). */
export const CATALOG_STALE_MS = 30 * 60_000;
export const CATALOG_GC_MS = 60 * 60_000;

/** Datos operativos de turno (listas de órdenes): frescos pero sin refetch por foco. */
export const OPERATIONAL_STALE_MS = 15_000;
export const OPERATIONAL_GC_MS = 5 * 60_000;

/** Gate de turno / sesión: Realtime de cash_shifts; staleTime corto. */
export const SHIFT_GATE_STALE_MS = 30_000;
/** Respaldo muy lento si Realtime de turnos falla (migración 20260730230000). */
export const SHIFT_GATE_BACKUP_POLL_MS = 5 * 60_000;

/** Monitoreo global: Realtime primero; respaldo muy lento. */
export const MONITOR_BACKUP_POLL_MS = 5 * 60_000;

/** Auth session lock: validación menos agresiva. */
export const AUTH_SESSION_POLL_MS = 60_000;

/** Respaldo de turno/caja cuando el hub no está SUBSCRIBED. */
export const OPERATIONAL_BACKUP_POLL_MS = 60_000;

/** Respaldo de listas si Realtime no está suscrito (hub error/idle): 30s. */
export const OPERATIONAL_LIST_BACKUP_POLL_MS = 30_000;

/**
 * Safety net aunque el hub esté SUBSCRIBED.
 * Con N sucursales OPEN, el poll periódico regeneraba tormenta aunque RT
 * funcionara. Por defecto 0: confiar en Realtime; si el hub cae, usa backupMs.
 */
export const OPERATIONAL_LIST_SAFETY_POLL_MS = 0;

/** Debounce por defecto del hub: agrupa ráfagas de cocina/ítems en un solo refetch. */
export const HUB_DEFAULT_DEBOUNCE_MS = 1_200;

export type HubRealtimeStatus = "idle" | "connecting" | "subscribed" | "error" | "closed";

type HubInvalidateSource = "operational" | "shift" | "payments";

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
 */
export function invalidateOperationalOrderQueries(
  qc: QueryClient,
  options?: {
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
    includeCompletedPayments = true,
    includeTables = true,
    includePromotions = false,
    includeShiftGate = false,
    includeCurrentShift = false,
    includeCashMovements = false,
    includeAutopedidos = false,
    orderId = null,
  } = options ?? {};

  for (const key of OPERATIONAL_ORDER_LIST_KEYS) {
    void qc.invalidateQueries({ queryKey: key });
  }

  if (includeTables) {
    void qc.invalidateQueries({ queryKey: qk.tablesWithStatus });
    void qc.invalidateQueries({ queryKey: qk.tableOrders });
  }
  if (includeCompletedPayments) {
    void qc.invalidateQueries({ queryKey: qk.completedPayments });
  }
  if (includePromotions) {
    void qc.invalidateQueries({ queryKey: qk.promocionesOrdenes });
  }
  if (includeShiftGate) {
    void qc.invalidateQueries({ queryKey: qk.branchShiftGate });
  }
  if (includeCurrentShift) {
    void qc.invalidateQueries({ queryKey: qk.currentShift });
  }
  if (includeCashMovements) {
    void qc.invalidateQueries({ queryKey: qk.cashRegisterMovements });
  }
  if (includeAutopedidos) {
    void qc.invalidateQueries({ queryKey: qk.autopedidosQr });
  }
  if (orderId) {
    void qc.invalidateQueries({ queryKey: qk.order(orderId) });
  }
}

type ConsumerConfig = {
  queryKeys: QueryKey[];
  includePayments: boolean;
  includeShiftGate: boolean;
  shiftId: string | null;
};

type BranchRealtimeHub = {
  branchId: string;
  queryClient: QueryClient;
  consumers: Map<string, ConsumerConfig>;
  shiftId: string | null;
  channel: RealtimeChannel | null;
  debounceTimer: number | null;
  debounceMs: number;
  status: HubRealtimeStatus;
};

const hubsByBranch = new Map<string, BranchRealtimeHub>();
const statusListeners = new Set<() => void>();

function notifyStatusListeners() {
  for (const listener of statusListeners) {
    listener();
  }
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
 * - Realtime SUBSCRIBED → sin poll (safetyMs=0) o safetyMs si se pide explícito
 * - Desconectado / error / idle → backupMs (default 30s)
 */
export function useAdaptiveRefetchInterval(
  branchId: string | null | undefined,
  backupMs: number,
  enabled = true,
  safetyMs: number = OPERATIONAL_LIST_SAFETY_POLL_MS,
): number | false {
  const status = useHubRealtimeStatus(branchId);
  if (!enabled) return false;
  if (status === "subscribed") {
    return safetyMs > 0 ? safetyMs : false;
  }
  return backupMs;
}

function mergeConsumerNeeds(hub: BranchRealtimeHub) {
  let includePayments = false;
  let includeShiftGate = false;
  let shiftId: string | null = null;
  const keys: QueryKey[] = [];
  const seen = new Set<string>();

  for (const consumer of hub.consumers.values()) {
    if (consumer.includePayments) includePayments = true;
    if (consumer.includeShiftGate) includeShiftGate = true;
    if (consumer.shiftId) shiftId = consumer.shiftId;
    for (const key of consumer.queryKeys) {
      const stamp = JSON.stringify(key);
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      keys.push(key);
    }
  }

  return { includePayments, includeShiftGate, shiftId, keys };
}

function scheduleHubInvalidate(hub: BranchRealtimeHub, source: HubInvalidateSource = "operational") {
  if (hub.debounceTimer != null) {
    window.clearTimeout(hub.debounceTimer);
  }
  hub.debounceTimer = window.setTimeout(() => {
    hub.debounceTimer = null;
    const { keys } = mergeConsumerNeeds(hub);
    // Eventos de órdenes/ítems/listo/despacho NO deben refetch el gate
    // (antes cada plato listo re-disparaba 4–5 RPCs de turno en cada tablet).
    const filtered =
      source === "shift"
        ? keys
        : keys.filter((key) => !isShiftGateQueryKey(key));
    for (const key of filtered) {
      void hub.queryClient.invalidateQueries({ queryKey: key });
    }
    if (source === "shift") {
      // Asegurar gate aunque el consumidor no esté en la merge por timing.
      void hub.queryClient.invalidateQueries({ queryKey: qk.branchShiftGate });
      void hub.queryClient.invalidateQueries({ queryKey: qk.currentShift });
      void hub.queryClient.invalidateQueries({ queryKey: qk.openCashShift });
    }
  }, hub.debounceMs);
}

function rebuildHubChannel(hub: BranchRealtimeHub) {
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

  const { includePayments, includeShiftGate, shiftId } = mergeConsumerNeeds(hub);
  hub.shiftId = shiftId;
  const onOperational = () => scheduleHubInvalidate(hub, "operational");
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
      onOperational,
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
      onOperational,
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
      onOperational,
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
      onOperational,
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
      setHubStatus(hub, "subscribed");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setHubStatus(hub, "error");
    } else if (status === "CLOSED") {
      setHubStatus(hub, "closed");
    }
  });
}

function getOrCreateHub(branchId: string, queryClient: QueryClient, debounceMs: number): BranchRealtimeHub {
  let hub = hubsByBranch.get(branchId);
  if (!hub) {
    hub = {
      branchId,
      queryClient,
      consumers: new Map(),
      shiftId: null,
      channel: null,
      debounceTimer: null,
      debounceMs,
      status: "idle",
    };
    hubsByBranch.set(branchId, hub);
  } else {
    hub.queryClient = queryClient;
    hub.debounceMs = debounceMs;
  }
  return hub;
}

function upsertHubConsumer(
  branchId: string,
  queryClient: QueryClient,
  consumerId: string,
  config: ConsumerConfig,
  debounceMs: number,
) {
  const hub = getOrCreateHub(branchId, queryClient, debounceMs);
  const prev = hub.consumers.get(consumerId);
  hub.consumers.set(consumerId, config);

  const merged = mergeConsumerNeeds(hub);
  const shiftChanged = hub.shiftId !== merged.shiftId;
  hub.shiftId = merged.shiftId;

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

  hub.consumers.delete(consumerId);
  if (hub.consumers.size === 0) {
    if (hub.debounceTimer != null) {
      window.clearTimeout(hub.debounceTimer);
      hub.debounceTimer = null;
    }
    if (hub.channel) {
      void supabase.removeChannel(hub.channel);
      hub.channel = null;
    }
    setHubStatus(hub, "idle");
    hubsByBranch.delete(branchId);
    notifyStatusListeners();
    return;
  }

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

  useEffect(() => {
    if (!enabled || !branchId || queryKeys.length === 0) return;

    upsertHubConsumer(
      branchId,
      queryClient,
      channelPrefix,
      {
        queryKeys: keysRef.current,
        includePayments,
        includeShiftGate,
        shiftId: shiftId ?? null,
      },
      debounceMs,
    );

    return () => {
      removeHubConsumer(branchId, channelPrefix);
    };
  }, [
    branchId,
    channelPrefix,
    debounceMs,
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
