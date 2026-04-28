import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDispatchConfig } from "./useDispatchConfig";
import { computeLineAmount } from "@/lib/paymentQuantity";
import type { OrderStatus } from "@/types/cancellation";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";
import type { DispatchView } from "@/hooks/useDispatchAccess";
import { buildUserDisplayMap } from "@/lib/userDisplay";

export interface DispatchOrderItem {
  id: string;
  description_snapshot: string;
  created_at?: string | null;
  quantity_ordered: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatchable: number;
  quantity_dispatched: number;
  quantity_cancelled: number;
  tray_item_type?: "A" | "B" | "C" | null;
  tray_container_cost?: number;
  status: string;
  modifiers: { description: string }[];
  item_note?: string | null;
  total?: number;
  sent_to_kitchen_at: string | null;
}

export interface DispatchOrder {
  card_id: string;
  id: string;
  order_number: number | null;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  is_special: boolean;
  is_tray_order?: boolean;
  created_by: string | null;
  created_by_name: string | null;
  table_name: string | null;
  split_code: string | null;
  status: OrderStatus;
  updated_at: string;
  sent_to_kitchen_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  pending_prepare_count: number;
  ready_available_count: number;
  dispatchable_count: number;
  items: DispatchOrderItem[];
  locked_for_editing?: boolean;
}

export interface OperationPayload {
  orderId: string;
  operationType: "partial" | "total";
  items: Array<Record<string, unknown>>;
}

function invalidateOperationalQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
  qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
  qc.invalidateQueries({ queryKey: ["payable-orders"] });
  qc.invalidateQueries({ queryKey: ["orders"] });
  qc.invalidateQueries({ queryKey: ["tables-with-status"] });
}

function sortByBatchArrival<T extends { sent_to_kitchen_at: string | null; updated_at: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.sent_to_kitchen_at ?? left.updated_at).getTime();
    const rightTime = new Date(right.sent_to_kitchen_at ?? right.updated_at).getTime();
    return leftTime - rightTime;
  });
}

function matchesScope(orderType: string, scope: DispatchView) {
  if (scope === "ALL") return orderType === "DINE_IN" || orderType === "TABLE" || orderType === "TAKEOUT";
  if (scope === "SPECIAL") return false;
  if (scope === "TABLE") return orderType === "DINE_IN" || orderType === "TABLE";
  return orderType === "TAKEOUT";
}

/**
 * Fuzzy Grouping Logic:
 * Items in the same order that were sent to kitchen within 2 seconds of each other
 * are considered part of the same "batch" (card).
 */
