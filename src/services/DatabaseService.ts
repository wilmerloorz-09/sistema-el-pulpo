/**
 * DatabaseService – Abstraction layer for data access.
 *
 * Phase 1: Read-through cache.
 *   - READ: Try Supabase first (if online), cache result locally. Fallback to IndexedDB.
 *   - WRITE: Pass-through to Supabase (offline writes come in Phase 2).
 *
 * Components should NEVER call supabase.from() directly for operational data.
 */

import { supabase } from "@/integrations/supabase/client";
import { localDb, type SyncQueueEntry } from "./localDb";
import type { Table as DexieTable } from "dexie";
import { generateUUID } from "@/lib/uuid";

type TableName =
  | "categories"
  | "subcategories"
  | "products"
  | "modifiers"
  | "restaurant_tables"
  | "denominations"
  | "payment_methods"
  | "orders"
  | "order_items"
  | "order_item_modifiers"
  | "payments"
  | "payment_items"
  | "cash_shifts"
  | "cash_shift_denoms"
  | "cash_movements"
  | "kitchen_notifications"
  | "operational_losses";

const CATALOG_TABLES: TableName[] = [
  "categories",
  "subcategories",
  "products",
  "modifiers",
  "restaurant_tables",
  "denominations",
  "payment_methods",
];

function getDexieTable(table: TableName): DexieTable {
  return (localDb as any)[table];
}

function nowISO() {
  return new Date().toISOString();
}

// ─── READ Operations ────────────────────────────────────────────

interface QueryOptions {
  select?: string;
  filters?: Array<{ column: string; op: "eq" | "in" | "is" | "neq"; value: any }>;
  orderBy?: { column: string; ascending?: boolean };
  branchId?: string | null;
}

/**
 * Fetch data with offline fallback.
 * Online → fetch from Supabase, cache locally, return.
 * Offline → return from IndexedDB cache.
 */
export async function dbSelect<T = any>(
  table: TableName,
  options: QueryOptions = {}
): Promise<T[]> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    try {
      const result = await fetchFromSupabase<T>(table, options);
      // Cache locally (replace all for this branch if catalog)
      await cacheLocally(table, result as any[], options.branchId);
      return result;
    } catch (error) {
      console.warn(`[DatabaseService] Supabase fetch failed for ${table}, falling back to cache`, error);
      return fetchFromLocal<T>(table, options);
    }
  }

  return fetchFromLocal<T>(table, options);
}

async function fetchFromSupabase<T>(table: TableName, options: QueryOptions): Promise<T[]> {
  let query = supabase.from(table as any).select(options.select ?? "*");

  if (options.branchId) {
    query = query.eq("branch_id", options.branchId);
  }

  if (options.filters) {
    for (const f of options.filters) {
      switch (f.op) {
        case "eq":
          query = query.eq(f.column, f.value);
          break;
        case "in":
          query = query.in(f.column, f.value);
          break;
        case "is":
          query = query.is(f.column, f.value);
          break;
        case "neq":
          query = query.neq(f.column, f.value);
          break;
      }
    }
  }

  if (options.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: options.orderBy.ascending ?? true,
    });
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as T[];
}

async function cacheLocally(table: TableName, records: any[], branchId?: string | null) {
  const dexieTable = getDexieTable(table);
  const now = nowISO();

  const enriched = records.map((r) => ({
    ...r,
    _sync_status: "synced" as const,
    _synced_at: now,
    _local_updated_at: now,
  }));

  // For catalog tables, replace all cached records for this branch
  if (CATALOG_TABLES.includes(table) && branchId) {
    await localDb.transaction("rw", dexieTable, async () => {
      // Delete old cached records for this branch
      await dexieTable.where("branch_id").equals(branchId).delete();
      // Bulk insert new data
      if (enriched.length > 0) {
        await dexieTable.bulkPut(enriched);
      }
    });
  } else {
    // For operational tables, upsert
    if (enriched.length > 0) {
      await dexieTable.bulkPut(enriched);
    }
  }
}

