import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { dbSelect, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { computeLineTotalWithContainer } from "@/lib/paymentQuantity";
import {
  buildOperationalMapsFromSnapshotRows,
  computeOperationalQuantities,
  computeUndispatchedQuantity,
  EMPTY_OPERATIONAL_MAPS,
  hasOrderItemOperationalProgress,
  normalizeSnapshotRows,
  type OrderOperationalSnapshotRow,
} from "@/lib/orderOperational";
import { buildUserDisplayMap, getUserDisplayName } from "@/lib/userDisplay";
import {
  getOpenCashShiftForBranch,
  orderBelongsToOpenCashShift,
  type OpenCashShift,
} from "@/lib/openCashShift";
// support CANCELLED status even if enum not yet updated locally
type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

interface OrderItem {
  id: string;
  product_id: string;
  description_snapshot: string;
  item_note?: string | null;
  quantity: number;
  quantity_requested?: number;
  quantity_ordered?: number;
  original_quantity?: number;
  cancelled_quantity?: number;
  quantity_paid?: number;
  unit_price: number;
  total: number;
  status: string;
  tray_item_type?: "A" | "B" | "C" | null;
  tray_container_cost?: number;
  quantity_sent?: number;
  quantity_ready_available?: number;
  quantity_dispatched?: number;
  quantity_remaining?: number;
  quantity_cancelled?: number;
  quantity_cancellable?: number;
  /** Unidades de la linea que forman parte del grupo especial (orden especial mixta). */
  cantidad_especial?: number;
  paid_at?: string | null;
  modifiers: { id: string; modifier_id: string; description: string }[];
}

export function isTemporaryOrderItemId(itemId: string | null | undefined) {
  return String(itemId ?? "").startsWith("temp-");
}

export interface SiblingOrder {
  id: string;
  order_number: number | null;
  order_code: string | null;
  status?: string | null;
  closed_at?: string | null;
  created_by_name?: string | null;
  split_code: string | null;
  table_order_position: number | null;
  /** ISO; usado para ordenar pestañas (mas antigua a la izquierda, nueva al final). */
  created_at?: string | null;
  item_count: number;
  total?: number;
  table_name_snapshot?: string | null;
  /** Lineas para vista previa en tarjetas de seleccion de orden (cantidad + descripcion). */
  item_preview_lines?: Array<{ quantity: number; description: string }>;
}

/** Texto compacto para tarjetas de mesa: cantidad + descripcion (snapshot). */
export function buildItemPreviewLinesForTableCard(
  items: Array<{
    quantity?: number;
    quantity_ordered?: number;
    description_snapshot?: string;
    status?: string | null;
  }>,
  descriptionMaxLen = 36,
): Array<{ quantity: number; description: string }> {
  const short = (raw: string) => {
    const t = raw.trim();
    if (t.length <= descriptionMaxLen) return t;
    return `${t.slice(0, descriptionMaxLen - 1).trimEnd()}…`;
  };

  return items
    .filter((it) => {
      const st = String(it.status ?? "");
      if (st === "CANCELLED" || st.includes("CANCELLED")) return false;
      const q = Math.max(0, Number(it.quantity ?? 0));
      const qOrd = Math.max(0, Number(it.quantity_ordered ?? 0));
      const effective = Math.max(q, qOrd);
      if (effective > 0) return true;
      /** Tras cobrar, `quantity` puede ser 0 y no hay columna `quantity_ordered` en la fila de BD. */
      if ((st === "PAID" || st === "DISPATCHED") && String(it.description_snapshot ?? "").trim()) return true;
      return false;
    })
    .map((it) => {
      const q = Math.max(0, Number(it.quantity ?? 0));
      const qOrd = Math.max(0, Number(it.quantity_ordered ?? 0));
      const displayQty = q > 0 ? q : qOrd > 0 ? qOrd : 1;
      return {
        quantity: displayQty,
        description: short(String(it.description_snapshot ?? "").trim() || "Item"),
      };
    });
}

function isBlockedPaymentNotes(notes: string | null) {
  const raw = String(notes ?? "");
  return raw.includes("REVERSED:") || raw.includes("VOIDED:") || raw.includes("TRANSFER_PROOF_PENDING:1");
}

export interface MoveTableResult {
  order_id: string;
  table_id: string;
  split_id: string | null;
  split_code: string | null;
  destination_was_occupied: boolean;
}

export interface Order {
  id: string;
  order_number: number | null;
  order_code: string | null;
  status: OrderStatus;
  order_type: "DINE_IN" | "TAKEOUT";
  menu_scope: "TABLE" | "TAKEOUT";
  is_special: boolean;
  is_tray_order?: boolean;
  special_total_manual: number | null;
  /** Valor manual SOLO del grupo especial (orden especial mixta). NULL = especial no mixta. */
  special_group_total?: number | null;
  special_reason?: string | null;
  special_marked_at?: string | null;
  branch_id: string;
  table_id: string | null;
  table_order_position: number | null;
  split_id: string | null;
  split_code?: string | null;
  table_name?: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  sent_to_kitchen_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  cancel_requested_at?: string | null;
  items: OrderItem[];
  siblings: SiblingOrder[];
}

interface AddOrderItemParams {
  product_id: string;
  menu_node_id?: string | null;
  description_snapshot: string;
  item_note?: string | null;
  unit_price: number;
  quantity: number;
  modifier_ids: string[];
  modifier_snapshots?: { modifier_id: string; description: string }[];
  tray_item_type?: "A" | "B" | "C";
  tray_container_cost?: number;
}

export function getOrderQueryKey(orderId: string | null) {
  return ["order", orderId] as const;
}

export async function persistOrderItemLineQuantity(
  itemId: string,
  quantity: number,
  unitPrice?: number | null,
  currentQuantity?: number,
  itemStatus?: string | null,
) {
  const isSent = String(itemStatus ?? "") !== "DRAFT";
  const currentQty = Math.max(0, Number(currentQuantity ?? 0));
  const increasing = quantity > currentQty;

  if (isSent && increasing) {
    const { error } = await supabase.rpc("set_draft_order_item_quantity" as any, {
      p_item_id: itemId,
      p_quantity: quantity,
      p_unit_price: unitPrice ?? null,
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabase.rpc("remove_order_item_line" as any, {
    p_item_id: itemId,
    p_target_quantity: quantity,
  });
  if (!error) return;

  const { error: legacyError } = await supabase.rpc("set_draft_order_item_quantity" as any, {
    p_item_id: itemId,
    p_quantity: quantity,
    p_unit_price: unitPrice ?? null,
  });
  if (legacyError) throw error;
}

type KitchenPendingServerItem = {
  id: string;
  quantity: number;
  original_quantity?: number | null;
  unit_price: number;
  status: string;
  product_id?: string;
  menu_node_id?: string | null;
  description_snapshot?: string;
  item_note?: string | null;
  modifiers?: { modifier_id: string }[];
  tray_item_type?: "A" | "B" | "C" | null;
  tray_container_cost?: number | null;
};

type KitchenPendingTargetItem = KitchenPendingServerItem;

function kitchenItemServerQuantity(item: KitchenPendingServerItem): number {
  // Misma base que el staging (quantity visible / no cobrada).
  return Math.max(0, Number(item.quantity ?? 0));
}

/** Aplica en BD las diferencias entre el estado del servidor y la vista pendiente de cocina. */
export async function applyKitchenPendingItemChanges(
  orderId: string,
  serverItems: KitchenPendingServerItem[],
  pendingItems: KitchenPendingTargetItem[],
): Promise<{ createdDraftDelta: number }> {
  void orderId;
  const pendingById = new Map(pendingItems.map((item) => [item.id, item]));
  const tasks: Promise<void>[] = [];

  for (const server of serverItems) {
    const pending = pendingById.get(server.id);
    const pendingQty = pending ? Math.max(0, Number(pending.quantity ?? 0)) : 0;
    const serverQty = kitchenItemServerQuantity(server);

    if (!pending && String(server.status ?? "") === "DRAFT") {
      tasks.push(persistOrderItemLineQuantity(server.id, 0));
      continue;
    }

    if (pendingQty === serverQty) continue;

    // Misma fila: aumentar o bajar quantity in-place (sin crear DRAFT paralelo).
    tasks.push(
      persistOrderItemLineQuantity(
        server.id,
        pendingQty,
        pending?.unit_price ?? server.unit_price,
        serverQty,
        server.status,
      ),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  // Ya no se crean lineas DRAFT por aumento; se mantiene el campo por compatibilidad.
  return { createdDraftDelta: 0 };
}

/** Marca borradores como enviados en cache (UI inmediata tras submit). */
export function applyOptimisticKitchenSubmit(
  order: Order,
  nextStatus?: string | null,
): Order {
  const now = new Date().toISOString();
  const submittedItems = order.items.map((item) => {
    if (item.status !== "DRAFT" || Number(item.quantity ?? 0) <= 0) return item;
    const qty = Math.max(0, Number(item.quantity ?? 0));
    return {
      ...item,
      status: "SENT",
      quantity_sent: Math.max(Number(item.quantity_sent ?? 0), qty),
      quantity_remaining: Math.max(Number(item.quantity_remaining ?? 0), qty),
    };
  });

  const resolvedStatus =
    nextStatus
    || (order.status === "DRAFT" || order.status === "KITCHEN_DISPATCHED"
      ? "SENT_TO_KITCHEN"
      : order.status);

  return {
    ...order,
    status: resolvedStatus as Order["status"],
    sent_to_kitchen_at: order.sent_to_kitchen_at ?? now,
    items: submittedItems,
  };
}

async function orderHasDraftItemsToSubmit(
  orderId: string,
  cached: Order | null | undefined,
): Promise<{ hasDrafts: boolean; hadSentItems: boolean }> {
  const cachedItems = cached?.items ?? [];
  const hadSentItems = cachedItems.some((item) => item.status !== "DRAFT");
  const cachedHasDrafts = cachedItems.some(
    (item) => item.status === "DRAFT" && Number(item.quantity ?? 0) > 0,
  );
  if (cachedHasDrafts) {
    return { hasDrafts: true, hadSentItems };
  }

  const rawDrafts = await dbSelect<{ id: string; quantity: number }>("order_items", {
    select: "id, quantity",
    filters: [
      { column: "order_id", op: "eq", value: orderId },
      { column: "status", op: "eq", value: "DRAFT" },
    ],
  });
  const hasDrafts = (rawDrafts ?? []).some((item) => Number(item.quantity ?? 0) > 0);
  return { hasDrafts, hadSentItems };
}

/** Cache de borrador de mesa (optimista o recien creado) para mostrar UI sin esperar al servidor. */
export function seedDineInDraftOrderCache(
  qc: QueryClient,
  orderId: string,
  source: {
    branchId: string;
    tableId: string;
    tableName?: string;
    createdAt: string;
    tableOrderPosition: number;
    siblings: SiblingOrder[];
  },
) {
  qc.setQueryData(getOrderQueryKey(orderId), {
    id: orderId,
    order_number: null,
    order_code: null,
    status: "DRAFT",
    order_type: "DINE_IN",
    menu_scope: "TABLE",
    is_special: false,
    is_tray_order: false,
    special_total_manual: null,
    special_marked_at: null,
    branch_id: source.branchId,
    table_id: source.tableId,
    table_order_position: source.tableOrderPosition,
    split_id: null,
    split_code: null,
    table_name: source.tableName,
    created_at: source.createdAt,
    sent_to_kitchen_at: null,
    ready_at: null,
    dispatched_at: null,
    paid_at: null,
    cancelled_at: null,
    cancel_requested_at: null,
    items: [],
    siblings: source.siblings,
  } as Order);
}

/** Al abandonar la vista de orden de mesa: el servidor borra el borrador si no tiene lineas en BD (no usa cache). */
export async function purgeEmptyDineInTableDraftOnLeave(qc: QueryClient, orderId: string): Promise<void> {
  const { data: tableId, error } = await supabase.rpc("purge_empty_dine_in_draft_order" as any, {
    p_order_id: orderId,
  } as any);

  if (error) {
    console.warn("[purgeEmptyDineInTableDraftOnLeave]", (error as any).code, error.message);
    return;
  }

  if (!tableId) return;

  qc.removeQueries({ queryKey: getOrderQueryKey(orderId) });
  qc.invalidateQueries({ queryKey: ["tables-with-status"] });
  qc.invalidateQueries({ queryKey: ["table-orders", String(tableId)] });
  qc.invalidateQueries({ queryKey: ["order"] });
}

/** Al abrir Mesas: elimina en servidor todos los borradores de mesa sin items de la sucursal (segun permisos por orden). */
export async function purgeEmptyDineInTableDraftsForBranch(qc: QueryClient, branchId: string): Promise<number> {
  const { data, error } = await supabase.rpc("purge_empty_dine_in_draft_orders_for_branch" as any, {
    p_branch_id: branchId,
  } as any);

  if (error) {
    console.warn("[purgeEmptyDineInTableDraftsForBranch]", (error as any).code, error.message);
    return 0;
  }

  const n = Number(data ?? 0);
  if (n > 0) {
    qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    qc.invalidateQueries({ queryKey: ["table-orders"] });
    qc.invalidateQueries({ queryKey: ["order"] });
  }

  return Number.isFinite(n) ? n : 0;
}

/** Purgar borradores vacios de una mesa; invalida caches si hubo borrados. */
export async function purgeEmptyDineInTableDraftsForTable(qc: QueryClient, tableId: string): Promise<number> {
  const { data, error } = await supabase.rpc("purge_empty_dine_in_draft_orders_for_table" as any, {
    p_table_id: tableId,
    p_keep_order_id: null,
  } as any);

  if (error) {
    console.warn("[purgeEmptyDineInTableDraftsForTable]", (error as any).code, error.message);
    return 0;
  }

  const n = Number(data ?? 0);
  if (n > 0) {
    qc.invalidateQueries({ queryKey: ["tables-with-status"], exact: false });
    qc.invalidateQueries({ queryKey: ["table-orders", tableId] });
    qc.invalidateQueries({ queryKey: ["order"] });
  }

  return Number.isFinite(n) ? n : 0;
}

const withOrderDetailTimeout = <T,>(promise: Promise<T>, timeoutMs = 6_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("La orden tardo demasiado en cargar. Intenta abrir la mesa nuevamente."));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });

/** Orden de pestañas: mas antigua primero, la orden nueva siempre al final. */
export function compareSiblingOrderTabs(left: SiblingOrder, right: SiblingOrder): number {
  const byTime = String(left.created_at ?? "").localeCompare(String(right.created_at ?? ""));
  if (byTime !== 0) return byTime;
  const leftPos = Number(left.table_order_position ?? Number.MAX_SAFE_INTEGER);
  const rightPos = Number(right.table_order_position ?? Number.MAX_SAFE_INTEGER);
  if (leftPos !== rightPos) return leftPos - rightPos;
  return String(left.id).localeCompare(String(right.id));
}

export async function fetchSiblingOrders(
  tableId: string,
  branchId: string,
  /** No purgar este borrador vacio (la orden abierta en pantalla). */
  keepOrderId?: string | null,
  /** Si ya resolviste el turno abierto (p. ej. en Mesas), evita otra lectura duplicada. */
  cachedOpenShift?: OpenCashShift | null,
): Promise<SiblingOrder[]> {
  const openShift = cachedOpenShift ?? (await getOpenCashShiftForBranch(branchId));
  if (!openShift) return [];

  /** Purga en segundo plano: no bloquea el listado (ingreso rapido a mesa). */
  void supabase.rpc("purge_empty_dine_in_draft_orders_for_table" as any, {
    p_table_id: tableId,
    p_keep_order_id: keepOrderId ?? null,
  } as any);

  const { data: siblingOrders, error } = await supabase
    .from("orders")
    .select("id, order_number, order_code, split_id, table_order_position, status, created_at, sent_to_kitchen_at, cash_shift_id, notes, order_items(id, description_snapshot, quantity, status)")
    .eq("table_id", tableId)
    .eq("branch_id", branchId)
    .eq("order_type", "DINE_IN")
    .eq("cash_shift_id", openShift.id)
    .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID", "KITCHEN_DISPATCHED"]);

  if (error) throw error;

  if (!siblingOrders || siblingOrders.length === 0) return [];

  const splitIds = Array.from(new Set(siblingOrders.map((sibling: any) => sibling.split_id).filter(Boolean))) as string[];
  const splits = splitIds.length > 0 
    ? await dbSelect("table_splits", {
        select: "id, split_code",
        filters: [{ column: "id", op: "in", value: splitIds }]
      })
    : [];

  return siblingOrders
    .filter((sibling) => orderBelongsToOpenCashShift(sibling as any, openShift))
    .filter((sibling) => !String((sibling as any).notes ?? "").includes("VOID_SUCCESSOR_ORDER:"))
    .filter((sibling) => {
      const itemCount = Array.isArray(sibling.order_items) ? sibling.order_items.length : 0;
      if (itemCount > 0) return true;
      if (keepOrderId && sibling.id === keepOrderId) return true;
      if (String(sibling.status ?? "") !== "DRAFT") return true;
      return false;
    })
    .map((sibling) => {
      const rawItems = Array.isArray(sibling.order_items) ? sibling.order_items : [];
      return {
        id: sibling.id,
        order_number: sibling.order_number,
        order_code: sibling.order_code ?? null,
        status: String(sibling.status ?? "DRAFT"),
        split_code: splits?.find((split: any) => split.id === sibling.split_id)?.split_code ?? null,
        table_order_position: Number(sibling.table_order_position ?? 0) || null,
        created_at: sibling.created_at ?? null,
        item_count: rawItems.length,
        item_preview_lines: buildItemPreviewLinesForTableCard(rawItems as any[]),
      };
    })
    .sort(compareSiblingOrderTabs);
}

/**
 * Órdenes TAKEOUT del turno OPEN que aún tienen unidades por despachar.
 * No se ocultan solo porque Servir (platos) ya despachó: la tarjeta permanece
 * hasta que no quede cantidad pendiente (p. ej. Despacho termina bebidas/extras).
 */
export async function fetchTakeoutSiblingOrders(branchId: string): Promise<SiblingOrder[]> {
  const openShift = await getOpenCashShiftForBranch(branchId);
  if (!openShift) return [];

  const takeoutOrders = (
    await dbSelect<any>("orders", {
      select: "id, order_number, order_code, table_order_position, status, created_at, sent_to_kitchen_at, cash_shift_id, created_by, order_items(id, quantity, total)",
      filters: [
        { column: "branch_id", op: "eq", value: branchId },
        { column: "order_type", op: "eq", value: "TAKEOUT" },
        { column: "is_tray_order", op: "eq", value: false },
        { column: "is_special", op: "eq", value: false },
        { column: "cash_shift_id", op: "eq", value: openShift.id },
        { column: "status", op: "in", value: ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID", "KITCHEN_DISPATCHED"] },
      ],
      skipLocalCache: true,
    })
  ).filter((order) => orderBelongsToOpenCashShift(order, openShift));

  if (!takeoutOrders || takeoutOrders.length === 0) return [];

  const takeoutOrderIds = takeoutOrders.map((order: any) => order.id).filter(Boolean);
  const stillPendingDispatchIds = await resolveTakeoutOrdersPendingDispatch(takeoutOrders, takeoutOrderIds);

  const creatorIds = Array.from(new Set(takeoutOrders.map((order: any) => order.created_by).filter(Boolean))) as string[];
  const creatorProfiles = creatorIds.length > 0
    ? await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, alias, email",
        filters: [{ column: "id", op: "in", value: creatorIds }],
      })
    : [];
  const creatorNameMap = buildUserDisplayMap(creatorProfiles);

  return takeoutOrders
    .filter((sibling: any) => stillPendingDispatchIds.has(sibling.id))
    .map((sibling) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: sibling.order_code ?? null,
      status: sibling.status ?? null,
      created_by_name: sibling.created_by ? (creatorNameMap[sibling.created_by] ?? "Usuario") : null,
      split_code: null,
      table_order_position: Number(sibling.table_order_position ?? 0) || null,
      created_at: sibling.created_at ?? null,
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
      total: Array.isArray(sibling.order_items)
        ? sibling.order_items.reduce((sum: number, item: any) => sum + Number(item.total ?? 0), 0)
        : 0,
    }))
    .sort(compareSiblingOrderTabs);
}

/** IDs TAKEOUT con unidades aún no despachadas (o sin snapshot = borrador / datos incompletos). */
async function resolveTakeoutOrdersPendingDispatch(
  takeoutOrders: any[],
  takeoutOrderIds: string[],
): Promise<Set<string>> {
  const pending = new Set<string>();

  if (takeoutOrderIds.length === 0) return pending;

  try {
    const { data, error } = await (supabase as any).rpc("get_orders_operational_snapshots_lite", {
      p_order_ids: takeoutOrderIds,
    });
    if (error) throw error;

    const rows = (data ?? []) as OrderOperationalSnapshotRow[];
    const seenOrderIds = new Set<string>();

    for (const row of rows) {
      const orderId = String(row.order_id ?? "");
      if (!orderId) continue;
      seenOrderIds.add(orderId);

      const snap = computeOperationalQuantities({
        quantityOrdered: Number(row.quantity_ordered ?? 0),
        quantityReadyTotal: Number(row.quantity_ready_total ?? 0),
        quantityDispatchedTotal: Number(
          row.quantity_dispatched_total ?? row.quantity_dispatched ?? 0,
        ),
        quantityCancelledPending: Number(row.quantity_cancelled_pending ?? 0),
        quantityCancelledReady: Number(row.quantity_cancelled_ready ?? 0),
        quantityCancelledDispatched: Number(row.quantity_cancelled_dispatched ?? 0),
      });
      if (computeUndispatchedQuantity(snap) > 0) {
        pending.add(orderId);
      }
    }

    // Sin filas de snapshot: mantener visibles (p. ej. DRAFT recién creado).
    for (const order of takeoutOrders) {
      const id = String(order?.id ?? "");
      if (!id || seenOrderIds.has(id)) continue;
      if (String(order.status ?? "") === "KITCHEN_DISPATCHED") continue;
      pending.add(id);
    }

    return pending;
  } catch {
    // Fallback: no ocultar por “cualquier evento de despacho” (fallaba con Servir parcial).
    // Solo excluir las ya marcadas como despachadas por completo.
    for (const order of takeoutOrders) {
      const id = String(order?.id ?? "");
      if (!id) continue;
      if (String(order.status ?? "") === "KITCHEN_DISPATCHED") continue;
      pending.add(id);
    }
    return pending;
  }
}

export async function fetchExpressSiblingOrders(branchId: string): Promise<SiblingOrder[]> {
  const openShift = await getOpenCashShiftForBranch(branchId);
  if (!openShift) return [];

  const expressOrders = (
    await dbSelect<any>("orders", {
      select: "id, order_number, order_code, table_order_position, status, created_at, sent_to_kitchen_at, cash_shift_id, created_by, order_items(id, total)",
      filters: [
        { column: "branch_id", op: "eq", value: branchId },
        { column: "order_type", op: "eq", value: "EXPRESS" },
        { column: "is_tray_order", op: "eq", value: false },
        { column: "is_special", op: "eq", value: false },
        { column: "cash_shift_id", op: "eq", value: openShift.id },
        { column: "status", op: "in", value: ["DRAFT", "SENT_TO_KITCHEN", "READY"] },
      ],
      skipLocalCache: true,
    })
  ).filter((order) => orderBelongsToOpenCashShift(order, openShift));

  if (!expressOrders || expressOrders.length === 0) return [];

  const expressOrderIds = expressOrders.map((order: any) => order.id).filter(Boolean);
  const dispatchEvents = expressOrderIds.length > 0
    ? await dbSelect<any>("order_dispatch_events", {
        select: "order_id",
        filters: [
          { column: "order_id", op: "in", value: expressOrderIds },
          { column: "status", op: "eq", value: "APPLIED" },
        ],
      })
    : [];
  const dispatchedOrderIds = new Set((dispatchEvents ?? []).map((event: any) => event.order_id));

  const creatorIds = Array.from(new Set(expressOrders.map((order: any) => order.created_by).filter(Boolean))) as string[];
  const creatorProfiles = creatorIds.length > 0
    ? await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, alias, email",
        filters: [{ column: "id", op: "in", value: creatorIds }],
      })
    : [];
  const creatorNameMap = buildUserDisplayMap(creatorProfiles);

  return expressOrders
    .filter((sibling: any) => !dispatchedOrderIds.has(sibling.id))
    .filter((sibling: any) => !["PAID", "CANCELLED", "KITCHEN_DISPATCHED"].includes(String(sibling.status ?? "")))
    .map((sibling) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: sibling.order_code ?? null,
      status: sibling.status ?? null,
      created_by_name: sibling.created_by ? (creatorNameMap[sibling.created_by] ?? "Usuario") : null,
      split_code: null,
      table_order_position: Number(sibling.table_order_position ?? 0) || null,
      created_at: sibling.created_at ?? null,
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
      total: Array.isArray(sibling.order_items)
        ? sibling.order_items.reduce((sum: number, item: any) => sum + Number(item.total ?? 0), 0)
        : 0,
    }))
    .sort(compareSiblingOrderTabs);
}

