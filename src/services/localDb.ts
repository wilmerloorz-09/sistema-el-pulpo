import Dexie, { type Table } from "dexie";

/**
 * Local IndexedDB schema mirroring Supabase tables.
 * Used for offline-first caching and sync queue.
 */

export interface LocalRecord {
  _local_id?: number; // Auto-incremented local PK
  _sync_status: "synced" | "pending_create" | "pending_update" | "pending_delete";
  _synced_at: string | null;
  _local_updated_at: string;
}

// ─── Catalog tables (read-only cache) ───────────────────────────
export interface LocalCategory extends LocalRecord {
  id: string;
  description: string;
  branch_id: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalSubcategory extends LocalRecord {
  id: string;
  category_id: string;
  description: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalProduct extends LocalRecord {
  id: string;
  description: string;
  subcategory_id: string;
  unit_price: number | null;
  price_mode: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalModifier extends LocalRecord {
  id: string;
  description: string;
  branch_id: string;
  is_active: boolean;
  created_at: string;
}

export interface LocalRestaurantTable extends LocalRecord {
  id: string;
  name: string;
  branch_id: string;
  visual_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalDenomination extends LocalRecord {
  id: string;
  label: string;
  value: number;
  branch_id: string;
  display_order: number;
  is_active: boolean;
}

export interface LocalPaymentMethod extends LocalRecord {
  id: string;
  name: string;
  branch_id: string;
  is_active: boolean;
  created_at: string;
}

// ─── Operational tables (read + write offline) ──────────────────
export interface LocalOrder extends LocalRecord {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: string;
  status: string;
  table_id: string | null;
  split_id: string | null;
  branch_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LocalOrderItem extends LocalRecord {
  id: string;
  order_id: string;
  product_id: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
  dispatched_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface LocalPayment extends LocalRecord {
  id: string;
  order_id: string;
  payment_method_id: string;
  amount: number;
  created_by: string;
  notes: string | null;
  created_at: string;
}

export interface LocalOrderItemModifier extends LocalRecord {
  id: string;
  order_item_id: string;
  modifier_id: string;
}

export interface LocalCashShift extends LocalRecord {
  id: string;
  branch_id: string;
  cashier_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface LocalCashShiftDenom extends LocalRecord {
  id: string;
  shift_id: string;
  denomination_id: string;
  qty_initial: number;
  qty_current: number;
}

export interface LocalCashMovement extends LocalRecord {
  id: string;
  shift_id: string;
  movement_type: string;
  denomination_id: string | null;
  qty_delta: number;
  payment_id: string | null;
  created_at: string;
}

// ─── Sync queue for tracking pending operations ─────────────────
export interface SyncQueueEntry {
  _local_id?: number;
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}

// ─── Database class ─────────────────────────────────────────────
class PosLocalDB extends Dexie {
  categories!: Table<LocalCategory>;
  subcategories!: Table<LocalSubcategory>;
  products!: Table<LocalProduct>;
  modifiers!: Table<LocalModifier>;
  restaurant_tables!: Table<LocalRestaurantTable>;
  denominations!: Table<LocalDenomination>;
  payment_methods!: Table<LocalPaymentMethod>;
  orders!: Table<LocalOrder>;
  order_items!: Table<LocalOrderItem>;
  order_item_modifiers!: Table<LocalOrderItemModifier>;
  payments!: Table<LocalPayment>;
  cash_shifts!: Table<LocalCashShift>;
  cash_shift_denoms!: Table<LocalCashShiftDenom>;
  cash_movements!: Table<LocalCashMovement>;
  sync_queue!: Table<SyncQueueEntry>;

  constructor() {
    super("pos_local_db");

    this.version(1).stores({
      // Catalog (cached, indexed by id and branch_id)
      categories: "id, branch_id, _sync_status",
      subcategories: "id, category_id, _sync_status",
      products: "id, subcategory_id, _sync_status",
      modifiers: "id, branch_id, _sync_status",
      restaurant_tables: "id, branch_id, _sync_status",
      denominations: "id, branch_id, _sync_status",
      payment_methods: "id, branch_id, _sync_status",

      // Operational (full CRUD offline)
      orders: "id, branch_id, status, _sync_status",
      order_items: "id, order_id, _sync_status",
      order_item_modifiers: "id, order_item_id, _sync_status",
      payments: "id, order_id, _sync_status",
      cash_shifts: "id, branch_id, status, _sync_status",
      cash_shift_denoms: "id, shift_id, _sync_status",
      cash_movements: "id, shift_id, _sync_status",

      // Sync queue
      sync_queue: "++_local_id, table_name, record_id, operation",
    });
  }
}

export const localDb = new PosLocalDB();
