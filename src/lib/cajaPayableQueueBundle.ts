import { supabase } from "@/integrations/supabase/client";
import type { OperationalMaps } from "@/lib/orderOperational";

export type CajaPayableQueueBundle = {
  orders: any[];
  items: Array<{
    id: string;
    order_id: string;
    product_id?: string | null;
    description_snapshot?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    total?: number | null;
    status?: string | null;
    paid_at?: string | null;
    tray_item_type?: "A" | "B" | "C" | null;
    tray_container_cost?: number | null;
    cantidad_especial?: number | null;
    quantity_paid?: number;
    quantity_ready_total?: number;
    quantity_dispatched_total?: number;
    quantity_cancelled_pending?: number;
    quantity_cancelled_ready?: number;
    quantity_cancelled_dispatched?: number;
    quantity_cancelled_total?: number;
  }>;
  tables: Array<{ id: string; name: string; visual_order?: number | null }>;
  splits: Array<{ id: string; split_code: string }>;
  profiles: Array<{
    id: string;
    first_name?: string | null;
    full_name?: string | null;
    username?: string | null;
    alias?: string | null;
    email?: string | null;
  }>;
  clientes: Array<{
    id: string;
    cedula?: string | null;
    nombres?: string | null;
    apellidos?: string | null;
  }>;
  menu_nodes: Array<{
    id: string;
    legacy_product_id: string | null;
    image_url?: string | null;
    icon?: string | null;
  }>;
  payments_total_by_order: Array<{ order_id: string; amount: number }>;
};

const EMPTY_BUNDLE: CajaPayableQueueBundle = {
  orders: [],
  items: [],
  tables: [],
  splits: [],
  profiles: [],
  clientes: [],
  menu_nodes: [],
  payments_total_by_order: [],
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeCajaPayableQueueBundle(raw: unknown): CajaPayableQueueBundle {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BUNDLE };
  const row = raw as Record<string, unknown>;
  return {
    orders: asArray(row.orders),
    items: asArray(row.items),
    tables: asArray(row.tables),
    splits: asArray(row.splits),
    profiles: asArray(row.profiles),
    clientes: asArray(row.clientes),
    menu_nodes: asArray(row.menu_nodes),
    payments_total_by_order: asArray(row.payments_total_by_order),
  };
}

export async function fetchCajaPayableQueueBundle(
  branchId: string,
  shiftId: string,
): Promise<CajaPayableQueueBundle> {
  const { data, error } = await (supabase as any).rpc("get_caja_payable_queue_bundle", {
    p_branch_id: branchId,
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return normalizeCajaPayableQueueBundle(data);
}

export function operationalMapsFromCajaBundleItems(
  items: CajaPayableQueueBundle["items"],
): OperationalMaps {
  const readyMap: Record<string, number> = {};
  const readyAvailableMap: Record<string, number> = {};
  const dispatchedTotalMap: Record<string, number> = {};
  const dispatchedAvailableMap: Record<string, number> = {};
  const paidMap: Record<string, number> = {};
  const cancelledPendingMap: Record<string, number> = {};
  const cancelledReadyMap: Record<string, number> = {};
  const cancelledDispatchedMap: Record<string, number> = {};
  const cancelledTotalMap: Record<string, number> = {};

  for (const item of items) {
    const id = String(item.id ?? "");
    if (!id) continue;
    const ready = Number(item.quantity_ready_total ?? 0);
    const dispatched = Number(item.quantity_dispatched_total ?? 0);
    const cancelledPending = Number(item.quantity_cancelled_pending ?? 0);
    const cancelledReady = Number(item.quantity_cancelled_ready ?? 0);
    const cancelledDispatched = Number(item.quantity_cancelled_dispatched ?? 0);
    const ordered = Number(item.quantity ?? 0);
    const readyEffective = Math.max(ready, dispatched);
    const pendingPrepare = Math.max(0, ordered - readyEffective - cancelledPending);
    const readyAvail = Math.max(0, readyEffective - dispatched - cancelledReady);

    readyMap[id] = ready;
    readyAvailableMap[id] = readyAvail;
    dispatchedTotalMap[id] = dispatched;
    dispatchedAvailableMap[id] = Math.max(0, pendingPrepare + readyAvail);
    paidMap[id] = Number(item.quantity_paid ?? 0);
    cancelledPendingMap[id] = cancelledPending;
    cancelledReadyMap[id] = cancelledReady;
    cancelledDispatchedMap[id] = cancelledDispatched;
    cancelledTotalMap[id] = Number(item.quantity_cancelled_total ?? cancelledPending + cancelledReady + cancelledDispatched);
  }

  return {
    readyMap,
    readyAvailableMap,
    dispatchedTotalMap,
    dispatchedAvailableMap,
    paidMap,
    cancelledPendingMap,
    cancelledReadyMap,
    cancelledDispatchedMap,
    cancelledTotalMap,
  };
}

export function paidQtyMapFromCajaBundleItems(
  items: CajaPayableQueueBundle["items"],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items) {
    const id = String(item.id ?? "");
    if (!id) continue;
    const qty = Number(item.quantity_paid ?? 0);
    if (qty > 0) map[id] = qty;
  }
  return map;
}

export function paymentsTotalMapFromCajaBundle(
  rows: CajaPayableQueueBundle["payments_total_by_order"],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows ?? []) {
    if (!row?.order_id) continue;
    map[row.order_id] = Number(row.amount ?? 0);
  }
  return map;
}
