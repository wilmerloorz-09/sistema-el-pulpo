import { supabase } from "@/integrations/supabase/client";
import type { OperationalMaps } from "@/lib/orderOperational";

export type DispatchServirQueueBundle = {
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
    tray_item_type?: "A" | "B" | "C" | null;
    tray_container_cost?: number | null;
    item_note?: string | null;
    sent_to_kitchen_at?: string | null;
    paid_at?: string | null;
    created_at?: string | null;
    cantidad_especial?: number | null;
    quantity_paid?: number;
    quantity_ready_total?: number;
    quantity_dispatched_total?: number;
    quantity_cancelled_pending?: number;
    quantity_cancelled_ready?: number;
    quantity_cancelled_dispatched?: number;
    quantity_cancelled_total?: number;
    quantity_pending_prepare?: number;
    quantity_ready_available?: number;
  }>;
  modifiers: Array<{ order_item_id: string; description: string }>;
  order_payment_flags: Array<{
    order_id: string;
    has_any_payment: boolean;
    has_active_payment: boolean;
    has_paid_line: boolean;
  }>;
  tables: Array<{ id: string; name: string }>;
  splits: Array<{ id: string; split_code: string }>;
  profiles: Array<{
    id: string;
    first_name?: string | null;
    full_name?: string | null;
    username?: string | null;
    alias?: string | null;
    email?: string | null;
  }>;
  packer_user_ids: string[];
  has_plate_servers: boolean;
};

const EMPTY_BUNDLE: DispatchServirQueueBundle = {
  orders: [],
  items: [],
  modifiers: [],
  order_payment_flags: [],
  tables: [],
  splits: [],
  profiles: [],
  packer_user_ids: [],
  has_plate_servers: false,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeDispatchServirQueueBundle(raw: unknown): DispatchServirQueueBundle {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BUNDLE };
  const row = raw as Record<string, unknown>;
  return {
    orders: asArray(row.orders),
    items: asArray(row.items),
    modifiers: asArray(row.modifiers),
    order_payment_flags: asArray(row.order_payment_flags),
    tables: asArray(row.tables),
    splits: asArray(row.splits),
    profiles: asArray(row.profiles),
    packer_user_ids: asArray<string>(row.packer_user_ids).filter(Boolean),
    has_plate_servers: Boolean(row.has_plate_servers),
  };
}

/** 1 RTT: datos de cola Despacho/Servir para un turno OPEN. */
export async function fetchDispatchServirQueueBundle(
  branchId: string,
  shiftId: string,
): Promise<DispatchServirQueueBundle> {
  const { data, error } = await (supabase as any).rpc("get_dispatch_servir_queue_bundle", {
    p_branch_id: branchId,
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return normalizeDispatchServirQueueBundle(data);
}

export function operationalMapsFromBundleItems(
  items: DispatchServirQueueBundle["items"],
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
    readyMap[id] = Number(item.quantity_ready_total ?? 0);
    readyAvailableMap[id] = Number(item.quantity_ready_available ?? 0);
    dispatchedTotalMap[id] = Number(item.quantity_dispatched_total ?? 0);
    const pending = Number(item.quantity_pending_prepare ?? 0);
    const readyAvail = Number(item.quantity_ready_available ?? 0);
    dispatchedAvailableMap[id] = Math.max(0, pending + readyAvail);
    paidMap[id] = Number(item.quantity_paid ?? 0);
    cancelledPendingMap[id] = Number(item.quantity_cancelled_pending ?? 0);
    cancelledReadyMap[id] = Number(item.quantity_cancelled_ready ?? 0);
    cancelledDispatchedMap[id] = Number(item.quantity_cancelled_dispatched ?? 0);
    cancelledTotalMap[id] = Number(item.quantity_cancelled_total ?? 0);
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

export function paidQtyMapFromBundleItems(
  items: DispatchServirQueueBundle["items"],
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