export async function fetchExtraSiblingOrders(
  branchId: string,
  createdByUserId: string,
): Promise<SiblingOrder[]> {
  const openShift = await getOpenCashShiftForBranch(branchId);
  if (!openShift || !createdByUserId) return [];

  const extraOrders = (
    await dbSelect<any>("orders", {
      select: "id, order_number, order_code, table_order_position, status, created_at, sent_to_kitchen_at, cash_shift_id, created_by, closed_at, table_name_snapshot, table_id, order_items(id, total)",
      filters: [
        { column: "branch_id", op: "eq", value: branchId },
        { column: "order_type", op: "eq", value: "EXTRA" },
        { column: "is_tray_order", op: "eq", value: false },
        { column: "is_special", op: "eq", value: false },
        { column: "cash_shift_id", op: "eq", value: openShift.id },
        { column: "created_by", op: "eq", value: createdByUserId },
        { column: "status", op: "in", value: ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID", "KITCHEN_DISPATCHED"] },
      ],
      skipLocalCache: true,
    })
  ).filter((order) => orderBelongsToOpenCashShift(order, openShift));

  if (!extraOrders || extraOrders.length === 0) return [];

  const creatorIds = Array.from(new Set(extraOrders.map((order: any) => order.created_by).filter(Boolean))) as string[];
  const creatorProfiles = creatorIds.length > 0
    ? await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, alias, email",
        filters: [{ column: "id", op: "in", value: creatorIds }],
      })
    : [];
  const creatorNameMap = buildUserDisplayMap(creatorProfiles);

  const tableIds = Array.from(new Set(extraOrders.map((o: any) => o.table_id).filter(Boolean))) as string[];
  const tables = tableIds.length > 0
    ? await dbSelect<any>("restaurant_tables", { filters: [{ column: "id", op: "in", value: tableIds }] })
    : [];
  const tablesMap = Object.fromEntries(tables.map((t: any) => [t.id, t.name]));

  return extraOrders
    .filter((sibling: any) => !sibling.closed_at)
    .map((sibling) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: sibling.order_code ?? null,
      status: sibling.status ?? null,
      closed_at: sibling.closed_at ?? null,
      created_by_name: sibling.created_by ? (creatorNameMap[sibling.created_by] ?? "Usuario") : null,
      split_code: null,
      table_name_snapshot: sibling.table_name_snapshot || (sibling.table_id ? tablesMap[sibling.table_id] : null) || null,
      table_order_position: Number(sibling.table_order_position ?? 0) || null,
      created_at: sibling.created_at ?? null,
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
      total: Array.isArray(sibling.order_items)
        ? sibling.order_items.reduce((sum: number, item: any) => sum + Number(item.total ?? 0), 0)
        : 0,
    }))
    .sort(compareSiblingOrderTabs);
}