async function fetchFromLocal<T>(table: TableName, options: QueryOptions): Promise<T[]> {
  const dexieTable = getDexieTable(table);

  let collection = dexieTable.toCollection();

  // Apply branch filter if present
  if (options.branchId) {
    collection = dexieTable.where("branch_id").equals(options.branchId);
  }

  // Apply simple eq filters
  let results = await collection.toArray();

  if (options.filters) {
    for (const f of options.filters) {
      switch (f.op) {
        case "eq":
          results = results.filter((r: any) => r[f.column] === f.value);
          break;
        case "neq":
          results = results.filter((r: any) => r[f.column] !== f.value);
          break;
        case "in":
          results = results.filter((r: any) => (f.value as any[]).includes(r[f.column]));
          break;
        case "is":
          results = results.filter((r: any) => r[f.column] === f.value);
          break;
      }
    }
  }

  // Sort
  if (options.orderBy) {
    const { column, ascending = true } = options.orderBy;
    results.sort((a: any, b: any) => {
      if (a[column] < b[column]) return ascending ? -1 : 1;
      if (a[column] > b[column]) return ascending ? 1 : -1;
      return 0;
    });
  }

  // Strip local metadata before returning
  return results.map(stripLocalMeta) as T[];
}

function stripLocalMeta(record: any) {
  const { _local_id, _sync_status, _synced_at, _local_updated_at, ...rest } = record;
  return rest;
}

// ─── WRITE Operations (Phase 1: online-only, Phase 2: offline support) ──

/**
 * Insert a record. Online → Supabase + cache. Offline → IndexedDB + sync queue.
 */
export async function dbInsert<T = any>(
  table: TableName,
  record: Partial<T>
): Promise<T> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    const { data, error } = await supabase
      .from(table as any)
      .insert(record as any)
      .select()
      .single();
    if (error) throw error;

    // Cache locally
    const dexieTable = getDexieTable(table);
    await dexieTable.put({
      ...(data as unknown as Record<string, unknown>),
      _sync_status: "synced",
      _synced_at: nowISO(),
      _local_updated_at: nowISO(),
    });

    return data as T;
  }

  // Offline: save locally with pending status
  const id = (record as any).id || generateUUID();
  const localRecord = {
    ...record,
    id,
    _sync_status: "pending_create" as const,
    _synced_at: null,
    _local_updated_at: nowISO(),
  };

  const dexieTable = getDexieTable(table);
  await dexieTable.put(localRecord);

  // Add to sync queue
  await localDb.sync_queue.add({
    table_name: table,
    record_id: id,
    operation: "INSERT",
    payload: record as Record<string, unknown>,
    created_at: nowISO(),
    retry_count: 0,
    last_error: null,
  });

  return { ...record, id } as T;
}

/**
 * Update a record.
 */
export async function dbUpdate<T = any>(
  table: TableName,
  id: string,
  updates: Partial<T>
): Promise<void> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    const { error } = await supabase
      .from(table as any)
      .update(updates as any)
      .eq("id", id);
    if (error) throw error;

    // Update local cache
    const dexieTable = getDexieTable(table);
    await dexieTable.update(id, {
      ...updates,
      _sync_status: "synced",
      _synced_at: nowISO(),
      _local_updated_at: nowISO(),
    });
    return;
  }

  // Offline
  const dexieTable = getDexieTable(table);
  const existing = await dexieTable.get(id);
  const currentStatus = existing?._sync_status;

  await dexieTable.update(id, {
    ...updates,
    _sync_status: currentStatus === "pending_create" ? "pending_create" : "pending_update",
    _local_updated_at: nowISO(),
  });

  if (currentStatus !== "pending_create") {
    await localDb.sync_queue.add({
      table_name: table,
      record_id: id,
      operation: "UPDATE",
      payload: updates as Record<string, unknown>,
      created_at: nowISO(),
      retry_count: 0,
      last_error: null,
    });
  }
}

/**
 * Upsert a record (for backward compatibility with useCrud).
 */
export async function dbUpsert<T = any>(
  table: TableName,
  record: Partial<T> & { id?: string }
): Promise<void> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    const { error } = await supabase.from(table as any).upsert(record as any);
    if (error) throw error;

    if (record.id) {
      const dexieTable = getDexieTable(table);
      await dexieTable.put({
        ...record,
        _sync_status: "synced",
        _synced_at: nowISO(),
        _local_updated_at: nowISO(),
      });
    }
    return;
  }

  // Offline upsert
  const id = record.id || generateUUID();
  const dexieTable = getDexieTable(table);
  const existing = await dexieTable.get(id);

  if (existing) {
    await dbUpdate(table, id, record);
  } else {
    await dbInsert(table, { ...record, id });
  }
}

/**
 * Delete a record.
 */
