import { supabase } from "@/integrations/supabase/client";

export interface OperationalQuantitySnapshot {
  quantityOrdered: number;
  quantityReadyTotal: number;
  quantityReadyAvailable: number;
  quantityDispatchedTotal: number;
  quantityDispatchedAvailable: number;
  quantityCancelledPending: number;
  quantityCancelledReady: number;
  quantityCancelledDispatched: number;
  quantityCancelledTotal: number;
  quantityPendingPrepare: number;
}

function asInt(value: unknown) {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}

export function computeOperationalQuantities(input: {
  quantityOrdered: number;
  quantityReadyTotal?: number;
  quantityDispatchedTotal?: number;
  quantityCancelledPending?: number;
  quantityCancelledReady?: number;
  quantityCancelledDispatched?: number;
}): OperationalQuantitySnapshot {
  const quantityOrdered = asInt(input.quantityOrdered);
  const quantityReadyTotal = asInt(input.quantityReadyTotal);
  const quantityDispatchedTotal = asInt(input.quantityDispatchedTotal);
  const quantityCancelledPending = asInt(input.quantityCancelledPending);
  const quantityCancelledReady = asInt(input.quantityCancelledReady);
  const quantityCancelledDispatched = asInt(input.quantityCancelledDispatched);
  const quantityCancelledTotal = quantityCancelledPending + quantityCancelledReady + quantityCancelledDispatched;

  const quantityReadyAvailable = Math.max(0, quantityReadyTotal - quantityDispatchedTotal - quantityCancelledReady);
  const quantityDispatchedAvailable = Math.max(0, quantityDispatchedTotal - quantityCancelledDispatched);
  const quantityPendingPrepare = Math.max(0, quantityOrdered - quantityReadyTotal - quantityCancelledPending);

  return {
    quantityOrdered,
    quantityReadyTotal,
    quantityReadyAvailable,
    quantityDispatchedTotal,
    quantityDispatchedAvailable,
    quantityCancelledPending,
    quantityCancelledReady,
    quantityCancelledDispatched,
    quantityCancelledTotal,
    quantityPendingPrepare,
  };
}

export function sumRowsByItem<Row extends Record<string, unknown>>(
  rows: Row[],
  itemIdKey: keyof Row,
  quantityKey: keyof Row,
  predicate?: (row: Row) => boolean,
) {
  const map: Record<string, number> = {};

  for (const row of rows) {
    if (predicate && !predicate(row)) continue;

    const itemId = String(row[itemIdKey] ?? "");
    if (!itemId) continue;

    map[itemId] = (map[itemId] ?? 0) + asInt(row[quantityKey]);
  }

  return map;
}

export interface OrderOperationalSnapshotRow {
  order_id: string;
  order_item_id: string;
  description_snapshot: string;
  item_status: string;
  unit_price: number | string | null;
  quantity_ordered: number;
  quantity_paid: number;
  quantity_ready_total: number;
  quantity_ready_available: number;
  quantity_dispatched_total: number;
  quantity_dispatched_available: number;
  quantity_cancelled_pending: number;
  quantity_cancelled_ready: number;
  quantity_cancelled_dispatched: number;
  quantity_cancelled_total: number;
  quantity_pending_prepare: number;
}

export interface OperationalMaps {
  readyMap: Record<string, number>;
  dispatchedTotalMap: Record<string, number>;
  dispatchedAvailableMap: Record<string, number>;
  cancelledPendingMap: Record<string, number>;
  cancelledReadyMap: Record<string, number>;
  cancelledDispatchedMap: Record<string, number>;
  cancelledTotalMap: Record<string, number>;
}

export async function fetchOperationalMapsForOrders(orderIds: string[]): Promise<OperationalMaps> {
  if (orderIds.length === 0) {
    return {
      readyMap: {},
      dispatchedTotalMap: {},
      dispatchedAvailableMap: {},
      cancelledPendingMap: {},
      cancelledReadyMap: {},
      cancelledDispatchedMap: {},
      cancelledTotalMap: {},
    };
  }

  try {
    const snapshots = await Promise.all(
      [...new Set(orderIds)].map(async (orderId) => {
        const { data, error } = await (supabase as any).rpc("get_order_operational_snapshot", {
          p_order_id: orderId,
        });
        if (error) throw error;
        return (data ?? []) as OrderOperationalSnapshotRow[];
      }),
    );

    const rows = snapshots.flat();

    return {
      readyMap: sumRowsByItem(rows, "order_item_id", "quantity_ready_total"),
      dispatchedTotalMap: sumRowsByItem(rows, "order_item_id", "quantity_dispatched_total"),
      dispatchedAvailableMap: sumRowsByItem(rows, "order_item_id", "quantity_dispatched_available"),
      cancelledPendingMap: sumRowsByItem(rows, "order_item_id", "quantity_cancelled_pending"),
      cancelledReadyMap: sumRowsByItem(rows, "order_item_id", "quantity_cancelled_ready"),
      cancelledDispatchedMap: sumRowsByItem(rows, "order_item_id", "quantity_cancelled_dispatched"),
      cancelledTotalMap: sumRowsByItem(rows, "order_item_id", "quantity_cancelled_total"),
    };
  } catch {
    return {
      readyMap: {},
      dispatchedTotalMap: {},
      dispatchedAvailableMap: {},
      cancelledPendingMap: {},
      cancelledReadyMap: {},
      cancelledDispatchedMap: {},
      cancelledTotalMap: {},
    };
  }
}
