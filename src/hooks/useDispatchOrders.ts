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
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { getOpenCashShiftIdForBranch } from "@/lib/openCashShift";

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
  unit_price: number;
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

function groupItemsIntoDispatchCards(order: any, items: any[], modifiersMap: Record<string, any[]>, operationalMaps: any): DispatchOrder[] {
  const {
    readyMap,
    readyAvailableMap,
    pendingPrepareMap,
    dispatchedTotalMap,
    cancelledPendingMap,
    cancelledReadyMap,
    cancelledDispatchedMap,
  } = operationalMaps;

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
        unit_price: Number(item.unit_price ?? 0),
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

  const sentAt = mappedItems
    .map((item) => item.sent_to_kitchen_at)
    .filter(Boolean)
    .sort((left, right) => new Date(left!).getTime() - new Date(right!).getTime())[0]!;

  const sortedItems = [...mappedItems].sort((left, right) => {
    const leftTime = new Date(left.created_at ?? left.sent_to_kitchen_at ?? sentAt).getTime();
    const rightTime = new Date(right.created_at ?? right.sent_to_kitchen_at ?? sentAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id, "es");
  });

  const pendingPrepareCount = sortedItems.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
  const readyAvailableCount = sortedItems.reduce((sum, item) => sum + item.quantity_ready_available, 0);
  const dispatchableCount = sortedItems.reduce((sum, item) => sum + item.quantity_dispatchable, 0);

  return [{
    card_id: order.id,
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
    items: sortedItems,
    locked_for_editing: Boolean(order.locked_for_editing),
  }];
}

export function useDispatchOrders(scope: DispatchView) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: configLoading } = useDispatchConfig();
  const { data: shiftGate } = useBranchShiftGate();

  const query = useQuery({
    queryKey: ["dispatch-orders", activeBranchId, config?.dispatch_mode, user?.id, scope, shiftGate?.shiftId ?? "_"],
    queryFn: async () => {
      if (!activeBranchId || !user) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const openShiftId = await getOpenCashShiftIdForBranch(activeBranchId);
      if (!openShiftId) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const orders = await dbSelect<any>("orders", {
        select: "id, order_number, order_code, order_type, is_special, is_tray_order, created_by, table_id, split_id, status, updated_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, locked_for_editing",
        branchId: activeBranchId,
        filters: [
          { column: "status", op: "eq", value: "PAID" },
          { column: "cash_shift_id", op: "eq", value: openShiftId },
        ],
        orderBy: { column: "updated_at", ascending: true }
      });

      if (!orders || orders.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      // Exclude orders where ALL payments are voided - they should not appear in dispatch
      const allOrderIds = orders.map((o) => o.id);
      const paymentsForOrders = await dbSelect<any>("payments", {
        select: "order_id, notes, status",
        filters: [{ column: "order_id", op: "in", value: allOrderIds }],
      });
      const ordersWithActivePayment = new Set<string>();
      const ordersWithAnyPayment = new Set<string>();
      for (const p of paymentsForOrders ?? []) {
        ordersWithAnyPayment.add(p.order_id);
        const isVoided = String(p.notes ?? "").includes("VOIDED:") || p.status === "voided";
        if (!isVoided) ordersWithActivePayment.add(p.order_id);
      }
      const activeOrders = orders.filter((o) =>
        !ordersWithAnyPayment.has(o.id) || ordersWithActivePayment.has(o.id)
      );
      if (activeOrders.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const creatorIds = Array.from(new Set(activeOrders.map((order) => order.created_by).filter(Boolean))) as string[];
      const creatorProfiles = creatorIds.length > 0
        ? await dbSelect<any>("profiles", {
            select: "id, first_name, full_name, username, email",
            filters: [{ column: "id", op: "in", value: creatorIds }],
          })
        : [];
      const creatorNameMap = buildUserDisplayMap(creatorProfiles);

      const dispatchMode = configLoading ? "SINGLE" : config?.dispatch_mode || "SINGLE";
      const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
      const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));

      const getPermittedForView = (v: DispatchView, source: any[]) => {
        let baseFiltered = source.filter((order) => {
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

      const allPermittedOrders = getPermittedForView("ALL", activeOrders);
      if (allPermittedOrders.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const orderIdsToFetch = allPermittedOrders.map((order) => order.id);
      const tableIdSet = new Set<string>(allPermittedOrders.map((order: any) => order.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      const splitIdSet = new Set<string>(allPermittedOrders.map((order: any) => order.split_id).filter(Boolean));
      const splitIds = Array.from(splitIdSet);

      const [tables, splits, items] = await Promise.all([
        tableIds.length > 0 ? dbSelect("restaurant_tables", { filters: [{ column: "id", op: "in", value: tableIds }] }) : Promise.resolve([]),
        splitIds.length > 0 ? dbSelect("table_splits", { filters: [{ column: "id", op: "in", value: splitIds }] }) : Promise.resolve([]),
        dbSelect("order_items", { filters: [{ column: "order_id", op: "in", value: orderIdsToFetch }] })
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

      const operationalMaps = await fetchOperationalMapsForOrders(orderIdsToFetch);

      const allCards = allPermittedOrders.flatMap((order) => {
        const orderWithContext = {
          ...order,
          created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? "Usuario") : null,
          table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
          split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
        };
        return groupItemsIntoDispatchCards(orderWithContext, items, modifiersMap, operationalMaps);
      }).filter((card) => card.items.length > 0 && (card.pending_prepare_count > 0 || card.ready_available_count > 0));

      const counts = {
        ALL: allCards.length,
        TABLE: allCards.filter(c => !c.is_special && (c.order_type === "DINE_IN" || c.order_type === "TABLE")).length,
        TAKEOUT: allCards.filter(c => c.order_type === "TAKEOUT").length,
        SPECIAL: allCards.filter(c => c.is_special).length,
      };

      const filteredCards = sortByBatchArrival(getPermittedForView(scope, allCards)) as DispatchOrder[];

      return {
        orders: filteredCards,
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

  const dispatchOrder = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");

      const currentOrder = query.data?.orders.find((order) => order.id === orderId);
      if (!currentOrder) throw new Error("No se encontro la orden para despachar");

      const dispatchableItems = currentOrder.items
        .filter((item) => Number(item.quantity_dispatchable ?? 0) > 0)
        .map((item) => ({
          order_item_id: item.id,
          quantity_dispatched: Number(item.quantity_dispatchable ?? 0),
        }));

      if (dispatchableItems.length === 0) {
        throw new Error("La orden no tiene cantidades pendientes de despacho");
      }

      const { error } = await supabase.rpc("dispatch_order_quantities" as any, {
        p_order_id: orderId,
        p_dispatched_by: user.id,
        p_items: dispatchableItems as any,
        p_operation_type: "total",
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOperationalQueries(qc);
      toast.success("Orden despachada");
    },
    onError: (error: any) => {
      toast.error(`Error al despachar orden: ${error?.message || "Error desconocido"}`);
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
    dispatchOrder,
  };
}
