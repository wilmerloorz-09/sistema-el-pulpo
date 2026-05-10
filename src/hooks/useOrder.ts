import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { computeLineTotalWithContainer } from "@/lib/paymentQuantity";
import {
  buildOperationalMapsFromSnapshotRows,
  EMPTY_OPERATIONAL_MAPS,
  normalizeSnapshotRows,
  type OrderOperationalSnapshotRow,
} from "@/lib/orderOperational";
import { buildUserDisplayMap, getUserDisplayName } from "@/lib/userDisplay";
import { getOpenCashShiftIdForBranch } from "@/lib/openCashShift";

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
  created_by_name?: string | null;
  split_code: string | null;
  table_order_position: number | null;
  item_count: number;
  total?: number;
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

interface Order {
  id: string;
  order_number: number | null;
  order_code: string | null;
  status: OrderStatus;
  order_type: "DINE_IN" | "TAKEOUT";
  menu_scope: "TABLE" | "TAKEOUT";
  is_special: boolean;
  is_tray_order?: boolean;
  special_total_manual: number | null;
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

const withOrderDetailTimeout = <T,>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("La orden tardo demasiado en cargar. Intenta abrir la mesa nuevamente."));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });

export async function fetchSiblingOrders(tableId: string, branchId: string): Promise<SiblingOrder[]> {
  const openShiftId = await getOpenCashShiftIdForBranch(branchId);
  if (!openShiftId) return [];

  const { data: siblingOrders, error } = await supabase
    .from("orders")
    .select("id, order_number, order_code, split_id, table_order_position, status, created_at, notes, order_items(id)")
    .eq("table_id", tableId)
    .eq("branch_id", branchId)
    .eq("cash_shift_id", openShiftId)
    .eq("order_type", "DINE_IN")
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
    .filter((sibling) => !String((sibling as any).notes ?? "").includes("VOID_SUCCESSOR_ORDER:"))
    .map((sibling) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: sibling.order_code ?? null,
      split_code: splits?.find((split: any) => split.id === sibling.split_id)?.split_code ?? null,
      table_order_position: Number(sibling.table_order_position ?? 0) || null,
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
    }))
    .sort((left, right) => {
      const leftPos = Number(left.table_order_position ?? Number.MAX_SAFE_INTEGER);
      const rightPos = Number(right.table_order_position ?? Number.MAX_SAFE_INTEGER);

      if (leftPos !== rightPos) {
        return leftPos - rightPos;
      }

      return Number(left.order_number ?? 0) - Number(right.order_number ?? 0);
    });
}

export async function fetchTakeoutSiblingOrders(branchId: string): Promise<SiblingOrder[]> {
  const openShiftId = await getOpenCashShiftIdForBranch(branchId);
  if (!openShiftId) return [];

  const takeoutOrders = await dbSelect<any>("orders", {
    select: "id, order_number, order_code, table_order_position, status, created_at, created_by, order_items(id, total)",
    filters: [
      { column: "branch_id", op: "eq", value: branchId },
      { column: "order_type", op: "eq", value: "TAKEOUT" },
      { column: "is_tray_order", op: "eq", value: false },
      { column: "is_special", op: "eq", value: false },
      { column: "cash_shift_id", op: "eq", value: openShiftId },
      // Mantener "Para llevar" visible como pestaña incluso si ya fue pagada.
      // Se excluye cuando ya existe despacho aplicado (order_dispatch_events).
      { column: "status", op: "in", value: ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID", "KITCHEN_DISPATCHED"] }
    ]
  });

  if (!takeoutOrders || takeoutOrders.length === 0) return [];

  const takeoutOrderIds = takeoutOrders.map((order: any) => order.id).filter(Boolean);
  const dispatchEvents = takeoutOrderIds.length > 0
    ? await dbSelect<any>("order_dispatch_events", {
        select: "order_id",
        filters: [
          { column: "order_id", op: "in", value: takeoutOrderIds },
          { column: "status", op: "eq", value: "APPLIED" },
        ],
      })
    : [];
  const actuallyDispatchedOrderIds = new Set((dispatchEvents ?? []).map((event: any) => event.order_id));
  const creatorIds = Array.from(new Set(takeoutOrders.map((order: any) => order.created_by).filter(Boolean))) as string[];
  const creatorProfiles = creatorIds.length > 0
    ? await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, email",
        filters: [{ column: "id", op: "in", value: creatorIds }],
      })
    : [];
  const creatorNameMap = buildUserDisplayMap(creatorProfiles);

  return takeoutOrders
    .filter((sibling: any) => !actuallyDispatchedOrderIds.has(sibling.id))
    .map((sibling, index) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: sibling.order_code ?? null,
      status: sibling.status ?? null,
      created_by_name: sibling.created_by ? (creatorNameMap[sibling.created_by] ?? "Usuario") : null,
      split_code: null,
      table_order_position: Number(sibling.table_order_position ?? 0) || index + 1,
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
      total: Array.isArray(sibling.order_items)
        ? sibling.order_items.reduce((sum: number, item: any) => sum + Number(item.total ?? 0), 0)
        : 0,
    }))
    .sort((left, right) => {
      const leftPos = Number(left.table_order_position ?? Number.MAX_SAFE_INTEGER);
      const rightPos = Number(right.table_order_position ?? Number.MAX_SAFE_INTEGER);

      if (leftPos !== rightPos) {
        return leftPos - rightPos;
      }

      return Number(left.order_number ?? 0) - Number(right.order_number ?? 0);
    });
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

