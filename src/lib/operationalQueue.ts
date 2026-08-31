import { supabase } from "@/integrations/supabase/client";
import {
  normalizeDispatchServirQueueBundle,
  type DispatchServirQueueBundle,
} from "@/lib/dispatchServirQueueBundle";
import { computeOperationalQuantities, orderTreatAsFullyPaidForDispatch } from "@/lib/orderOperational";
import type { OperationalQueueModule } from "@/lib/operationalQueueConfig";

export type OperationalQueueBundle = DispatchServirQueueBundle;

/** Misma ventana que el bundle legacy para compartir cadencia de invalidación RT. */
export const OPERATIONAL_QUEUE_CACHE_TTL_MS = 8_000;

type OperationalQueueCacheEntry = {
  bundle: OperationalQueueBundle;
  storedAt: number;
};

const queueCache = new Map<string, OperationalQueueCacheEntry>();
const queueInflight = new Map<string, Promise<OperationalQueueBundle>>();
const queueRequestVersions = new Map<string, number>();

function operationalQueueCacheKey(branchId: string, shiftId: string, module: OperationalQueueModule) {
  return `${branchId}:${shiftId}:${module}`;
}

function nextQueueRequestVersion(key: string) {
  const next = (queueRequestVersions.get(key) ?? 0) + 1;
  queueRequestVersions.set(key, next);
  return next;
}

export function invalidateOperationalQueueCache(
  branchId?: string,
  shiftId?: string,
  module?: OperationalQueueModule,
) {
  const keys = new Set([
    ...queueCache.keys(),
    ...queueInflight.keys(),
    ...queueRequestVersions.keys(),
  ]);

  for (const key of keys) {
    const [entryBranchId, entryShiftId, entryModule] = key.split(":");
    if (branchId && entryBranchId !== branchId) continue;
    if (shiftId && entryShiftId !== shiftId) continue;
    if (module && entryModule !== module) continue;

    queueCache.delete(key);
    queueInflight.delete(key);
    nextQueueRequestVersion(key);
  }
}

function asInt(value: unknown) {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}

/** UUID válido para PostgREST; string vacío rompe el match de la RPC (404). */
export function rpcUuidOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isOperationalQueueRpcNotFoundError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code ?? "");
  const message = String((error as { message?: string })?.message ?? "");
  return code === "PGRST202" || message.includes("Could not find the function");
}

async function postOperationalQueueRpc(params: Record<string, unknown>) {
  const rpcName = "get_dispatch_operational_queue";
  const { data, error } = await (supabase as any).rpc(rpcName, params);
  if (!error) return data;

  if (!isOperationalQueueRpcNotFoundError(error)) throw error;

  // Fallback: con JWT de sesión PostgREST a veces devuelve 404; con anon key responde 200.
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const apiKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!supabaseUrl || !apiKey) throw error;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const rpcError = new Error(
      String((payload as { message?: string })?.message ?? response.statusText),
    ) as Error & { code?: string };
    rpcError.code = String((payload as { code?: string })?.code ?? "");
    throw rpcError;
  }

  return response.json();
}

async function invokeOperationalQueueRpc(
  branchId: string,
  shiftId: string,
  module: OperationalQueueModule,
  runRepair: boolean,
) {
  const p_branch_id = rpcUuidOrNull(branchId);
  const p_shift_id = rpcUuidOrNull(shiftId);
  const p_run_repair = Boolean(runRepair);

  const attempts: Record<string, unknown>[] = [
    { p_branch_id, p_shift_id, p_module: module, p_run_repair },
  ];
  if (p_shift_id === null) {
    attempts.push({ p_branch_id, p_module: module, p_run_repair });
  }

  let lastError: unknown = null;
  for (const params of attempts) {
    try {
      return await postOperationalQueueRpc(params);
    } catch (error) {
      lastError = error;
      if (!isOperationalQueueRpcNotFoundError(error)) throw error;
    }
  }
  throw lastError;
}

/** Mapeo de ítem RPC servidor → línea de tarjeta Despacho/Servir/Empaquetador. */
export function mapServerQueueItemToDispatchLine(
  item: Record<string, unknown>,
  order: Record<string, unknown>,
  isDispatchFirst: boolean,
) {
  const quantityOrdered = asInt(item.quantity);
  const snapshotCancelledTotal = asInt(item.quantity_cancelled_total);
  const snapshotDispatchedTotal = asInt(item.quantity_dispatched_total);
  const snapshotCancelledDispatched = asInt(item.quantity_cancelled_dispatched);
  const snapshotPaid = asInt(item.quantity_paid);

  const quantities = computeOperationalQuantities({
    quantityOrdered,
    quantityReadyTotal: asInt(item.quantity_ready_total),
    quantityDispatchedTotal: snapshotDispatchedTotal,
    quantityCancelledPending: asInt(item.quantity_cancelled_pending),
    quantityCancelledReady: asInt(item.quantity_cancelled_ready),
    quantityCancelledDispatched: snapshotCancelledDispatched,
  });

  const quantityPaid = isDispatchFirst
    ? Math.max(0, quantityOrdered - snapshotCancelledTotal)
    : snapshotPaid > 0
      ? Math.min(quantityOrdered, snapshotPaid)
      : orderTreatAsFullyPaidForDispatch(order)
        ? Math.max(0, quantityOrdered - snapshotCancelledTotal)
        : 0;

  const quantityDispatchedNet = Math.max(0, snapshotDispatchedTotal - snapshotCancelledDispatched);

  return {
    quantityOrdered,
    quantities,
    quantityPaid,
    quantityDispatchedNet,
    quantityPendingPrepare: asInt(item.quantity_pending_prepare),
    quantityReadyAvailable: asInt(item.quantity_ready_available),
    quantityDispatchable: asInt(item.quantity_dispatchable),
  };
}

/** 1 RTT: cola operativa con quantity_dispatchable calculado en SQL. */
export async function fetchOperationalQueue(
  branchId: string,
  shiftId: string,
  module: OperationalQueueModule,
  options?: { force?: boolean; runRepair?: boolean },
): Promise<OperationalQueueBundle> {
  const key = operationalQueueCacheKey(branchId, shiftId, module);
  const force = Boolean(options?.force);
  const now = Date.now();
  const cached = queueCache.get(key);

  if (!force && cached && now - cached.storedAt < OPERATIONAL_QUEUE_CACHE_TTL_MS) {
    return cached.bundle;
  }

  if (!force) {
    const inflight = queueInflight.get(key);
    if (inflight) return inflight;
  }

  const version = nextQueueRequestVersion(key);
  const request = (async () => {
    const data = await invokeOperationalQueueRpc(
      branchId,
      shiftId,
      module,
      Boolean(options?.runRepair),
    );

    const bundle = normalizeDispatchServirQueueBundle(data);
    if (queueRequestVersions.get(key) === version) {
      if (bundle.orders.length > 0) {
        queueCache.set(key, { bundle, storedAt: Date.now() });
      } else {
        queueCache.delete(key);
      }
    }
    return bundle;
  })();

  queueInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (queueInflight.get(key) === request) {
      queueInflight.delete(key);
    }
  }
}