export async function dbDelete(table: TableName, id: string): Promise<void> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    const { error } = await supabase.from(table as any).delete().eq("id", id);
    if (error) throw error;

    const dexieTable = getDexieTable(table);
    await dexieTable.delete(id);
    return;
  }

  // Offline
  const dexieTable = getDexieTable(table);
  const existing = await dexieTable.get(id);

  if (existing?._sync_status === "pending_create") {
    // Never synced, just delete locally
    await dexieTable.delete(id);
    // Remove from sync queue
    await localDb.sync_queue
      .where({ table_name: table, record_id: id })
      .delete();
  } else {
    // Mark for deletion
    await dexieTable.update(id, {
      _sync_status: "pending_delete",
      _local_updated_at: nowISO(),
    });
    await localDb.sync_queue.add({
      table_name: table,
      record_id: id,
      operation: "DELETE",
      payload: {},
      created_at: nowISO(),
      retry_count: 0,
      last_error: null,
    });
  }
}

// ─── Direct Supabase passthrough (for complex queries not yet abstracted) ──

/**
 * Cancel an order item with all required metadata.
 */
export async function cancelOrderItem(
  itemId: string,
  cancellationData: {
    status: string; // Current status before cancellation
    reason: string;
    notes?: string;
    cancelledBy: string;
    fromStatus: string; // The status it was cancelled from (DRAFT, SENT, DISPATCHED)
  }
): Promise<void> {
  const now = new Date().toISOString();
  
  const updates = {
    status: "CANCELLED",
    cancelled_at: now,
    cancelled_by: cancellationData.cancelledBy,
    cancellation_reason: cancellationData.reason,
    cancelled_from_status: cancellationData.fromStatus,
  };

  await dbUpdate("order_items", itemId, updates);
}

/**
 * Record an operational loss when an item is cancelled from DISPATCHED status.
 */
export async function recordOperationalLoss(
  orderId: string,
  itemId: string,
  amount: number,
  reason: string,
  cancelledBy: string,
  branchId: string
): Promise<void> {
  await dbInsert("operational_losses", {
    order_id: orderId,
    order_item_id: itemId,
    amount,
    reason,
    cancelled_by: cancelledBy,
    branch_id: branchId,
  });
}

/**
 * Send a real-time notification to the kitchen about a cancelled item.
 */
export async function notifyKitchenItemCancelled(
  orderId: string,
  orderNumber: number,
  itemId: string,
  description: string,
  quantity: number,
  reason: string,
  branchId: string
): Promise<void> {
  const message = `🚫 Item cancelado: ${quantity}x ${description} - Razon: ${reason}`;
  
  await dbInsert("kitchen_notifications", {
    type: "ITEM_CANCELLED",
    order_id: orderId,
    order_number: orderNumber,
    order_item_id: itemId,
    message,
    branch_id: branchId,
  });
}

/**
 * Send a real-time notification to the kitchen about a cancelled order.
 */
export async function notifyKitchenOrderCancelled(
  orderId: string,
  orderNumber: number,
  itemCount: number,
  reason: string,
  branchId: string
): Promise<void> {
  const message = `🚫 Orden CANCELADA: ${itemCount} item(s) - Razon: ${reason}`;
  
  await dbInsert("kitchen_notifications", {
    type: "ORDER_CANCELLED",
    order_id: orderId,
    order_number: orderNumber,
    message,
    branch_id: branchId,
  });
}

/**
 * Update order's cancelled status and metadata after full order cancellation.
 */
export async function cancelOrderFull(
  orderId: string,
  cancellationData: {
    reason: string;
    notes?: string;
    cancelledBy: string;
    fromStatus: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  
  const updates = {
    status: "CANCELLED",
    cancelled_at: now,
    cancelled_by: cancellationData.cancelledBy,
    cancellation_reason: cancellationData.reason,
    cancelled_from_status: cancellationData.fromStatus,
  };

  await dbUpdate("orders", orderId, updates);
}

/**
 * Recalculate order total by summing non-cancelled items.
 */
export async function recalculateOrderTotal(orderId: string): Promise<number> {
  const items = await dbSelect(
    "order_items",
    {
      select: "id, total, status",
      filters: [
        { column: "order_id", op: "eq", value: orderId },
        { column: "status", op: "neq", value: "CANCELLED" },
      ],
    }
  );

  const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.total || 0), 0);
  
  await dbUpdate("orders", orderId, { total });
  
  return total;
}

export { supabase } from "@/integrations/supabase/client";






