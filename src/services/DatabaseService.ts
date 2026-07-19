import { supabase } from "@/integrations/supabase/client";
import { localDb, type SyncQueueEntry } from "./localDb";
import type { Table as DexieTable } from "dexie";
import { generateUUID } from "@/lib/uuid";
export { supabase };

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
  | "operational_losses"
  | "table_splits"
  | "menu_nodes"
  | "order_cancellations"
  | "branches"
  | "cash_shift_users"
  | "payment_capture_requests"
  | "profiles"
  | "user_roles"
  | "user_branches"
  | "order_item_cancellations"
  | "system_settings"
  | "cash_register_templates"
  | "cash_register_template_denoms"
  | "menu_node_modifiers"
  | "profiles"
  | "branches"
  | "clientes"
  | "campanas_promocionales"
  | "predicciones_clientes"
  | "permisos_promociones_turnos"
  | "bancos";

const CATALOG_TABLES: TableName[] = [
  "categories",
  "subcategories",
  "products",
  "modifiers",
  "restaurant_tables",
  "denominations",
  "payment_methods",
  "cash_register_templates",
  "cash_register_template_denoms",
];

function getDexieTable(table: TableName): DexieTable | undefined {
  return (localDb as any)[table] as DexieTable | undefined;
}

function nowISO() {
  return new Date().toISOString();
}

// ─── READ Operations ────────────────────────────────────────────

interface QueryOptions {
  select?: string;
  filters?: Array<{ column: string; op: "eq" | "in" | "is" | "neq" | "gte" | "lte"; value: any }>;
  orderBy?: { column: string; ascending?: boolean };
  branchId?: string | null;
  /** No escribir en IndexedDB tras leer (pagos y lecturas calientes = menos bloqueo del hilo principal). */
  skipLocalCache?: boolean;
}

/**
 * Fetch data with offline fallback.
 * Online → fetch from Supabase, cache locally, return.
 * Offline → return from IndexedDB cache.
 */
/** Envuelve una promesa con un timeout; rechaza si supera el límite. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[DatabaseService] Timeout (${ms}ms) en ${label}`)), ms)
    ),
  ]);
}

export async function dbSelect<T = any>(
  table: TableName,
  options: QueryOptions = {}
): Promise<T[]> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    try {
      return await withTimeout(fetchFromSupabase<T>(table, options), 12_000, `fetchFromSupabase(${table})`);
    } catch (error) {
      console.warn(`[DatabaseService] Supabase fetch failed for ${table}, falling back to cache:`, error);
      try {
        return await withTimeout(fetchFromLocal<T>(table, options), 3_000, `fetchFromLocal(${table}) fallback`);
      } catch (localError) {
        console.error(`[DatabaseService] Local fallback also failed for ${table}:`, localError);
        return [];
      }
    }
  }

  try {
    return await withTimeout(fetchFromLocal<T>(table, options), 3_000, `fetchFromLocal(${table}) offline`);
  } catch (err) {
    console.error(`[DatabaseService] Offline local fetch failed for ${table}:`, err);
    return [];
  }
}

/**
 * Lectura estricta: siempre red, sin fallback a cache local.
 * Si la red falla o supera el timeout, LANZA el error para que React Query
 * conserve los ultimos datos buenos y reintente (modulos operativos como
 * Despacho/Servir no deben renderizar datos viejos del cache como actuales).
 */
export async function dbSelectStrict<T = any>(
  table: TableName,
  options: QueryOptions = {}
): Promise<T[]> {
  return withTimeout(fetchFromSupabase<T>(table, options), 12_000, `dbSelectStrict(${table})`);
}

