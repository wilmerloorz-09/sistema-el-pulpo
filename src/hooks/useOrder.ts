import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, dbDelete, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { generateUUID } from "@/lib/uuid";
import { computeLineTotalWithContainer } from "@/lib/paymentQuantity";
import {
  buildOperationalMapsFromSnapshotRows,
  EMPTY_OPERATIONAL_MAPS,
  normalizeSnapshotRows,
  type OrderOperationalSnapshotRow,
} from "@/lib/orderOperational";

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

export interface SiblingOrder {
  id: string;
  order_number: number | null;
  order_code: string | null;
  split_code: string | null;
  table_order_position: number | null;
  item_count: number;
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

export async function fetchSiblingOrders(tableId: string): Promise<SiblingOrder[]> {
  const siblingOrders = await dbSelect<any>("orders", {
    select: "id, order_number, order_code, split_id, table_order_position, status, created_at, order_items(id)",
    filters: [
      { column: "table_id", op: "eq", value: tableId },
      { column: "order_type", op: "eq", value: "DINE_IN" },
      { column: "status", op: "in", value: ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"] }
    ]
  });

  if (!siblingOrders || siblingOrders.length === 0) return [];

  const splitIds = Array.from(new Set(siblingOrders.map((sibling: any) => sibling.split_id).filter(Boolean))) as string[];
  const splits = splitIds.length > 0 
    ? await dbSelect("table_splits", {
        select: "id, split_code",
        filters: [{ column: "id", op: "in", value: splitIds }]
      })
    : [];

  return siblingOrders
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

async function fetchOrderDetailInternal(orderId: string): Promise<Order | null> {
  const orders = await dbSelect<any>("orders", {
    select: "id, order_number, order_code, status, order_type, menu_scope, is_special, special_total_manual, special_marked_at, branch_id, table_id, table_order_position, split_id, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, cancel_requested_at, table_name_snapshot",
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
  ] = await Promise.all([
    order.table_id
      ? dbSelect("restaurant_tables", { select: "name", filters: [{ column: "id", op: "eq", value: order.table_id }] })
      : Promise.resolve([]),
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
    order.table_id ? fetchSiblingOrders(order.table_id) : Promise.resolve([] as SiblingOrder[]),
  ]);

  const tableName = tableResult[0]?.name ?? order.table_name_snapshot;
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
        total: computeLineTotalWithContainer(
          unpaidActiveQuantity,
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
    .filter((item) => item.quantity > 0 || item.status === "DRAFT");

  return {
    ...order,
    split_code: splitCode,
    table_name: tableName,
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
    mutationFn: async (params: {
      product_id: string;
      menu_node_id?: string | null;
      description_snapshot: string;
      item_note?: string | null;
      unit_price: number;
      quantity: number;
      modifier_ids: string[];
      tray_item_type?: "A" | "B" | "C";
      tray_container_cost?: number;
    }) => {
      const isTrayOrder = query.data?.is_tray_order === true;

      if (isTrayOrder) {
        const { error } = await supabase.rpc("add_tray_order_item" as any, {
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
        return;
      }

      const { error } = await supabase.rpc("add_dine_in_order_item" as any, {
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
    },
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      
      if (previousOrder) {
        const optimisticItem: OrderItem = {
          id: `temp-${Date.now()}`,
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
          modifiers: params.modifier_ids.map(id => ({ id: `temp-mod-${id}`, modifier_id: id, description: "" })),
        };
        
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: [...previousOrder.items, optimisticItem],
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
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const modifiers = await dbSelect<any>("order_item_modifiers", {
        select: "id",
        filters: [{ column: "order_item_id", op: "eq", value: itemId }]
      });
      
      for (const mod of modifiers) {
        await dbDelete("order_item_modifiers", mod.id);
      }
      
      await dbDelete("order_items", itemId);
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
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
    },
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ itemId, quantity, unit_price }: { itemId: string; quantity: number; unit_price: number }) => {
      await dbUpdate("order_items", itemId, { quantity, total: quantity * unit_price });
    },
    onMutate: async ({ itemId, quantity, unit_price }) => {
      await qc.cancelQueries({ queryKey: getOrderQueryKey(orderId) });
      const previousOrder = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
      
      if (previousOrder) {
        qc.setQueryData(getOrderQueryKey(orderId), {
          ...previousOrder,
          items: previousOrder.items.map(item => {
            if (item.id === itemId) {
              const prevTotalCancelled = item.cancelled_quantity ?? 0;
              const newQuantityOrdered = quantity + prevTotalCancelled;
              return {
                ...item,
                quantity: quantity,
                quantity_ordered: newQuantityOrdered,
                original_quantity: newQuantityOrdered,
                total: quantity * unit_price + (quantity > 0 ? (item.tray_container_cost ?? 0) : 0),
                quantity_remaining: item.status === "DRAFT" ? quantity : item.quantity_remaining,
              };
            }
            return item;
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
      qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
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
      const message = order?.order_type === "TAKEOUT"
        ? hasSentAlready
          ? "Nuevos items listos para cobrar"
          : "Orden lista para cobrar en caja"
        : hasSentAlready
          ? "Nuevos items enviados a cocina"
          : "Orden enviada a cocina";

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
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
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
