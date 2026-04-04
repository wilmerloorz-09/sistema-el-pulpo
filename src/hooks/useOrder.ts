import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, dbDelete, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { generateUUID } from "@/lib/uuid";
import { computeLineAmount } from "@/lib/paymentQuantity";
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
  modifiers: { id: string; modifier_id: string; description: string }[];
}

interface SiblingOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  split_code: string;
  item_count: number;
}

function getSplitSortValue(splitCode: string): { prefix: string; rank: number; rawSuffix: string } {
  const normalized = String(splitCode ?? "").trim();
  const match = normalized.match(/^(.*?)(?:\s+([A-Z]|\d+))?$/i);
  const prefix = String(match?.[1] ?? normalized).trim().toUpperCase();
  const rawSuffix = String(match?.[2] ?? "").trim().toUpperCase();

  if (!rawSuffix) {
    return { prefix, rank: 0, rawSuffix };
  }

  if (/^\d+$/.test(rawSuffix)) {
    return { prefix, rank: Number(rawSuffix), rawSuffix };
  }

  const charCode = rawSuffix.charCodeAt(0);
  if (charCode >= 65 && charCode <= 90) {
    return { prefix, rank: charCode - 64, rawSuffix };
  }

  return { prefix, rank: Number.MAX_SAFE_INTEGER, rawSuffix };
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
  order_number: number;
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
  split_id: string | null;
  split_code?: string | null;
  table_name?: string;
  created_at: string;
  sent_to_kitchen_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  items: OrderItem[];
  siblings: SiblingOrder[];
}

export function getOrderQueryKey(orderId: string | null) {
  return ["order", orderId] as const;
}

async function fetchSiblingOrders(tableId: string): Promise<SiblingOrder[]> {
  const { data: siblingOrders, error: siblingOrdersError } = await supabase
    .from("orders")
    .select("id, order_number, order_code, split_id, order_items(id)")
    .eq("table_id", tableId)
    .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
    .not("split_id", "is", null);

  if (siblingOrdersError) throw siblingOrdersError;
  if (!siblingOrders || siblingOrders.length === 0) return [];

  const splitIds = [...new Set(siblingOrders.map((sibling) => sibling.split_id).filter(Boolean))] as string[];
  const { data: splits, error: splitsError } = await supabase
    .from("table_splits")
    .select("id, split_code")
    .in("id", splitIds);
  if (splitsError) throw splitsError;

  return siblingOrders
    .map((sibling) => ({
      id: sibling.id,
      order_number: sibling.order_number,
      order_code: (sibling as any).order_code ?? null,
      split_code: splits?.find((split) => split.id === sibling.split_id)?.split_code ?? "",
      item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
    }))
    .sort((left, right) => {
      const leftSort = getSplitSortValue(left.split_code);
      const rightSort = getSplitSortValue(right.split_code);

      if (leftSort.prefix !== rightSort.prefix) {
        return leftSort.prefix.localeCompare(rightSort.prefix, "es");
      }

      if (leftSort.rank !== rightSort.rank) {
        return leftSort.rank - rightSort.rank;
      }

      if (leftSort.rawSuffix !== rightSort.rawSuffix) {
        return leftSort.rawSuffix.localeCompare(rightSort.rawSuffix, "es");
      }

      return left.order_number - right.order_number;
    });
}