async function fetchFromSupabase<T>(table: TableName, options: QueryOptions): Promise<T[]> {
  let selectClause = options.select ?? "*";

  let query = supabase.from(table as any).select(selectClause);

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
        case "gte":
          query = query.gte(f.column, f.value);
          break;
        case "lte":
          query = query.lte(f.column, f.value);
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
  if (!dexieTable) return;

  const now = nowISO();
  const enriched = records.map((r) => {
    if (import.meta.env.DEV && !r.id) {
      throw new Error(`[DatabaseService] Intento de cachear registro en ${table} sin llave primaria (id). Asegúrate de incluir 'id' en tu select.`);
    }
    return {
      ...r,
      _sync_status: "synced" as const,
      _synced_at: now,
      _local_updated_at: now,
    };
  });

  // For catalog tables, replace all cached records for this branch
  if (CATALOG_TABLES.includes(table)) {
    await localDb.transaction("rw", dexieTable, async () => {
      // Delete old cached records for this branch
      if (branchId) { await dexieTable.where("branch_id").equals(branchId).delete(); }
      else { await dexieTable.clear(); }
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
  if (!dexieTable) return [];

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
        case "gte":
          results = results.filter((r: any) => r[f.column] >= f.value);
          break;
        case "lte":
          results = results.filter((r: any) => r[f.column] <= f.value);
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

export interface DbWriteHotPathOptions {
  /**
   * Sin .select() ni escritura Dexie: menos latencia en cobros (id y columnas deben venir en `record`).
   */
  hotPath?: boolean;
}

/**
 * Insert a record. Online → Supabase + cache. Offline → IndexedDB + sync queue.
 */
export async function dbInsert<T = any>(
  table: TableName,
  record: Partial<T>,
  options: DbWriteHotPathOptions = {},
): Promise<T> {
  const isOnline = navigator.onLine;

  if (isOnline) {
    if (options.hotPath) {
      const { error } = await supabase.from(table as any).insert(record as any);
      if (error) throw error;
      return record as T;
    }

    const { data, error } = await supabase
      .from(table as any)
      .insert(record as any)
      .select()
      .single();
    if (error) throw error;

    // Cache locally
    const dexieTable = getDexieTable(table);
    if (dexieTable) {
      await dexieTable.put({
        ...(data as unknown as Record<string, unknown>),
        _sync_status: "synced",
        _synced_at: nowISO(),
        _local_updated_at: nowISO(),
      });
    }

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
  if (!dexieTable) {
    // If no local support, we can't really do "offline" insert as there is no queue or table.
    // In this case, we'll have to error out or handle as online-required.
    // For now, let's throw to be safe, but ideally these tables shouldn't be used offline.
    throw new Error(`Table ${table} does not support offline operations.`);
  }

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

/** Insert varias filas en una sola peticion a Supabase y un bulkPut en Dexie (menos latencia que N dbInsert). */
export async function dbInsertMany<T = any>(
  table: TableName,
  records: Partial<T>[],
  options: DbWriteHotPathOptions = {},
): Promise<T[]> {
  if (records.length === 0) return [];

  const isOnline = navigator.onLine;
  if (!isOnline) {
    const out: T[] = [];
    for (const rec of records) {
      out.push(await dbInsert(table, rec, options));
    }
    return out;
  }

  if (options.hotPath) {
    const { error } = await supabase.from(table as any).insert(records as any[]);
    if (error) throw error;
    return records as T[];
  }

  const { data, error } = await supabase.from(table as any).insert(records as any[]).select();
  if (error) throw error;

  const rows = (data ?? []) as T[];
  const dexieTable = getDexieTable(table);
  if (dexieTable && rows.length > 0) {
    const ts = nowISO();
    await dexieTable.bulkPut(
      rows.map((r) => ({
        ...(r as unknown as Record<string, unknown>),
        _sync_status: "synced",
        _synced_at: ts,
        _local_updated_at: ts,
      })),
    );
  }

  return rows;
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
    if (dexieTable) {
      await dexieTable.update(id, {
        ...updates,
        _sync_status: "synced",
        _synced_at: nowISO(),
        _local_updated_at: nowISO(),
      });
    }
    return;
  }

  // Offline
  const dexieTable = getDexieTable(table);
  if (!dexieTable) throw new Error(`Table ${table} does not support offline operations.`);

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
    const { error } = await supabase.from(table as any).upsert(record as any, { onConflict: "id" });
    if (error) throw error;

    if (record.id) {
      const dexieTable = getDexieTable(table);
      if (dexieTable) {
        await dexieTable.put({
          ...record,
          _sync_status: "synced",
          _synced_at: nowISO(),
          _local_updated_at: nowISO(),
        });
      }
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
    if (dexieTable) {
      await dexieTable.delete(id);
    }
    return;
  }

  // Offline
  const dexieTable = getDexieTable(table);
  if (!dexieTable) throw new Error(`Table ${table} does not support offline operations.`);

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
  orderNumber: number | null,
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
  orderNumber: number | null,
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