function groupItemsIntoBatches(order: any, items: any[], modifiersMap: Record<string, any[]>, operationalMaps: any): DispatchOrder[] {
  const {
    readyMap,
    readyAvailableMap,
    pendingPrepareMap,
    dispatchedTotalMap,
    cancelledPendingMap,
    cancelledReadyMap,
    cancelledDispatchedMap,
  } = operationalMaps;

  // Filter and map items
  const mappedItems: DispatchOrderItem[] = items
    .filter((item) => item.order_id === order.id && !!(item.sent_to_kitchen_at ?? order.sent_to_kitchen_at))
    .map((item) => {
      const quantities = computeOperationalQuantities({
        quantityOrdered: Number(item.quantity ?? 0),
        quantityReadyTotal: readyMap[item.id] ?? 0,
        quantityDispatchedTotal: dispatchedTotalMap[item.id] ?? 0,
        quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
        quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
        quantityCancelledDispatched: cancelledDispatchedMap[item.id] ?? 0,
      });

      const quantityPendingPrepare = pendingPrepareMap[item.id] ?? quantities.quantityPendingPrepare;
      const quantityReadyAvailable = readyAvailableMap[item.id] ?? quantities.quantityReadyAvailable;
      const activeQuantity = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);

      return {
        id: item.id,
        description_snapshot: item.description_snapshot,
        created_at: item.created_at ?? null,
        quantity_ordered: quantities.quantityOrdered,
        quantity_pending_prepare: quantityPendingPrepare,
        quantity_ready_available: quantityReadyAvailable,
        quantity_dispatchable: quantityPendingPrepare + quantityReadyAvailable,
        quantity_dispatched: quantities.quantityDispatchedAvailable,
        quantity_cancelled: quantities.quantityCancelledTotal,
        tray_item_type: item.tray_item_type ?? null,
        tray_container_cost: Number(item.tray_container_cost ?? 0),
        status: item.status ?? "SENT",
        total: computeLineAmount(activeQuantity, Number(item.unit_price ?? 0)),
        modifiers: modifiersMap[item.id] ?? [],
        item_note: item.item_note ?? null,
        sent_to_kitchen_at: item.sent_to_kitchen_at ?? order.sent_to_kitchen_at,
      };
    })
    .filter((item) => item.quantity_ordered - item.quantity_cancelled > 0 && !!item.sent_to_kitchen_at);

  if (mappedItems.length === 0) return [];

  // Fuzzy Batching: Sort by sent_to_kitchen_at and group within a window
  const sortedByTime = [...mappedItems].sort((a, b) => {
    const tA = new Date(a.sent_to_kitchen_at!).getTime();
    const tB = new Date(b.sent_to_kitchen_at!).getTime();
    return tA - tB;
  });

  const batches: DispatchOrderItem[][] = [];
  let currentBatch: DispatchOrderItem[] = [];
  let lastTime: number | null = null;

  for (const item of sortedByTime) {
    const currentTime = new Date(item.sent_to_kitchen_at!).getTime();
    if (lastTime === null || currentTime - lastTime <= 2000) {
      currentBatch.push(item);
    } else {
      batches.push(currentBatch);
      currentBatch = [item];
    }
    lastTime = currentTime;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  return batches.map((batchItems) => {
    // Principal timestamp for the card
    const sentAt = batchItems[0].sent_to_kitchen_at!;
    
    const sortedBatchItems = [...batchItems].sort((left, right) => {
      const leftTime = new Date(left.created_at ?? sentAt).getTime();
      const rightTime = new Date(right.created_at ?? sentAt).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.id.localeCompare(right.id, "es");
    });

    const pendingPrepareCount = batchItems.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
    const readyAvailableCount = batchItems.reduce((sum, item) => sum + item.quantity_ready_available, 0);
    const dispatchableCount = batchItems.reduce((sum, item) => sum + item.quantity_dispatchable, 0);

    return {
      card_id: `${order.id}:${sentAt}`,
      id: order.id,
      order_number: order.order_number,
      order_code: order.order_code,
      order_type: order.order_type as "DINE_IN" | "TAKEOUT",
      is_special: Boolean(order.is_special),
      is_tray_order: Boolean(order.is_tray_order),
      created_by: order.created_by ?? null,
      created_by_name: order.created_by_name ?? null,
      table_name: order.table_name ?? null,
      split_code: order.split_code ?? null,
      status: order.status,
      updated_at: order.updated_at,
      sent_to_kitchen_at: sentAt,
      ready_at: order.ready_at ?? null,
      dispatched_at: order.dispatched_at ?? null,
      paid_at: order.paid_at ?? null,
      cancelled_at: order.cancelled_at ?? null,
      pending_prepare_count: pendingPrepareCount,
      ready_available_count: readyAvailableCount,
      dispatchable_count: dispatchableCount,
      items: sortedBatchItems,
      locked_for_editing: Boolean(order.locked_for_editing),
    };
  });
}

