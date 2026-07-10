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
  const quantityDispatchedTotal = asInt(input.quantityDispatchedTotal);
  // Ensure that items directly dispatched are conceptually considered ready
  const quantityReadyTotal = Math.max(asInt(input.quantityReadyTotal), quantityDispatchedTotal);
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

/** Unidades pedidas que aún no fueron despachadas (neto de cancelaciones). */
export function computeUndispatchedQuantity(quantities: OperationalQuantitySnapshot): number {
  const activeOrdered = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
  return Math.max(0, activeOrdered - quantities.quantityDispatchedAvailable);
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
  quantity_dispatched_total?: number | null;
  quantity_dispatched_available?: number | null;
  quantity_dispatched?: number | null;
  quantity_cancelled_pending: number;
  quantity_cancelled_ready: number;
  quantity_cancelled_dispatched?: number | null;
  quantity_cancelled_total: number;
  quantity_pending_prepare: number;
}

function normalizeSnapshotRow(row: OrderOperationalSnapshotRow) {
  const quantityDispatchedTotal = asInt(
    row.quantity_dispatched_total ?? row.quantity_dispatched ?? 0,
  );
  const quantityCancelledPending = asInt(row.quantity_cancelled_pending);
  const quantityCancelledReady = asInt(row.quantity_cancelled_ready);
  const quantityCancelledDispatched = asInt(row.quantity_cancelled_dispatched ?? 0);
  const quantityCancelledTotal = asInt(row.quantity_cancelled_total);

  return {
    ...row,
    quantity_dispatched_total: quantityDispatchedTotal,
    quantity_dispatched_available: asInt(
      row.quantity_dispatched_available ?? Math.max(0, quantityDispatchedTotal - quantityCancelledDispatched),
    ),
    quantity_cancelled_pending: quantityCancelledPending,
    quantity_cancelled_ready: quantityCancelledReady,
    quantity_cancelled_dispatched: quantityCancelledDispatched,
    quantity_cancelled_total:
      quantityCancelledTotal || quantityCancelledPending + quantityCancelledReady + quantityCancelledDispatched,
  };
}

export interface OperationalMaps {
  readyMap: Record<string, number>;
  readyAvailableMap: Record<string, number>;
  pendingPrepareMap: Record<string, number>;
  dispatchedTotalMap: Record<string, number>;
  dispatchedAvailableMap: Record<string, number>;
  paidMap: Record<string, number>;
  cancelledPendingMap: Record<string, number>;
  cancelledReadyMap: Record<string, number>;
  cancelledDispatchedMap: Record<string, number>;
  cancelledTotalMap: Record<string, number>;
}

export const EMPTY_OPERATIONAL_MAPS: OperationalMaps = {
  readyMap: {},
  readyAvailableMap: {},
  pendingPrepareMap: {},
  dispatchedTotalMap: {},
  dispatchedAvailableMap: {},
  paidMap: {},
  cancelledPendingMap: {},
  cancelledReadyMap: {},
  cancelledDispatchedMap: {},
  cancelledTotalMap: {},
};

export function normalizeSnapshotRows(rows: OrderOperationalSnapshotRow[]) {
  return rows.map(normalizeSnapshotRow);
}

export function buildOperationalMapsFromSnapshotRows(rows: OrderOperationalSnapshotRow[]): OperationalMaps {
  const normalizedRows = normalizeSnapshotRows(rows);

  return {
    readyMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_ready_total"),
    readyAvailableMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_ready_available"),
    pendingPrepareMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_pending_prepare"),
    dispatchedTotalMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_dispatched_total"),
    dispatchedAvailableMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_dispatched_available"),
    paidMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_paid"),
    cancelledPendingMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_cancelled_pending"),
    cancelledReadyMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_cancelled_ready"),
    cancelledDispatchedMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_cancelled_dispatched"),
    cancelledTotalMap: sumRowsByItem(normalizedRows, "order_item_id", "quantity_cancelled_total"),
  };
}

export async function fetchOperationalMapsForOrders(orderIds: string[]): Promise<OperationalMaps> {
  if (orderIds.length === 0) {
    return EMPTY_OPERATIONAL_MAPS;
  }

  const uniqueOrderIds = Array.from(new Set(orderIds));

  try {
    const { data, error } = await (supabase as any).rpc("get_orders_operational_snapshots", {
      p_order_ids: uniqueOrderIds,
    });
    if (!error) {
      return buildOperationalMapsFromSnapshotRows((data ?? []) as OrderOperationalSnapshotRow[]);
    }
  } catch {
    // Fallback si la migracion batch aun no esta aplicada.
  }

  const snapshots = await Promise.all(
    uniqueOrderIds.map(async (orderId) => {
      try {
        const { data, error } = await (supabase as any).rpc("get_order_operational_snapshot", {
          p_order_id: orderId,
        });
        if (error) throw error;
        return (data ?? []) as OrderOperationalSnapshotRow[];
      } catch (error) {
        console.warn("No se pudo cargar el snapshot operativo de la orden", orderId, error);
        return [] as OrderOperationalSnapshotRow[];
      }
    }),
  );

  return buildOperationalMapsFromSnapshotRows(snapshots.flat());
}