async function fetchOrderTableName(tableId: string | null): Promise<string | null> {
  if (!tableId) return null;

  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("name")
    .eq("id", tableId)
    .maybeSingle();

  if (error) throw error;
  return String(data?.name ?? "").trim() || null;
}

const withCallTimeout = <T,>(promise: Promise<T>, ms = 4000, label = "consulta"): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tiempo de espera agotado en ${label}`)), ms)
    ),
  ]);

async function fetchOrderDetailInternal(orderId: string): Promise<Order | null> {
  const startTotal = Date.now();
  
  const startOrders = Date.now();
  const orders = await dbSelect<any>("orders", {
    select: "id, order_number, order_code, status, order_type, menu_scope, is_special, is_tray_order, special_total_manual, special_group_total, special_reason, special_marked_at, branch_id, table_id, table_order_position, split_id, created_by, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, cancel_requested_at, table_name_snapshot, cash_shift_id",
    filters: [{ column: "id", op: "eq", value: orderId }]
  });
  console.log(`[PERF] Consultar orders tomo: ${Date.now() - startOrders}ms`);
  
  const order = orders[0];
  if (!order) return null;

  const startMain = Date.now();
  const [
    tableResult,
    splitResult,
    items,
    snapshotResult,
  ] = await Promise.all([
    withCallTimeout(fetchOrderTableName(order.table_id), 4000, "nombre de mesa"),
    order.split_id
      ? withCallTimeout(dbSelect("table_splits", { select: "split_code", filters: [{ column: "id", op: "eq", value: order.split_id }] }), 4000, "divisiones de mesa")
      : Promise.resolve([]),
    withCallTimeout(dbSelect<any>("order_items", {
      select: "id, product_id, description_snapshot, item_note, quantity, unit_price, total, status, paid_at, tray_item_type, tray_container_cost, cantidad_especial",
      filters: [{ column: "order_id", op: "eq", value: orderId }],
      orderBy: { column: "created_at" },
    }), 4000, "items de orden"),
    withCallTimeout(supabase.rpc("get_order_operational_snapshot" as any, {
      p_order_id: orderId,
    }), 4000, "estado operacional"),
  ]);
  console.log(`[PERF] Promise.all principal tomo: ${Date.now() - startMain}ms`);

  /** La pantalla de ordenes ya carga hermanos con `table-orders`; evitar segunda llamada aqui. */
  const siblings: SiblingOrder[] = [];

  const tableName = tableResult ?? order.table_name_snapshot;
  const splitCode = (splitResult as any[])[0]?.split_code ?? null;

  const normalizedSnapshotRows = normalizeSnapshotRows((snapshotResult.data ?? []) as OrderOperationalSnapshotRow[]);
  const snapshotMap = Object.fromEntries(
    normalizedSnapshotRows.map((row) => [String(row.order_item_id), row]),
  );
  const operationalMaps = normalizedSnapshotRows.length > 0
    ? buildOperationalMapsFromSnapshotRows(normalizedSnapshotRows)
    : EMPTY_OPERATIONAL_MAPS;
    
  const itemIds = items.map((item: any) => item.id);
  const paidQuantityByItem: Record<string, number> = {};
  let modifiersData: any[] = [];

  if (itemIds.length > 0) {
    const startItemsDetails = Date.now();
    const [paymentItems, mods] = await Promise.all([
      dbSelect<any>("payment_items", {
        select: "id, payment_id, order_item_id, quantity_paid",
        filters: [{ column: "order_item_id", op: "in", value: itemIds }],
      }),
      dbSelect<any>("order_item_modifiers", {
        select: "id, modifier_id, order_item_id, modifiers(description)",
        filters: [{ column: "order_item_id", op: "in", value: itemIds }],
      }),
    ]);
    modifiersData = mods ?? [];

    const paymentIds = Array.from(new Set((paymentItems ?? []).map((row: any) => row.payment_id).filter(Boolean)));
    let blockedPaymentIds = new Set<string>();

    if (paymentIds.length > 0) {
      const payments = await dbSelect<any>("payments", {
        select: "id, notes",
        filters: [{ column: "id", op: "in", value: paymentIds }],
      });

      blockedPaymentIds = new Set(
        (payments ?? [])
          .filter((payment) => isBlockedPaymentNotes(payment.notes))
          .map((payment) => payment.id),
      );
    }

    for (const row of paymentItems ?? []) {
      if (blockedPaymentIds.has(row.payment_id)) continue;
      paidQuantityByItem[row.order_item_id] = (paidQuantityByItem[row.order_item_id] ?? 0) + Number(row.quantity_paid ?? 0);
    }
    console.log(`[PERF] Consultar modificadores/pagos tomo: ${Date.now() - startItemsDetails}ms`);
  }

  const pendingRequestQtyByItem: Record<string, number> = {};
  if (order.cancel_requested_at) {
    const startCancels = Date.now();
    const cancellations = await dbSelect<any>("order_cancellations", {
      select: "notes",
      filters: [
        { column: "order_id", op: "eq", value: orderId },
        { column: "status", op: "eq", value: "VOIDED" },
        { column: "notes", op: "is" as any, value: "not.null" }
      ],
      orderBy: { column: "created_at", ascending: false }
    });
    console.log(`[PERF] Consultar cancelaciones tomo: ${Date.now() - startCancels}ms`);

    const pendingCancellationHeader = cancellations.find(c => String(c.notes ?? "").startsWith("[PENDING_REQUEST]"));

    const raw = String(pendingCancellationHeader?.notes ?? "").trim();
    if (raw.startsWith("[PENDING_REQUEST]")) {
      const jsonPart = raw.replace(/^\[PENDING_REQUEST\]\s*/, "").trim();
      if (jsonPart) {
        try {
          const parsed = JSON.parse(jsonPart) as { items?: Array<{ order_item_id?: string; quantity_cancelled?: number }> };
          for (const requestedItem of parsed.items ?? []) {
            const requestedItemId = String(requestedItem?.order_item_id ?? "").trim();
            const requestedQty = Math.max(0, Math.floor(Number(requestedItem?.quantity_cancelled ?? 0)));
            if (!requestedItemId || requestedQty <= 0) continue;
            pendingRequestQtyByItem[requestedItemId] = (pendingRequestQtyByItem[requestedItemId] ?? 0) + requestedQty;
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  const enrichedItems: OrderItem[] = items
    .map((item: any) => {
      const snapshotRow = snapshotMap[item.id];
      const originalQuantity = Number(item.quantity ?? 0);
      const quantityOrdered = Math.max(
        originalQuantity,
        Number(snapshotRow?.quantity_ordered ?? originalQuantity),
      );
      const cancelledQuantity = Math.min(
        quantityOrdered,
        Number(snapshotRow?.quantity_cancelled_total ?? 0),
      );
      const activeQuantity = Math.max(0, originalQuantity - cancelledQuantity);
      const effectivePaidQuantity = Math.max(
        0,
        Math.min(
          activeQuantity,
          paidQuantityByItem[item.id] ?? (item.paid_at ? activeQuantity : 0),
        ),
      );
      const unpaidActiveQuantity = Math.max(0, activeQuantity - effectivePaidQuantity);
      const quantityPendingPrepare = Math.max(0, Number(operationalMaps.pendingPrepareMap[item.id] ?? 0));
      const quantityReadyAvailable = Math.max(0, Number(operationalMaps.readyAvailableMap[item.id] ?? 0));
      const quantityDispatched = Math.max(
        0,
        Number(operationalMaps.dispatchedTotalMap[item.id] ?? 0) - Number(operationalMaps.cancelledDispatchedMap[item.id] ?? 0),
      );
      const hasOperationalProgress = hasOrderItemOperationalProgress({
        activeQuantity,
        quantityDispatched,
        quantityReadyAvailable,
        quantityPendingPrepare,
        hasOperationalSnapshot: Boolean(snapshotRow),
      });
      const effectiveStatus = activeQuantity <= 0
        ? "CANCELLED"
        : item.status === "DRAFT" && hasOperationalProgress
          ? (quantityDispatched > 0 ? "DISPATCHED" : "SENT")
          : (item.status ?? "DRAFT");
      const quantitySent = effectiveStatus === "DRAFT" ? 0 : quantityOrdered;
      const quantityCancelled = Math.max(
        cancelledQuantity,
        Number(operationalMaps.cancelledTotalMap[item.id] ?? cancelledQuantity),
      );
      const quantityCancellable = Math.max(
        0,
        quantityPendingPrepare
          + quantityReadyAvailable
          + quantityDispatched,
      );

      return {
        ...item,
        quantity: unpaidActiveQuantity,
        quantity_requested: Math.max(0, pendingRequestQtyByItem[item.id] ?? 0),
        quantity_ordered: quantityOrdered,
        original_quantity: originalQuantity,
        cancelled_quantity: cancelledQuantity,
        quantity_paid: effectivePaidQuantity,
        total: computeLineTotalWithContainer(
          activeQuantity,
          Number(item.unit_price ?? 0),
          Number(item.tray_container_cost ?? 0),
        ),
        status: effectiveStatus,
        tray_item_type: (item.tray_item_type ?? null) as "A" | "B" | "C" | null,
        tray_container_cost: Number(item.tray_container_cost ?? 0),
        quantity_sent: quantitySent,
        quantity_ready_available: quantityReadyAvailable,
        quantity_dispatched: quantityDispatched,
        quantity_remaining:
          effectiveStatus === "DRAFT"
            ? Math.max(0, activeQuantity)
            : Math.max(
                0,
                quantityPendingPrepare + quantityReadyAvailable,
              ),
        quantity_cancelled: quantityCancelled,
        quantity_cancellable: Math.min(quantityCancellable, unpaidActiveQuantity),
        modifiers: modifiersData
          .filter((modifier: any) => modifier.order_item_id === item.id)
          .map((modifier: any) => ({
            id: modifier.id,
            modifier_id: modifier.modifier_id,
            description: String(Array.isArray((modifier as any).modifiers) ? (modifier as any).modifiers[0]?.description : (modifier as any).modifiers?.description ?? "").trim(),
          })),
      };
    })
    .filter((item) => {
      if (item.status === "CANCELLED") return false;
      return (
        item.quantity > 0 ||
        item.status === "PAID" ||
        (item.status === "DRAFT" && Number(item.original_quantity ?? 0) > 0)
      );
    });

  const totalDuration = Date.now() - startTotal;
  console.log(`[PERF] TOTAL fetchOrderDetailInternal tomo: ${totalDuration}ms`);

  return {
    ...order,
    split_code: splitCode,
    table_name: tableName,
    created_by: order.created_by ?? null,
    created_by_name: null,
    items: enrichedItems,
    siblings,
  } as Order;
}

export async function fetchOrderDetail(orderId: string): Promise<Order | null> {
  return withOrderDetailTimeout(fetchOrderDetailInternal(orderId));
}

/** Lectura liviana antes de navegar desde Mesas: solo sirve para validar turno (evita fetchOrderDetail completo). */
export async function fetchOrderShiftGateFields(orderId: string): Promise<{
  cash_shift_id: string | null;
  created_at: string | null;
  sent_to_kitchen_at: string | null;
} | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("cash_shift_id, created_at, sent_to_kitchen_at")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as Pick<
    Database["public"]["Tables"]["orders"]["Row"],
    "cash_shift_id" | "created_at" | "sent_to_kitchen_at"
  >;
  return {
    cash_shift_id: row.cash_shift_id ?? null,
    created_at: row.created_at ?? null,
    sent_to_kitchen_at: row.sent_to_kitchen_at ?? null,
  };
}

export function useOrder(orderId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: getOrderQueryKey(orderId),
    queryFn: async () => {
      if (!orderId) return null;
      const fresh = await fetchOrderDetail(orderId);
      if (fresh) return fresh;
      const cached = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      if (
        cached
        && cached.id === orderId
        && cached.order_type === "DINE_IN"
        && cached.status === "DRAFT"
      ) {
        return cached;
      }
      return null;
    },
    enabled: !!orderId,
    placeholderData: () =>
      orderId ? (qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined) : undefined,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const addItem = useMutation({
    mutationFn: async (params: AddOrderItemParams) => {
      const isTrayOrder = query.data?.is_tray_order === true;

      if (isTrayOrder) {
        const { data, error } = await supabase.rpc("add_tray_order_item" as any, {
          p_order_id: orderId!,
          p_product_id: params.product_id,
          p_quantity: params.quantity,
          p_unit_price: params.unit_price,
          p_tray_item_type: params.tray_item_type,
          p_tray_container_cost: params.tray_container_cost ?? 0,
          p_item_note: params.item_note ?? null,
          p_modifier_ids: params.modifier_ids,
        });
        if (error) throw error;
        return String(data);
      }

      const { data, error } = await supabase.rpc("add_dine_in_order_item" as any, {
        p_order_id: orderId!,
        p_product_id: params.product_id,
        p_menu_node_id: params.menu_node_id ?? null,
        p_quantity: params.quantity,
        p_unit_price: params.unit_price,
        p_description_snapshot: params.description_snapshot,
        p_item_note: params.item_note ?? null,
        p_modifier_ids: params.modifier_ids,
        p_tray_item_type: params.tray_item_type ?? null,
        p_tray_container_cost: params.tray_container_cost ?? 0,
      });
      if (error) throw error;
      return String(data);
    },
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      const tempId = `temp-${Date.now()}`;
      
      if (previousOrder) {
        const modifierDescriptionById = new Map(
          (params.modifier_snapshots ?? []).map((modifier) => [modifier.modifier_id, modifier.description]),
        );
        const optimisticItem: OrderItem = {
          id: tempId,
          product_id: params.product_id,
          description_snapshot: params.description_snapshot,
          item_note: params.item_note ?? null,
          quantity: params.quantity,
          quantity_ordered: params.quantity,
          original_quantity: params.quantity,
          cancelled_quantity: 0,
          unit_price: params.unit_price,
          total: params.quantity * params.unit_price + (params.quantity > 0 ? (params.tray_container_cost ?? 0) : 0),
          status: "DRAFT",
          tray_item_type: params.tray_item_type ?? null,
          tray_container_cost: params.tray_container_cost ?? 0,
          quantity_sent: 0,
          quantity_ready_available: 0,
          quantity_dispatched: 0,
          quantity_remaining: params.quantity,
          quantity_cancelled: 0,
          quantity_cancellable: 0,
          modifiers: params.modifier_ids.map((id) => ({
            id: `temp-mod-${id}`,
            modifier_id: id,
            description: modifierDescriptionById.get(id) ?? "",
          })),
        };
        
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: [...previousOrder.items, optimisticItem],
        });
      }
      return { previousOrder, tempId };
    },
    onSuccess: (createdItemId, _params, context) => {
      if (!createdItemId || !context?.tempId) return;

      qc.setQueryData(getOrderQueryKey(orderId), (current: Order | undefined) => {
        if (!current) return current;

        return {
          ...current,
          items: current.items.map((item) =>
            item.id === context.tempId
              ? { ...item, id: createdItemId }
              : item,
          ),
        };
      });
    },
    onError: (err: any, _, context) => {
      if (context?.previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), context.previousOrder);
      }
      toast.error(err.message);
    },
    onSettled: async () => {
      await qc.refetchQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      if (isTemporaryOrderItemId(itemId)) {
        throw new Error("El item aun se esta guardando. Espera un momento e intenta de nuevo.");
      }
      await persistOrderItemLineQuantity(itemId, 0);
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;

      if (previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: previousOrder.items.filter((row) => row.id !== itemId),
        });
      }
      return { previousOrder };
    },
    onError: (err: any, _, context) => {
      if (context?.previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), context.previousOrder);
      }
      toast.error(err.message);
    },
    onSettled: () => {
      const branchId = query.data?.branch_id;
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["servir-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      if (branchId) {
        qc.invalidateQueries({ queryKey: ["takeout-orders", branchId] });
        qc.invalidateQueries({ queryKey: ["special-orders", branchId] });
      }
    },
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ itemId, quantity, unit_price }: { itemId: string; quantity: number; unit_price: number }) => {
      if (isTemporaryOrderItemId(itemId)) {
        throw new Error("El item aun se esta guardando. Espera un momento e intenta de nuevo.");
      }

      const order = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      const item = order?.items.find((row) => row.id === itemId);
      await persistOrderItemLineQuantity(
        itemId,
        quantity,
        unit_price,
        item?.quantity,
        item?.status,
      );
    },
    onMutate: async ({ itemId, quantity, unit_price }) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;

      if (previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: previousOrder.items.flatMap((item) => {
            if (item.id !== itemId) return [item];
            if (quantity <= 0) return [];
            return [{
              ...item,
              quantity,
              total: quantity * unit_price + (quantity > 0 ? (item.tray_container_cost ?? 0) : 0),
            }];
          }),
        });
      }
      return { previousOrder };
    },
    onError: (err: any, _, context) => {
      if (context?.previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), context.previousOrder);
      }
      toast.error(err.message);
    },
    onSettled: () => {
      const branchId = query.data?.branch_id;
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["servir-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      if (branchId) {
        qc.invalidateQueries({ queryKey: ["takeout-orders", branchId] });
        qc.invalidateQueries({ queryKey: ["special-orders", branchId] });
      }
    },
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      if (!orderId) {
        throw new Error("No se encontró la orden");
      }

      const cached =
        (qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined)
        ?? query.data
        ?? null;
      const { hasDrafts, hadSentItems } = await orderHasDraftItemsToSubmit(orderId, cached);
      if (!hasDrafts) {
        throw new Error("No hay productos pendientes por enviar");
      }

      const { data, error } = await supabase.rpc("submit_order_draft_items" as any, {
        p_order_id: orderId,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : null;
      return {
        row: row as { order_status?: string; order_id?: string; submitted_item_count?: number } | null,
        hadSentItems,
        orderBefore: cached,
      };
    },
    onSuccess: ({ row, hadSentItems, orderBefore }) => {
      const order = orderBefore ?? query.data;
      if (order && orderId) {
        qc.setQueryData(
          getOrderQueryKey(orderId),
          applyOptimisticKitchenSubmit(order, row?.order_status ?? null),
        );
      }

      void qc.invalidateQueries({ queryKey: ["order", orderId] });
      void qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      void qc.invalidateQueries({ queryKey: ["table-orders"] });
      void qc.invalidateQueries({ queryKey: ["payable-orders"] });
      void qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      void qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      void qc.invalidateQueries({ queryKey: ["servir-orders"] });
      if (order?.order_type === "EXTRA" && order.branch_id) {
        void qc.invalidateQueries({ queryKey: ["extra-orders", order.branch_id] });
      }

      if (row?.order_status === "PAID") {
        toast.success("Orden especial de $0 marcada como pagada");
        return;
      }

      const message = hadSentItems
        ? "Nuevos items enviados correctamente"
        : "Orden lista para cobrar en caja";

      toast.success(message);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const sendToDispatch = useMutation({
    mutationFn: async () => {
      if (!orderId) {
        throw new Error("No se encontró la orden");
      }

      const cached =
        (qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined)
        ?? query.data
        ?? null;

      if (cached && cached.order_type !== "EXPRESS") {
        throw new Error("Solo las ordenes Express pueden enviarse a despacho desde aqui");
      }

      const { hasDrafts, hadSentItems } = await orderHasDraftItemsToSubmit(orderId, cached);
      if (!hasDrafts) {
        throw new Error("No hay productos pendientes por enviar");
      }

      // Si no habia cache, confirmar tipo Express con lectura minima.
      if (!cached) {
        const rows = await dbSelect<{ order_type: string }>("orders", {
          select: "order_type",
          filters: [{ column: "id", op: "eq", value: orderId }],
        });
        if ((rows?.[0] as any)?.order_type !== "EXPRESS") {
          throw new Error("Solo las ordenes Express pueden enviarse a despacho desde aqui");
        }
      }

      const { error } = await supabase.rpc("submit_express_order_draft_items" as any, {
        p_order_id: orderId,
      });
      if (error) throw error;

      return {
        hadSentItems,
        orderBefore: cached,
      };
    },
    onSuccess: ({ hadSentItems, orderBefore }) => {
      const order = orderBefore ?? query.data;
      if (order && orderId) {
        qc.setQueryData(
          getOrderQueryKey(orderId),
          applyOptimisticKitchenSubmit(order, "SENT_TO_KITCHEN"),
        );
      }

      void qc.invalidateQueries({ queryKey: ["order", orderId] });
      void qc.invalidateQueries({ queryKey: ["express-orders"] });
      void qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      void qc.invalidateQueries({ queryKey: ["servir-orders"] });
      void qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      void qc.invalidateQueries({ queryKey: ["payable-orders"] });

      const message = hadSentItems
        ? "Nuevos items enviados a despacho"
        : "Orden enviada a despacho";

      toast.success(message);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const moveToTable = useMutation({
    mutationFn: async (destinationTableId: string): Promise<MoveTableResult> => {
      if (!orderId) {
        throw new Error("No se encontro la orden a mover");
      }

      const { data, error } = await supabase.rpc("move_dine_in_order_to_table" as any, {
        p_order_id: orderId,
        p_destination_table_id: destinationTableId,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("No se pudo completar el cambio de mesa");
      }

      return row as MoveTableResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateMenuScope = useMutation({
    mutationFn: async (menuScope: "TABLE" | "TAKEOUT") => {
      await dbUpdate("orders", orderId!, { menu_scope: menuScope });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateSpecialTotal = useMutation({
    mutationFn: async (specialTotalManual: number | null) => {
      await dbUpdate("orders", orderId!, {
        special_total_manual: specialTotalManual,
        updated_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateSpecialReason = useMutation({
    mutationFn: async (specialReason: string | null) => {
      await dbUpdate("orders", orderId!, {
        special_reason: specialReason,
        updated_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const convertToSpecial = useMutation({
    mutationFn: async (specialTotalManual: number | null) => {
      if (!orderId) {
        throw new Error("No se encontro la orden a convertir");
      }

      const { data, error } = await supabase.rpc("convert_order_to_special" as any, {
        p_order_id: orderId,
        p_special_total_manual: specialTotalManual,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("No se pudo convertir la orden a especial");
      }

      return row;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      toast.success("La orden ahora opera como orden especial");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createTableOrder = useMutation({
    mutationFn: async () => {
      if (!orderId) {
        throw new Error("No se encontro la orden base");
      }

      const { data, error } = await supabase.rpc("create_additional_dine_in_order" as any, {
        p_source_order_id: orderId,
      });

      if (error) throw error;
      return String(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      toast.success("Nueva orden creada en la mesa");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteTableOrder = useMutation({
    mutationFn: async () => {
      if (!orderId) {
        throw new Error("No se encontro la orden a eliminar");
      }

      const { data, error } = await supabase.rpc("delete_dine_in_table_order" as any, {
        p_order_id: orderId,
      });

      if (error) throw error;
      return data ? String(data) : null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeOrder = useMutation({
    mutationFn: async () => {
      const order = query.data;
      if (!orderId || !order) {
        throw new Error("No se encontro la orden a cerrar");
      }

      if (order.order_type !== "DINE_IN" || !order.table_id) {
        throw new Error("Solo puedes cerrar ordenes activas de mesa");
      }

      if (order.status === "PAID" || order.status === "CANCELLED") {
        throw new Error("La orden ya no puede cerrarse");
      }

      const { error } = await supabase.rpc("close_dine_in_order_for_payment" as any, {
        p_order_id: orderId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const tableId = query.data?.table_id;
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      
      if (tableId) {
        qc.invalidateQueries({ queryKey: ["table-orders", tableId] });
        qc.removeQueries({ queryKey: ["table-orders", tableId] });
      }
      
      toast.success("Orden cerrada y enviada a cobro");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const lockOrder = useMutation({
    mutationFn: async () => {
      if (!orderId) return;
      await dbUpdate("orders", orderId, { locked_for_editing: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const unlockOrder = useMutation({
    mutationFn: async () => {
      if (!orderId) return;
      await dbUpdate("orders", orderId, { locked_for_editing: false });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    order: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    addItem,
    removeItem,
    updateQuantity,
    sendToKitchen,
    sendToDispatch,
    moveToTable,
    createTableOrder,
    deleteTableOrder,
    updateMenuScope,
    updateSpecialTotal,
    updateSpecialReason,
    convertToSpecial,
    closeOrder,
    lockOrder,
    unlockOrder,
  };
}