export function useDispatchOrders(scope: DispatchView) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: configLoading } = useDispatchConfig();

  const query = useQuery({
    queryKey: ["dispatch-orders", activeBranchId, config?.dispatch_mode, user?.id, scope],
    queryFn: async () => {
      if (!activeBranchId || !user) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const orders = await dbSelect<any>("orders", {
        select: "id, order_number, order_code, order_type, is_special, is_tray_order, created_by, table_id, split_id, status, updated_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, locked_for_editing",
        branchId: activeBranchId,
        filters: [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }],
        orderBy: { column: "updated_at", ascending: true }
      });

      if (!orders || orders.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const creatorIds = Array.from(new Set(orders.map((order) => order.created_by).filter(Boolean))) as string[];
      const creatorProfiles = creatorIds.length > 0
        ? await dbSelect<any>("profiles", {
            select: "id, full_name, username, email",
            filters: [{ column: "id", op: "in", value: creatorIds }],
          })
        : [];
      const creatorNameMap = buildUserDisplayMap(creatorProfiles);

      const dispatchMode = configLoading ? "SINGLE" : config?.dispatch_mode || "SINGLE";
      const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
      const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));

      const getPermittedForView = (v: DispatchView) => {
        let baseFiltered = orders.filter((order) => {
          if (v === "SPECIAL") return Boolean(order.is_special);
          if (v === "TABLE") return matchesScope(order.order_type, v) && !Boolean(order.is_special);
          return matchesScope(order.order_type, v);
        });

        if (dispatchMode === "SPLIT") {
          if (userAssignments.length > 0 && !assignedTypes.has("ALL")) {
            baseFiltered = baseFiltered.filter((order) => {
              const orderType = order.order_type === "DINE_IN" || order.order_type === "TABLE" ? "TABLE" : "TAKEOUT";
              return assignedTypes.has(orderType);
            });
          }
        }
        return baseFiltered;
      };

      const counts = {
        ALL: getPermittedForView("ALL").length,
        TABLE: getPermittedForView("TABLE").length,
        TAKEOUT: getPermittedForView("TAKEOUT").length,
        SPECIAL: getPermittedForView("SPECIAL").length,
      };

      const permittedOrders = getPermittedForView(scope);
      if (permittedOrders.length === 0) return { orders: [], counts };

      const orderIds = permittedOrders.map((order) => order.id);
      const tableIdSet = new Set<string>(permittedOrders.map((order: any) => order.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      const splitIdSet = new Set<string>(permittedOrders.map((order: any) => order.split_id).filter(Boolean));
      const splitIds = Array.from(splitIdSet);

      const [tables, splits, items] = await Promise.all([
        tableIds.length > 0 ? dbSelect("restaurant_tables", { filters: [{ column: "id", op: "in", value: tableIds }] }) : Promise.resolve([]),
        splitIds.length > 0 ? dbSelect("table_splits", { filters: [{ column: "id", op: "in", value: splitIds }] }) : Promise.resolve([]),
        dbSelect("order_items", { filters: [{ column: "order_id", op: "in", value: orderIds }] })
      ]);

      const tablesMap = Object.fromEntries((tables ?? []).map((t: any) => [t.id, t.name]));
      const splitsMap = Object.fromEntries((splits ?? []).map((s: any) => [s.id, s.split_code]));

      const itemIds = (items ?? []).map((item: any) => item.id);
      const modifiersMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const modifierRows = await dbSelect<any>("order_item_modifiers", {
          select: "order_item_id, modifiers(description)",
          filters: [{ column: "order_item_id", op: "in", value: itemIds }]
        });

        for (const row of modifierRows ?? []) {
          if (!modifiersMap[row.order_item_id]) modifiersMap[row.order_item_id] = [];
          const rawDescription = Array.isArray(row.modifiers)
            ? row.modifiers[0]?.description
            : row.modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          modifiersMap[row.order_item_id].push({ description });
        }
      }

      const operationalMaps = await fetchOperationalMapsForOrders(orderIds);

      const cards = permittedOrders.flatMap((order) => {
        const orderWithContext = {
          ...order,
          created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? "Usuario") : null,
          table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
          split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
        };
        return groupItemsIntoBatches(orderWithContext, items, modifiersMap, operationalMaps);
      });

      return {
        orders: sortByBatchArrival(cards)
          .filter((order) => order.items.length > 0 && (order.pending_prepare_count > 0 || order.ready_available_count > 0)) as DispatchOrder[],
        counts
      };
    },
    enabled: !!activeBranchId && !!user,
    refetchInterval: 5000,
  });

  const applyReadyOperation = useMutation({
    mutationFn: async (payload: OperationPayload) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await supabase.rpc("mark_order_quantities_ready" as any, {
        p_order_id: payload.orderId,
        p_ready_by: user.id,
        p_items: payload.items as any,
        p_operation_type: payload.operationType,
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Operacion de listo aplicada");
    },
    onError: (error: any) => {
      toast.error(`Error al aplicar listo: ${error?.message || "Error desconocido"}`);
    },
  });

  const applyDispatchOperation = useMutation({
    mutationFn: async (payload: OperationPayload) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await supabase.rpc("dispatch_order_quantities" as any, {
        p_order_id: payload.orderId,
        p_dispatched_by: user.id,
        p_items: payload.items as any,
        p_operation_type: payload.operationType,
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Operacion de despacho aplicada");
    },
    onError: (error: any) => {
      toast.error(`Error al aplicar despacho: ${error?.message || "Error desconocido"}`);
    },
  });

  const markItemReady = useMutation({
    mutationFn: async ({ orderId }: { orderId: string; itemId: string; qty: number }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await supabase.rpc("emit_order_ready_alert" as any, {
        p_order_id: orderId,
        p_emitted_by: user.id,
        p_source_module: "dispatch",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Alerta de listo enviada");
    },
    onError: (error: any) => {
      toast.error(`Error al marcar listo: ${error?.message || "Error desconocido"}`);
    },
  });

  const sendOrderReadyAlert = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await supabase.rpc("emit_order_ready_alert", {
        p_order_id: orderId,
        p_emitted_by: user.id,
        p_source_module: "dispatch",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Alerta de listo enviada");
    },
    onError: (error: any) => {
      toast.error(`Error al emitir alerta: ${error?.message || "Error desconocido"}`);
    },
  });

  const dispatchItem = useMutation({
    mutationFn: async ({ orderId, itemId, qty }: { orderId: string; itemId: string; qty: number }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await supabase.rpc("dispatch_order_quantities" as any, {
        p_order_id: orderId,
        p_dispatched_by: user.id,
        p_items: [{ order_item_id: itemId, quantity_dispatched: qty }] as any,
        p_operation_type: "partial",
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Item despachado");
    },
    onError: (error: any) => {
      toast.error(`Error al despachar item: ${error?.message || "Error desconocido"}`);
    },
  });

  return {
    orders: query.data?.orders || [],
    counts: query.data?.counts || { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 },
    isLoading: query.isLoading,
    isError: query.isError,
    applyReadyOperation,
    applyDispatchOperation,
    markItemReady,
    sendOrderReadyAlert,
    dispatchItem,
  };
}
