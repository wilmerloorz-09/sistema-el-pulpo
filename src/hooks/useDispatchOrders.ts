import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDispatchConfig } from "./useDispatchConfig";
import { computeLineAmount } from "@/lib/paymentQuantity";
import type { OrderStatus } from "@/types/cancellation";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";
import type { DispatchView } from "@/hooks/useDispatchAccess";

export interface DispatchOrderItem {
  id: string;
  description_snapshot: string;
  quantity_ordered: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatched: number;
  quantity_cancelled: number;
  status: string;
  modifiers: { description: string }[];
  item_note?: string | null;
  total?: number;
  sent_to_kitchen_at: string | null;
}

export interface DispatchOrder {
  card_id: string;
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
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
  items: DispatchOrderItem[];
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
  if (scope === "TABLE") return orderType === "DINE_IN" || orderType === "TABLE";
  return orderType === "TAKEOUT";
}

export function useDispatchOrders(scope: DispatchView) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: configLoading } = useDispatchConfig();

  const query = useQuery({
    queryKey: ["dispatch-orders", activeBranchId, config?.dispatch_mode, user?.id, scope],
    queryFn: async () => {
      if (!activeBranchId || !user) return [];

      const dispatchMode = configLoading ? "SINGLE" : config?.dispatch_mode || "SINGLE";

      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, order_number, order_code, order_type, table_id, split_id, status, updated_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at")
        .eq("branch_id", activeBranchId)
        .in("status", ["SENT_TO_KITCHEN", "READY"])
        .order("updated_at", { ascending: true });

      if (ordersError) throw ordersError;
      if (!orders || orders.length === 0) return [];

      const permittedOrders = orders.filter((order) => matchesScope(order.order_type, scope));
      if (permittedOrders.length === 0) return [];

      const tableIds = [...new Set(permittedOrders.map((order) => order.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((table) => [table.id, table.name]));
      }

      const splitIds = [...new Set(permittedOrders.map((order) => order.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((split) => [split.id, split.split_code]));
      }

      const orderIds = permittedOrders.map((order) => order.id);
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("id, order_id, description_snapshot, item_note, quantity, unit_price, status, sent_to_kitchen_at")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const itemIds = (items ?? []).map((item) => item.id);
      const modifiersMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: modifierRows } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);

        for (const row of modifierRows ?? []) {
          if (!modifiersMap[row.order_item_id]) modifiersMap[row.order_item_id] = [];
          const rawDescription = Array.isArray((row as any).modifiers)
            ? (row as any).modifiers[0]?.description
            : (row as any).modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          modifiersMap[row.order_item_id].push({ description });
        }
      }

      const { readyMap, dispatchedTotalMap, cancelledPendingMap, cancelledReadyMap, cancelledDispatchedMap } =
        await fetchOperationalMapsForOrders(orderIds);

      let filteredOrders = permittedOrders;
      if (dispatchMode === "SPLIT") {
        const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
        if (userAssignments.length > 0) {
          const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));
          filteredOrders = permittedOrders.filter((order) => {
            const orderType = order.order_type === "DINE_IN" || order.order_type === "TABLE" ? "TABLE" : "TAKEOUT";
            return assignedTypes.has(orderType) || assignedTypes.has("ALL");
          });
        }
      }

      const cards = filteredOrders.flatMap((order) => {
        const mappedItems = ((items ?? []) as any[])
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

            const activeQuantity = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);

            return {
              id: item.id,
              description_snapshot: item.description_snapshot,
              quantity_ordered: quantities.quantityOrdered,
              quantity_pending_prepare: quantities.quantityPendingPrepare,
              quantity_ready_available: quantities.quantityReadyAvailable,
              quantity_dispatched: quantities.quantityDispatchedAvailable,
              quantity_cancelled: quantities.quantityCancelledTotal,
              status: item.status ?? "SENT",
              total: computeLineAmount(activeQuantity, Number(item.unit_price ?? 0)),
              modifiers: modifiersMap[item.id] ?? [],
              item_note: item.item_note ?? null,
              sent_to_kitchen_at: item.sent_to_kitchen_at ?? order.sent_to_kitchen_at,
            };
          })
          .filter((item) => item.quantity_ordered - item.quantity_cancelled > 0 && !!item.sent_to_kitchen_at);

        const batches = new Map<string, DispatchOrderItem[]>();
        for (const item of mappedItems) {
          const batchKey = item.sent_to_kitchen_at as string;
          if (!batches.has(batchKey)) batches.set(batchKey, []);
          batches.get(batchKey)!.push(item);
        }

        return Array.from(batches.entries()).map(([sentAt, batchItems]) => {
          const pendingPrepareCount = batchItems.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
          const readyAvailableCount = batchItems.reduce((sum, item) => sum + item.quantity_ready_available, 0);

          return {
            card_id: `${order.id}:${sentAt}`,
            id: order.id,
            order_number: order.order_number,
            order_code: order.order_code,
            order_type: order.order_type as "DINE_IN" | "TAKEOUT",
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
            status: order.status,
            updated_at: order.updated_at,
            sent_to_kitchen_at: sentAt,
            ready_at: order.ready_at ?? null,
            dispatched_at: order.dispatched_at ?? null,
            paid_at: order.paid_at ?? null,
            cancelled_at: order.cancelled_at ?? null,
            pending_prepare_count: pendingPrepareCount,
            ready_available_count: readyAvailableCount,
            items: batchItems,
          };
        });
      });

      return sortByBatchArrival(cards)
        .filter((order) => order.items.length > 0 && (order.pending_prepare_count > 0 || order.ready_available_count > 0)) as DispatchOrder[];
    },
    enabled: !!activeBranchId && !!user,
    refetchInterval: 5000,
  });

  const applyReadyOperation = useMutation({
    mutationFn: async (payload: OperationPayload) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const { error } = await (supabase as any).rpc("mark_order_quantities_ready", {
        p_order_id: payload.orderId,
        p_ready_by: user.id,
        p_items: payload.items,
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
      const { error } = await (supabase as any).rpc("dispatch_order_quantities", {
        p_order_id: payload.orderId,
        p_dispatched_by: user.id,
        p_items: payload.items,
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

  return {
    orders: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    applyReadyOperation,
    applyDispatchOperation,
  };
}