export async function fetchOrderDetail(orderId: string): Promise<Order | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_number, order_code, status, order_type, menu_scope, is_special, is_tray_order, special_total_manual, special_marked_at, branch_id, table_id, split_id, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at")
    .eq("id", orderId)
    .single();
  if (error) throw error;

  const [
    tableResult,
    splitResult,
    items,
    snapshotResult,
    siblings,
  ] = await Promise.all([
    order.table_id
      ? supabase.from("restaurant_tables").select("name").eq("id", order.table_id).single()
      : Promise.resolve({ data: null, error: null }),
    order.split_id
      ? supabase.from("table_splits").select("split_code").eq("id", order.split_id).single()
      : Promise.resolve({ data: null, error: null }),
    dbSelect<any>("order_items", {
      select: "id, product_id, description_snapshot, item_note, quantity, unit_price, total, status, tray_item_type, tray_container_cost",
      filters: [{ column: "order_id", op: "eq", value: orderId }],
      orderBy: { column: "created_at" },
    }),
    (supabase as any).rpc("get_order_operational_snapshot", {
      p_order_id: orderId,
    }) as Promise<{ data: OrderOperationalSnapshotRow[] | null; error: any }>,
    order.table_id ? fetchSiblingOrders(order.table_id) : Promise.resolve([] as SiblingOrder[]),
  ]);

  if (tableResult.error) throw tableResult.error;
  if (splitResult.error) throw splitResult.error;
  if (snapshotResult.error) throw snapshotResult.error;

  const normalizedSnapshotRows = normalizeSnapshotRows((snapshotResult.data ?? []) as OrderOperationalSnapshotRow[]);
  const snapshotMap = Object.fromEntries(
    normalizedSnapshotRows.map((row) => [String(row.order_item_id), row]),
  );
  const operationalMaps = normalizedSnapshotRows.length > 0
    ? buildOperationalMapsFromSnapshotRows(normalizedSnapshotRows)
    : EMPTY_OPERATIONAL_MAPS;
  const itemIds = items.map((item: any) => item.id);

  let modifiersData: any[] = [];
  if (itemIds.length > 0) {
    const { data: mods, error: modsError } = await supabase
      .from("order_item_modifiers")
      .select("id, modifier_id, order_item_id, modifiers(description)")
      .in("order_item_id", itemIds);
    if (modsError) throw modsError;
    modifiersData = mods ?? [];
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
      const effectiveStatus = activeQuantity <= 0 ? "CANCELLED" : (item.status ?? "DRAFT");
      const quantitySent = effectiveStatus === "DRAFT" ? 0 : quantityOrdered;
      const quantityDispatched = Math.max(
        0,
        Number(operationalMaps.dispatchedTotalMap[item.id] ?? 0) - Number(operationalMaps.cancelledDispatchedMap[item.id] ?? 0),
      );
      const quantityCancelled = Math.max(
        cancelledQuantity,
        Number(operationalMaps.cancelledTotalMap[item.id] ?? cancelledQuantity),
      );
      const quantityCancellable = Math.max(
        0,
        Number(operationalMaps.pendingPrepareMap[item.id] ?? 0)
          + Number(operationalMaps.readyAvailableMap[item.id] ?? 0)
          + quantityDispatched,
      );

      return {
        ...item,
        quantity: activeQuantity,
        quantity_ordered: quantityOrdered,
        original_quantity: originalQuantity,
        cancelled_quantity: cancelledQuantity,
        total: computeLineAmount(activeQuantity, Number(item.unit_price ?? 0)) + (activeQuantity > 0 ? Number(item.tray_container_cost ?? 0) : 0),
        status: effectiveStatus,
        tray_item_type: (item.tray_item_type ?? null) as "A" | "B" | "C" | null,
        tray_container_cost: Number(item.tray_container_cost ?? 0),
        quantity_sent: quantitySent,
        quantity_ready_available: Math.max(0, operationalMaps.readyAvailableMap[item.id] ?? 0),
        quantity_dispatched: quantityDispatched,
        quantity_remaining:
          effectiveStatus === "DRAFT"
            ? Math.max(0, activeQuantity)
            : Math.max(
                0,
                Number(operationalMaps.pendingPrepareMap[item.id] ?? 0) + Number(operationalMaps.readyAvailableMap[item.id] ?? 0),
              ),
        quantity_cancelled: quantityCancelled,
        quantity_cancellable: quantityCancellable,
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
    split_code: splitResult.data?.split_code ?? null,
    table_name: tableResult.data?.name,
    items: enrichedItems,
    siblings,
  } as Order;
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
      description_snapshot: string;
      item_note?: string | null;
      unit_price: number;
      quantity: number;
      modifier_ids: string[];
      tray_item_type?: "A" | "B" | "C";
      tray_container_cost?: number;
    }) => {
      const shouldUseTrayRpc = query.data?.is_tray_order === true;

      if (shouldUseTrayRpc) {
        const { error } = await supabase.rpc("add_tray_order_item", {
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

      const total = params.unit_price * params.quantity + (params.quantity > 0 ? (params.tray_container_cost ?? 0) : 0);
      const itemId = generateUUID();

      await dbInsert("order_items", {
        id: itemId,
        order_id: orderId!,
        product_id: params.product_id,
        description_snapshot: params.description_snapshot,
        item_note: params.item_note ?? null,
        unit_price: params.unit_price,
        quantity: params.quantity,
        total,
        status: "DRAFT",
        tray_item_type: params.tray_item_type ?? null,
        tray_container_cost: params.tray_container_cost ?? 0,
      });

      if (params.modifier_ids.length > 0) {
        for (const modifierId of params.modifier_ids) {
          await dbInsert("order_item_modifiers", {
            id: generateUUID(),
            order_item_id: itemId,
            modifier_id: modifierId,
          });
        }
      }
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
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      if (navigator.onLine) {
        await supabase.from("order_item_modifiers").delete().eq("order_item_id", itemId);
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
    },
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      const order = query.data;
      if (!order) return;

      const draftItems = order.items.filter((item) => item.status === "DRAFT");
      if (draftItems.length === 0) return;

      const now = new Date().toISOString();

      await Promise.all(
        draftItems.map((item) =>
          dbUpdate("order_items", item.id, {
            status: "SENT",
            sent_to_kitchen_at: now,
          })
        )
      );

      const shouldReopenDineInFlow =
        order.order_type === "DINE_IN"
        && order.status !== "CANCELLED"
        && order.status !== "DRAFT";

      if (order.status === "DRAFT" || shouldReopenDineInFlow) {
        const newStatus: OrderStatus = order.order_type === "TAKEOUT" ? "KITCHEN_DISPATCHED" : "SENT_TO_KITCHEN";
        const orderUpdate: Record<string, unknown> = {
          status: newStatus,
          updated_at: now,
        };

        if (newStatus === "SENT_TO_KITCHEN") {
          orderUpdate.sent_to_kitchen_at = now;
        }

        if (newStatus === "KITCHEN_DISPATCHED" && order.status === "DRAFT") {
          orderUpdate.dispatched_at = now;
        }

        await dbUpdate("orders", orderId!, orderUpdate);
      }
    },
    onSuccess: () => {
      const order = query.data;
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
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

      const { data, error } = await supabase.rpc("move_dine_in_order_to_table", {
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
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
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
    },
    onError: (err: any) => toast.error(err.message),
  });

  const convertToSpecial = useMutation({
    mutationFn: async (specialTotalManual: number | null) => {
      if (!orderId) {
        throw new Error("No se encontro la orden a convertir");
      }

      const { data, error } = await supabase.rpc("convert_order_to_special", {
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
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      toast.success("La orden ahora opera como orden especial");
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
    updateMenuScope,
    updateSpecialTotal,
    convertToSpecial,
  };
}