async function fetchOrderDetailInternal(orderId: string): Promise<Order | null> {
  const orders = await dbSelect<any>("orders", {
    select: "id, order_number, order_code, status, order_type, menu_scope, is_special, is_tray_order, special_total_manual, special_marked_at, branch_id, table_id, table_order_position, split_id, created_by, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, cancel_requested_at, table_name_snapshot, cash_shift_id",
    filters: [{ column: "id", op: "eq", value: orderId }]
  });
  
  const order = orders[0];
  if (!order) return null;

  const [
    tableResult,
    splitResult,
    items,
    snapshotResult,
    siblings,
    creatorProfiles,
  ] = await Promise.all([
    fetchOrderTableName(order.table_id),
    order.split_id
      ? dbSelect("table_splits", { select: "split_code", filters: [{ column: "id", op: "eq", value: order.split_id }] })
      : Promise.resolve([]),
    dbSelect<any>("order_items", {
      select: "id, product_id, description_snapshot, item_note, quantity, unit_price, total, status, paid_at, tray_item_type, tray_container_cost",
      filters: [{ column: "order_id", op: "eq", value: orderId }],
      orderBy: { column: "created_at" },
    }),
    supabase.rpc("get_order_operational_snapshot" as any, {
      p_order_id: orderId,
    }),
    order.table_id ? fetchSiblingOrders(order.table_id, order.branch_id) : Promise.resolve([] as SiblingOrder[]),
    order.created_by
      ? dbSelect<any>("profiles", {
          select: "id, first_name, full_name, username, email",
          filters: [{ column: "id", op: "eq", value: order.created_by }],
        })
      : Promise.resolve([]),
  ]);

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

  if (itemIds.length > 0) {
    const paymentItems = await dbSelect<any>("payment_items", {
      select: "payment_id, order_item_id, quantity_paid",
      filters: [{ column: "order_item_id", op: "in", value: itemIds }]
    });

    const paymentIds = Array.from(new Set((paymentItems ?? []).map((row: any) => row.payment_id).filter(Boolean)));
    let blockedPaymentIds = new Set<string>();

    if (paymentIds.length > 0) {
      const payments = await dbSelect<any>("payments", {
        select: "id, notes",
        filters: [{ column: "id", op: "in", value: paymentIds }]
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
  }

  let modifiersData: any[] = [];
  if (itemIds.length > 0) {
    const mods = await dbSelect<any>("order_item_modifiers", {
      select: "id, modifier_id, order_item_id, modifiers(description)",
      filters: [{ column: "order_item_id", op: "in", value: itemIds }]
    });
    modifiersData = mods ?? [];
  }

  const pendingRequestQtyByItem: Record<string, number> = {};
  if (order.cancel_requested_at) {
    const cancellations = await dbSelect<any>("order_cancellations", {
      select: "notes",
      filters: [
        { column: "order_id", op: "eq", value: orderId },
        { column: "status", op: "eq", value: "VOIDED" },
        { column: "notes", op: "is" as any, value: "not.null" }
      ],
      orderBy: { column: "created_at", ascending: false }
    });

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
      const hasOperationalProgress =
        quantityDispatched > 0 ||
        quantityReadyAvailable > 0 ||
        (activeQuantity > 0 && quantityPendingPrepare < activeQuantity);
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
    .filter((item) =>
      item.quantity > 0 ||
      item.status === "PAID" ||
      (item.status === "DRAFT" && Number(item.original_quantity ?? 0) > 0) ||
      (item.original_quantity > 0 && item.status !== "CANCELLED")
    );

  return {
    ...order,
    split_code: splitCode,
    table_name: tableName,
    created_by: order.created_by ?? null,
    created_by_name: order.created_by ? getUserDisplayName(creatorProfiles?.[0] ?? null) : null,
    items: enrichedItems,
    siblings,
  } as Order;
}

export async function fetchOrderDetail(orderId: string): Promise<Order | null> {
  return withOrderDetailTimeout(fetchOrderDetailInternal(orderId));
}

export function useOrder(orderId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: getOrderQueryKey(orderId),
    queryFn: () => (orderId ? fetchOrderDetail(orderId) : null),
    enabled: !!orderId,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      if (isTemporaryOrderItemId(itemId)) {
        throw new Error("El item aun se esta guardando. Espera un momento e intenta de nuevo.");
      }

      const { error } = await supabase.rpc("set_draft_order_item_quantity" as any, {
        p_item_id: itemId,
        p_quantity: 0,
        p_unit_price: null,
      });
      if (error) throw error;
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      
      if (previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: previousOrder.items.filter(item => item.id !== itemId),
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

      const { error } = await supabase.rpc("set_draft_order_item_quantity" as any, {
        p_item_id: itemId,
        p_quantity: quantity,
        p_unit_price: unit_price,
      });
      if (error) throw error;
    },
    onMutate: async ({ itemId, quantity, unit_price }) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      
      if (previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: previousOrder.items.flatMap(item => {
            if (item.id === itemId) {
              if (quantity <= 0) return [];

              const prevTotalCancelled = item.cancelled_quantity ?? 0;
              const newQuantityOrdered = quantity + prevTotalCancelled;
              return [{
                ...item,
                quantity: quantity,
                quantity_ordered: newQuantityOrdered,
                original_quantity: newQuantityOrdered,
                total: quantity * unit_price + (quantity > 0 ? (item.tray_container_cost ?? 0) : 0),
                quantity_remaining: item.status === "DRAFT" ? quantity : item.quantity_remaining,
              }];
            }
            return [item];
          })
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
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      if (branchId) {
        qc.invalidateQueries({ queryKey: ["takeout-orders", branchId] });
        qc.invalidateQueries({ queryKey: ["special-orders", branchId] });
      }
    },
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      const order = query.data;
      if (!order) return;

      const draftItems = order.items.filter((item) => item.status === "DRAFT");
      if (draftItems.length === 0) return;

      const { error } = await supabase.rpc("submit_order_draft_items" as any, {
        p_order_id: orderId!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const order = query.data;
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });

      const hasSentAlready = order?.items.some((item) => item.status !== "DRAFT");
      const message = hasSentAlready
        ? "Nuevos items listos para cobrar"
        : "Orden lista para cobrar en caja";

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
    addItem,
    removeItem,
    updateQuantity,
    sendToKitchen,
    moveToTable,
    createTableOrder,
    deleteTableOrder,
    updateMenuScope,
    updateSpecialTotal,
    convertToSpecial,
    closeOrder,
    lockOrder,
    unlockOrder,
  };
}
