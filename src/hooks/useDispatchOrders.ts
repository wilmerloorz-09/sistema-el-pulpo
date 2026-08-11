import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelectStrict, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { ensureDispatchBootstrap } from "./useDispatchConfig";
import { computeLineAmount } from "@/lib/paymentQuantity";
import type { OrderStatus } from "@/types/cancellation";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";
import { fetchActivePaidQuantityByOrderItemId } from "@/lib/orderItemActivePayments";
import type { DispatchView } from "@/hooks/useDispatchAccess";
import { buildUserDisplayMap } from "@/lib/userDisplay";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { getOpenCashShiftForBranch, orderBelongsToOpenCashShift, repairOpenShiftOrderCashShiftIds } from "@/lib/openCashShift";
import { ensurePlatosProductIdsForBranch, isPlatosOrderItem } from "@/lib/menuPlatosCategory";
import { buildDispatchAllocations, consolidateDispatchOrderItems } from "@/lib/dispatchItemConsolidation";
import {
  fetchDispatchServirQueueBundleFresh,
  operationalMapsFromBundleItems,
  paidQtyMapFromBundleItems,
} from "@/lib/dispatchServirQueueBundle";
import { qk } from "@/lib/queryKeys";
import {
  OPERATIONAL_STALE_MS,
  OPERATIONAL_LIST_BACKUP_POLL_MS,
  useAdaptiveRefetchInterval,
  useOperationalOrdersRealtime,
  invalidateOperationalOrderQueries,
} from "@/lib/queryEgress";

export type DispatchOrdersModule = "dispatch" | "servir";

export interface UseDispatchOrdersOptions {
  module?: DispatchOrdersModule;
}

export interface DispatchOrderItem {
  id: string;
  description_snapshot: string;
  created_at?: string | null;
  quantity_ordered: number;
  /** Cantidad cubierta por pagos activos (payment_items); puede ser > 0 aunque la fila operativa muestre 0 pendiente por inconsistencias o cobro antes de despacho. */
  quantity_paid: number;
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
  /** Unidades de la linea en el grupo especial (orden especial mixta). */
  cantidad_especial?: number;
  sent_to_kitchen_at: string | null;
  /** Marcador de linea cubierta en caja (sync_order_payment_state); util si el snapshot aun no refleja quantity_paid. */
  paid_at: string | null;
  /** IDs de order_items agrupados cuando la linea esta consolidada en UI. */
  group_item_ids?: string[];
  /** Desglose por linea original para repartir despachos parciales. */
  source_lines?: Array<{
    id: string;
    quantity_dispatchable: number;
    quantity_pending_prepare: number;
    quantity_ready_available: number;
    quantity_dispatched: number;
  }>;
}

export interface DispatchOrder {
  card_id: string;
  id: string;
  order_number: number | null;
  order_code: string | null;
  order_type: "DINE_IN" | "TABLE" | "TAKEOUT" | "EXPRESS" | "EXTRA";
  is_special: boolean;
  is_tray_order?: boolean;
  is_packer_order?: boolean;
  special_total_manual?: number | null;
  /** Valor manual del grupo especial (orden mixta). */
  special_group_total?: number | null;
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

type DispatchOrdersCache = {
  orders: DispatchOrder[];
  counts: { ALL: number; TABLE: number; TAKEOUT: number; SPECIAL: number };
};

function recountDispatchCards(cards: DispatchOrder[]): DispatchOrdersCache["counts"] {
  return {
    ALL: cards.length,
    TABLE: cards.filter((c) => !c.is_special && (c.order_type === "DINE_IN" || c.order_type === "TABLE" || c.order_type === "EXTRA")).length,
    TAKEOUT: cards.filter((c) => c.order_type === "TAKEOUT" || c.order_type === "EXPRESS").length,
    SPECIAL: cards.filter((c) => c.is_special).length,
  };
}

function patchDispatchOrdersCache(
  qc: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  updater: (orders: DispatchOrder[]) => DispatchOrder[],
) {
  qc.setQueryData<DispatchOrdersCache>(queryKey, (current) => {
    if (!current) return current;
    const orders = updater(current.orders);
    return { orders, counts: recountDispatchCards(orders) };
  });
}

function applyOptimisticDispatchItem(
  orders: DispatchOrder[],
  orderId: string,
  itemId: string,
  qty: number,
): DispatchOrder[] {
  return orders
    .map((order) => {
      if (order.id !== orderId) return order;

      const items = order.items.map((item) => {
        if (item.id !== itemId) return item;
        const dispatchQty = Math.min(Math.max(0, qty), item.quantity_dispatchable);
        if (dispatchQty <= 0) return item;

        const fromReady = Math.min(dispatchQty, item.quantity_ready_available);
        const fromPending = Math.max(0, dispatchQty - fromReady);
        const pendingPrepare = Math.max(0, item.quantity_pending_prepare - fromPending);
        const readyAvailable = Math.max(0, item.quantity_ready_available - fromReady);
        const dispatchable = Math.max(0, item.quantity_dispatchable - dispatchQty);

        return {
          ...item,
          quantity_pending_prepare: pendingPrepare,
          quantity_ready_available: readyAvailable,
          quantity_dispatchable: dispatchable,
          quantity_dispatched: item.quantity_dispatched + dispatchQty,
        };
      });

      const pending_prepare_count = items.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
      const ready_available_count = items.reduce((sum, item) => sum + item.quantity_ready_available, 0);
      const dispatchable_count = items.reduce((sum, item) => sum + item.quantity_dispatchable, 0);

      return {
        ...order,
        items,
        pending_prepare_count,
        ready_available_count,
        dispatchable_count,
      };
    })
    .filter((card) => dispatchCardHasWork(card));
}

function applyOptimisticDispatchAll(orders: DispatchOrder[], orderId: string): DispatchOrder[] {
  return orders
    .map((order) => {
      if (order.id !== orderId) return order;

      const items = order.items.map((item) => {
        const dispatchQty = item.quantity_dispatchable;
        if (dispatchQty <= 0) return item;

        return {
          ...item,
          quantity_pending_prepare: 0,
          quantity_ready_available: 0,
          quantity_dispatchable: 0,
          quantity_dispatched: item.quantity_dispatched + dispatchQty,
        };
      });

      return {
        ...order,
        items,
        pending_prepare_count: 0,
        ready_available_count: 0,
        dispatchable_count: 0,
        status: "KITCHEN_DISPATCHED" as OrderStatus,
      };
    })
    .filter((card) => dispatchCardHasWork(card));
}

function invalidateOperationalQueries(
  qc: ReturnType<typeof useQueryClient>,
  branchId?: string | null,
) {
  invalidateOperationalOrderQueries(qc, {
    branchId,
    includeTables: true,
    includeCompletedPayments: true,
  });
}

function reconcileDispatchOrdersInBackground(qc: ReturnType<typeof useQueryClient>, queryKey: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey, exact: true });
}

function sortByBatchArrival<T extends { sent_to_kitchen_at: string | null; updated_at: string; order_type?: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftIsPriority = left.order_type === "EXPRESS" || left.order_type === "EXTRA";
    const rightIsPriority = right.order_type === "EXPRESS" || right.order_type === "EXTRA";

    if (leftIsPriority && !rightIsPriority) return -1;
    if (!leftIsPriority && rightIsPriority) return 1;

    const leftTime = new Date(left.sent_to_kitchen_at ?? left.updated_at).getTime();
    const rightTime = new Date(right.sent_to_kitchen_at ?? right.updated_at).getTime();
    return leftTime - rightTime;
  });
}

function matchesScope(orderType: string, scope: DispatchView) {
  if (scope === "ALL") return orderType === "DINE_IN" || orderType === "TABLE" || orderType === "TAKEOUT" || orderType === "EXPRESS" || orderType === "EXTRA";
  if (scope === "SPECIAL") return false;
  if (scope === "TABLE") return orderType === "DINE_IN" || orderType === "TABLE" || orderType === "EXTRA";
  if (scope === "TAKEOUT") return orderType === "TAKEOUT" || orderType === "EXPRESS";
  return false;
}

/** Igual criterio que caja / useOrder: pago que no debe contar para “hay cobro activo”. */
function paymentRowIsInactive(notes: string | null | undefined, status: string | null | undefined): boolean {
  const raw = String(notes ?? "");
  if (raw.includes("VOIDED:") || raw.includes("REVERSED:") || raw.includes("TRANSFER_PROOF_PENDING:1")) return true;
  const st = String(status ?? "").toLowerCase();
  return st === "voided" || st === "reversed";
}

function dispatchCardHasWork(card: DispatchOrder): boolean {
  if (card.items.length === 0) return false;
  return card.items.some((it) => it.quantity_dispatchable > 0);
}

/** Misma regla que `useOrder` / caja: `payment_items` activos, `paid_at` de línea, o cobro total de orden PAID. */
function resolveDispatchLinePaidQty(
  item: { id: string; quantity?: number | null; paid_at?: string | null },
  clientPaidQtyByItemId: Record<string, number>,
  order?: { paid_at?: string | null; status?: string | null },
): number {
  const orderedQty = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
  const fromPayments = Math.max(0, clientPaidQtyByItemId[item.id] ?? 0);
  if (fromPayments > 0) return Math.min(orderedQty, fromPayments);
  if (item.paid_at) return orderedQty;
  if (order?.paid_at && String(order.status ?? "").toUpperCase() === "PAID") {
    return orderedQty;
  }
  return 0;
}

function groupItemsIntoDispatchCards(
  order: any,
  items: any[],
  modifiersMap: Record<string, any[]>,
  operationalMaps: any,
  clientPaidQtyByItemId: Record<string, number>,
  platosProductIds?: Set<string>,
  filterOutPlatos?: boolean,
  workflowMode?: string,
): DispatchOrder[] {
  const {
    readyMap,
    readyAvailableMap,
    pendingPrepareMap,
    dispatchedTotalMap,
    cancelledPendingMap,
    cancelledReadyMap,
    cancelledDispatchedMap,
  } = operationalMaps;

  const isExpressOrder = order.order_type === "EXPRESS";
  const isExtraOrder = order.order_type === "EXTRA";
  const isDispatchFirst = isExpressOrder || (workflowMode === "DISPATCH_THEN_CASH" && order.order_type !== "TAKEOUT");

  const mappedItems: DispatchOrderItem[] = items
    .filter((item) => {
      if (item.order_id !== order.id) return false;
      if (platosProductIds) {
        const isPlato = isPlatosOrderItem(item.product_id, platosProductIds);
        if (filterOutPlatos && isPlato) return false;
        if (!filterOutPlatos && !isPlato) return false;
      }
      const st = String(item.status ?? "").toUpperCase();
      if (st === "DRAFT" || st === "CANCELLED") return false;
      const sent = isExtraOrder || !!(item.sent_to_kitchen_at ?? order.sent_to_kitchen_at);
      if (!sent) return false;

      const quantityOrdered = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
      const operational = computeOperationalQuantities({
        quantityOrdered,
        quantityReadyTotal: readyMap[item.id] ?? 0,
        quantityDispatchedTotal: dispatchedTotalMap[item.id] ?? 0,
        quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
        quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
        quantityCancelledDispatched: cancelledDispatchedMap[item.id] ?? 0,
      });
      const activeQty = Math.max(0, quantityOrdered - operational.quantityCancelledTotal);
      const remainingWork =
        operational.quantityPendingPrepare
        + operational.quantityReadyAvailable
        + operational.quantityDispatchedAvailable;

      if (isDispatchFirst) {
        return activeQty > 0 && remainingWork > 0;
      }

      return resolveDispatchLinePaidQty(item, clientPaidQtyByItemId, order) > 0;
    })
    .map((item) => {
      const quantityOrdered = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
      const quantities = computeOperationalQuantities({
        quantityOrdered,
        quantityReadyTotal: readyMap[item.id] ?? 0,
        quantityDispatchedTotal: dispatchedTotalMap[item.id] ?? 0,
        quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
        quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
        quantityCancelledDispatched: cancelledDispatchedMap[item.id] ?? 0,
      });
      const quantityPaid = isDispatchFirst
        ? Math.max(0, quantityOrdered - quantities.quantityCancelledTotal)
        : resolveDispatchLinePaidQty(item, clientPaidQtyByItemId, order);

      const quantityDispatched = Math.min(quantities.quantityDispatchedAvailable, quantityPaid);
      const paidNotYetDispatched = Math.max(0, quantityPaid - quantityDispatched);
      const quantityPendingPrepare = Math.min(
        pendingPrepareMap[item.id] ?? quantities.quantityPendingPrepare,
        paidNotYetDispatched,
      );
      const quantityReadyAvailable = Math.min(
        readyAvailableMap[item.id] ?? quantities.quantityReadyAvailable,
        Math.max(0, paidNotYetDispatched - quantityPendingPrepare),
      );
      const quantityDispatchable = quantityPendingPrepare + quantityReadyAvailable;
      const linePaidAt = item.paid_at ?? null;
      const sentStamp = item.sent_to_kitchen_at ?? order.sent_to_kitchen_at ?? order.updated_at ?? null;
      const trayContainerCost = Number(item.tray_container_cost ?? 0);

      return {
        id: item.id,
        description_snapshot: item.description_snapshot,
        created_at: item.created_at ?? null,
        quantity_ordered: quantityPaid,
        quantity_paid: quantityPaid,
        paid_at: linePaidAt,
        quantity_pending_prepare: quantityPendingPrepare,
        quantity_ready_available: quantityReadyAvailable,
        quantity_dispatchable: quantityDispatchable,
        quantity_dispatched: quantityDispatched,
        quantity_cancelled: Math.min(quantities.quantityCancelledTotal, quantityPaid),
        unit_price: Number(item.unit_price ?? 0),
        tray_item_type: item.tray_item_type ?? null,
        tray_container_cost: trayContainerCost,
        status: item.status ?? "SENT",
        total:
          computeLineAmount(quantityPaid, Number(item.unit_price ?? 0))
          + (quantityPaid > 0 ? trayContainerCost : 0),
        cantidad_especial: Math.min(Math.max(0, Number(item.cantidad_especial ?? 0)), quantityPaid),
        modifiers: modifiersMap[item.id] ?? [],
        item_note: item.item_note ?? null,
        sent_to_kitchen_at: sentStamp,
      };
    });

  if (mappedItems.length === 0) return [];

  const sentCandidates = mappedItems
    .map((item) => item.sent_to_kitchen_at)
    .filter(Boolean) as string[];
  const sentAt =
    sentCandidates.length > 0
      ? [...sentCandidates].sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0]!
      : (order.sent_to_kitchen_at ?? order.updated_at);

  const sortedItems = consolidateDispatchOrderItems([...mappedItems].sort((left, right) => {
    const leftTime = new Date(left.created_at ?? left.sent_to_kitchen_at ?? sentAt).getTime();
    const rightTime = new Date(right.created_at ?? right.sent_to_kitchen_at ?? sentAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id, "es");
  }));

  const pendingPrepareCount = sortedItems.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
  const readyAvailableCount = sortedItems.reduce((sum, item) => sum + item.quantity_ready_available, 0);
  const dispatchableCount = sortedItems.reduce((sum, item) => sum + item.quantity_dispatchable, 0);

  return [{
    card_id: order.id,
    id: order.id,
    order_number: order.order_number,
    order_code: order.order_code,
    order_type: order.order_type as DispatchOrder["order_type"],
    is_special: Boolean(order.is_special),
    is_tray_order: Boolean(order.is_tray_order),
    is_packer_order: Boolean(order.is_packer_order),
    special_total_manual: order.special_total_manual == null ? null : Number(order.special_total_manual),
    special_group_total: (order as { special_group_total?: number | null }).special_group_total == null
      ? null
      : Number((order as { special_group_total?: number | null }).special_group_total),
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

function buildPartialDispatchItems(order: DispatchOrder) {
  return order.items.flatMap((item) => {
    if (item.quantity_dispatchable <= 0) return [];
    return buildDispatchAllocations(item, item.quantity_dispatchable);
  });
}

function filterDispatchCardsByScope(cards: DispatchOrder[], scope: DispatchView): DispatchOrder[] {
  if (scope === "ALL") return cards;
  if (scope === "SPECIAL") return cards.filter((card) => Boolean(card.is_special));
  if (scope === "TABLE") {
    return cards.filter((card) => !card.is_special && matchesScope(card.order_type, "TABLE"));
  }
  if (scope === "TAKEOUT") {
    return cards.filter((card) => matchesScope(card.order_type, "TAKEOUT"));
  }
  return cards;
}

export function useDispatchOrders(scope: DispatchView, options: UseDispatchOrdersOptions = {}) {
  const moduleMode: DispatchOrdersModule = options.module ?? "dispatch";
  const isServirModule = moduleMode === "servir";
  const qc = useQueryClient();
  const { activeBranchId, activeBranch } = useBranch();
  const { user } = useAuth();
  const { data: shiftGate } = useBranchShiftGate();
  const workflowMode = activeBranch?.workflow_mode ?? "CASH_THEN_DISPATCH";

  const adaptiveListPoll = useAdaptiveRefetchInterval(
    activeBranchId,
    OPERATIONAL_LIST_BACKUP_POLL_MS,
    Boolean(activeBranchId && user),
  );

  // Sin scope en la key: una sola cola por módulo; el tab filtra en cliente (instantáneo).
  const dispatchOrdersQueryKey = [
    isServirModule ? "servir-orders" : "dispatch-orders",
    activeBranchId,
    user?.id,
    shiftGate?.shiftId ?? "_",
  ] as const;

  const query = useQuery({
    queryKey: dispatchOrdersQueryKey,
    queryFn: async () => {
      if (!activeBranchId || !user) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      // Repair en background (throttle interno); no bloquear el listado.
      void repairOpenShiftOrderCashShiftIds(activeBranchId);

      // Bootstrap + platos en paralelo con la cola (no esperar en cadena).
      const bootstrapPromise = ensureDispatchBootstrap(qc, activeBranchId);
      const platosWarmPromise = ensurePlatosProductIdsForBranch(qc, activeBranchId);

      // Preferir shiftId del gate (1 RTT menos) cuando ya está resuelto.
      let openShift = shiftGate?.shiftId
        ? { id: shiftGate.shiftId, opened_at: "" }
        : null;
      if (!openShift) {
        openShift = await getOpenCashShiftForBranch(activeBranchId, { strict: true });
      }
      if (!openShift) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      let ordersMerged: any[] = [];
      let items: any[] = [];
      let modifiersMap: Record<string, { description: string }[]> = {};
      let operationalMaps = {
        readyMap: {} as Record<string, number>,
        readyAvailableMap: {} as Record<string, number>,
        dispatchedTotalMap: {} as Record<string, number>,
        dispatchedAvailableMap: {} as Record<string, number>,
        paidMap: {} as Record<string, number>,
        cancelledPendingMap: {} as Record<string, number>,
        cancelledReadyMap: {} as Record<string, number>,
        cancelledDispatchedMap: {} as Record<string, number>,
        cancelledTotalMap: {} as Record<string, number>,
      };
      let clientPaidQtyByItemId: Record<string, number> = {};
      let creatorNameMap: Record<string, string> = {};
      let packerUserIds = new Set<string>();
      let tablesMap: Record<string, string> = {};
      let splitsMap: Record<string, string> = {};
      let hasPlateServersFromBundle: boolean | null = null;
      let usedQueueBundle = false;

      try {
        const [bootstrap, bundle] = await Promise.all([
          bootstrapPromise,
          fetchDispatchServirQueueBundleFresh(qc, activeBranchId, openShift.id),
        ]);
        usedQueueBundle = true;
        const config = bootstrap.config;
        const assignments = bootstrap.assignments;
        ordersMerged = (bundle.orders ?? []).filter((o) => orderBelongsToOpenCashShift(o, openShift!));

        const flagsByOrder = new Map(
          (bundle.order_payment_flags ?? []).map((f) => [f.order_id, f]),
        );
        const ordersWithActivePayment = new Set<string>();
        const ordersWithAnyPayment = new Set<string>();
        const ordersWithPaidLine = new Set<string>();
        for (const [orderId, flags] of flagsByOrder) {
          if (flags.has_any_payment) ordersWithAnyPayment.add(orderId);
          if (flags.has_active_payment) ordersWithActivePayment.add(orderId);
          if (flags.has_paid_line) ordersWithPaidLine.add(orderId);
        }

        const activeOrders = ordersMerged.filter((o) => {
          if (String(o.notes ?? "").includes("VOID_SUCCESSOR_ORDER:")) return false;
          const isExpress = o.order_type === "EXPRESS";
          const isDispatchFirst = isExpress || (workflowMode === "DISPATCH_THEN_CASH" && o.order_type !== "TAKEOUT");
          if (isDispatchFirst) {
            return o.status === "SENT_TO_KITCHEN" || o.status === "READY" || o.status === "PAID";
          }
          const hasAnyPay = ordersWithAnyPayment.has(o.id);
          const hasActivePay = ordersWithActivePayment.has(o.id);
          const hasPaidLine = ordersWithPaidLine.has(o.id);
          if (o.status === "PAID") {
            return !!o.paid_at || !hasAnyPay || hasActivePay;
          }
          if (o.status === "READY" || o.status === "SENT_TO_KITCHEN") {
            return hasActivePay || !!o.paid_at || hasPaidLine;
          }
          return false;
        });

        if (activeOrders.length === 0) {
          return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };
        }

        creatorNameMap = buildUserDisplayMap(bundle.profiles);
        packerUserIds = new Set(bundle.packer_user_ids ?? []);
        tablesMap = Object.fromEntries((bundle.tables ?? []).map((t) => [t.id, t.name]));
        splitsMap = Object.fromEntries((bundle.splits ?? []).map((s) => [s.id, s.split_code]));
        hasPlateServersFromBundle = Boolean(bundle.has_plate_servers);

        const dispatchMode = config?.dispatch_mode || "SINGLE";
        const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
        const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));

        const getPermittedForView = (v: DispatchView, source: any[]) => {
          let baseFiltered = source.filter((order) => {
            if (v === "SPECIAL") return Boolean(order.is_special);
            if (v === "TABLE") return matchesScope(order.order_type, v) && !order.is_special;
            return matchesScope(order.order_type, v);
          });

          if (dispatchMode === "SPLIT") {
            if (userAssignments.length > 0 && !assignedTypes.has("ALL")) {
              baseFiltered = baseFiltered.filter((order) => {
                const orderType = order.order_type === "EXPRESS"
                  ? "EXPRESS"
                  : order.order_type === "DINE_IN" || order.order_type === "TABLE" || order.order_type === "EXTRA"
                    ? "TABLE"
                    : "TAKEOUT";
                return assignedTypes.has(orderType);
              });
            }
          }
          return baseFiltered;
        };

        const allPermittedOrders = getPermittedForView("ALL", activeOrders);
        if (allPermittedOrders.length === 0) {
          return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };
        }

        const permittedIds = new Set(allPermittedOrders.map((o) => o.id));
        items = (bundle.items ?? []).filter((item) => permittedIds.has(item.order_id));
        operationalMaps = operationalMapsFromBundleItems(items);
        clientPaidQtyByItemId = paidQtyMapFromBundleItems(items);

        for (const row of bundle.modifiers ?? []) {
          if (!items.some((it) => it.id === row.order_item_id)) continue;
          if (!modifiersMap[row.order_item_id]) modifiersMap[row.order_item_id] = [];
          const description = String(row.description ?? "").trim();
          if (!description) continue;
          modifiersMap[row.order_item_id].push({ description });
        }

        let platosProductIds: Set<string> | undefined;
        let filterOutPlatos = false;
        if (isServirModule) {
          platosProductIds = await platosWarmPromise;
        } else if (moduleMode === "dispatch" && hasPlateServersFromBundle) {
          platosProductIds = await platosWarmPromise;
          filterOutPlatos = true;
        }

        const allCards = allPermittedOrders.flatMap((order) => {
          const orderWithContext = {
            ...order,
            created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? "Usuario") : null,
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
            is_packer_order: order.created_by ? packerUserIds.has(order.created_by) : false,
          };
          return groupItemsIntoDispatchCards(
            orderWithContext,
            items,
            modifiersMap,
            operationalMaps,
            clientPaidQtyByItemId,
            platosProductIds,
            filterOutPlatos,
            workflowMode,
          );
        }).filter((card) => dispatchCardHasWork(card));

        const counts = {
          ALL: allCards.length,
          TABLE: allCards.filter(c => !c.is_special && (c.order_type === "DINE_IN" || c.order_type === "TABLE" || c.order_type === "EXTRA")).length,
          TAKEOUT: allCards.filter(c => c.order_type === "TAKEOUT" || c.order_type === "EXPRESS").length,
          SPECIAL: allCards.filter(c => c.is_special).length,
        };

        const filteredCards = sortByBatchArrival(allCards) as DispatchOrder[];
        return { orders: filteredCards, counts };
      } catch (bundleError) {
        if (usedQueueBundle) {
          // Bundle parse/build falló tras RPC OK: no mezclar con legacy a medias.
          console.warn("[useDispatchOrders] bundle queue falló; usando camino legacy", bundleError);
        } else {
          console.warn("[useDispatchOrders] RPC cola no disponible; camino legacy", bundleError);
        }
      }

      // --- Legacy multi-query (fallback si la RPC aún no está migrada) ---
      const bootstrap = await bootstrapPromise;
      const config = bootstrap.config;
      const assignments = bootstrap.assignments;

      ordersMerged = (
        await dbSelectStrict<any>("orders", {
          select: "id, order_number, order_code, order_type, is_special, is_tray_order, special_total_manual, special_group_total, created_by, table_id, split_id, status, created_at, updated_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, locked_for_editing, notes, cash_shift_id",
          branchId: activeBranchId,
          filters: [
            { column: "status", op: "in", value: ["PAID", "READY", "SENT_TO_KITCHEN"] },
            { column: "cash_shift_id", op: "eq", value: openShift.id },
          ],
          orderBy: { column: "updated_at", ascending: true },
        })
      ).filter((o) => orderBelongsToOpenCashShift(o, openShift!));

      if (ordersMerged.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const allOrderIds = ordersMerged.map((o) => o.id);
      const [paymentsForOrders, paidLineRows] = await Promise.all([
        dbSelectStrict<any>("payments", {
          select: "order_id, notes, status",
          filters: [{ column: "order_id", op: "in", value: allOrderIds }],
        }),
        dbSelectStrict<any>("order_items", {
          select: "order_id, paid_at",
          filters: [{ column: "order_id", op: "in", value: allOrderIds }],
        }),
      ]);
      const ordersWithActivePayment = new Set<string>();
      const ordersWithAnyPayment = new Set<string>();
      for (const p of paymentsForOrders ?? []) {
        ordersWithAnyPayment.add(p.order_id);
        if (!paymentRowIsInactive(p.notes, p.status)) ordersWithActivePayment.add(p.order_id);
      }

      const ordersWithPaidLine = new Set(
        (paidLineRows ?? [])
          .filter((row: any) => row.paid_at != null && String(row.paid_at).trim() !== "")
          .map((row: any) => row.order_id),
      );

      const activeOrders = ordersMerged.filter((o) => {
        if (String(o.notes ?? "").includes("VOID_SUCCESSOR_ORDER:")) return false;
        
        const isExpress = o.order_type === "EXPRESS";
        const isDispatchFirst = isExpress || (workflowMode === "DISPATCH_THEN_CASH" && o.order_type !== "TAKEOUT");

        if (isDispatchFirst) {
          return o.status === "SENT_TO_KITCHEN" || o.status === "READY" || o.status === "PAID";
        }
        const hasAnyPay = ordersWithAnyPayment.has(o.id);
        const hasActivePay = ordersWithActivePayment.has(o.id);
        const hasPaidLine = ordersWithPaidLine.has(o.id);
        if (o.status === "PAID") {
          return !!o.paid_at || !hasAnyPay || hasActivePay;
        }
        if (o.status === "READY" || o.status === "SENT_TO_KITCHEN") {
          return hasActivePay || !!o.paid_at || hasPaidLine;
        }
        return false;
      });
      if (activeOrders.length === 0) return { orders: [], counts: { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 } };

      const creatorIds = Array.from(new Set(activeOrders.map((order) => order.created_by).filter(Boolean))) as string[];
      const [creatorProfiles, packerUsers] = await Promise.all([
        creatorIds.length > 0
          ? dbSelectStrict<any>("profiles", {
              select: "id, first_name, full_name, username, alias, email",
              filters: [{ column: "id", op: "in", value: creatorIds }],
            })
          : Promise.resolve([] as any[]),
        creatorIds.length > 0
          ? dbSelectStrict<any>("cash_shift_users", {
              select: "user_id",
              filters: [
                { column: "shift_id", op: "eq", value: openShift.id },
                { column: "user_id", op: "in", value: creatorIds },
                { column: "can_pack_orders", op: "eq", value: true },
              ],
            })
          : Promise.resolve([] as any[]),
      ]);
      creatorNameMap = buildUserDisplayMap(creatorProfiles);
      packerUserIds = new Set((packerUsers ?? []).map((u: any) => u.user_id));

      const dispatchMode = config?.dispatch_mode || "SINGLE";
      const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
      const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));

      const getPermittedForView = (v: DispatchView, source: any[]) => {
        let baseFiltered = source.filter((order) => {
          if (v === "SPECIAL") return Boolean(order.is_special);
          if (v === "TABLE") return matchesScope(order.order_type, v) && !order.is_special;
          return matchesScope(order.order_type, v);
        });

        if (dispatchMode === "SPLIT") {
          if (userAssignments.length > 0 && !assignedTypes.has("ALL")) {
            baseFiltered = baseFiltered.filter((order) => {
              const orderType = order.order_type === "EXPRESS"
                ? "EXPRESS"
                : order.order_type === "DINE_IN" || order.order_type === "TABLE" || order.order_type === "EXTRA"
                  ? "TABLE"
                  : "TAKEOUT";
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

      const [tables, splits, legacyItems] = await Promise.all([
        tableIds.length > 0
          ? dbSelectStrict("restaurant_tables", {
              select: "id, name",
              filters: [{ column: "id", op: "in", value: tableIds }],
            })
          : Promise.resolve([]),
        splitIds.length > 0
          ? dbSelectStrict("table_splits", {
              select: "id, split_code",
              filters: [{ column: "id", op: "in", value: splitIds }],
            })
          : Promise.resolve([]),
        dbSelectStrict("order_items", {
          select:
            "id, order_id, product_id, description_snapshot, quantity, unit_price, total, status, tray_item_type, tray_container_cost, item_note, sent_to_kitchen_at, paid_at, created_at, cantidad_especial",
          filters: [{ column: "order_id", op: "in", value: orderIdsToFetch }],
        }),
      ]);

      tablesMap = Object.fromEntries((tables ?? []).map((t: any) => [t.id, t.name]));
      splitsMap = Object.fromEntries((splits ?? []).map((s: any) => [s.id, s.split_code]));
      items = legacyItems ?? [];

      const itemIds = (items ?? []).map((item: any) => item.id);
      modifiersMap = {};

      const platosPromise: Promise<{ platosProductIds?: Set<string>; filterOutPlatos: boolean }> =
        isServirModule
          ? platosWarmPromise.then((ids) => ({
              platosProductIds: ids,
              filterOutPlatos: false,
            }))
          : moduleMode === "dispatch"
            ? dbSelectStrict<any>("cash_shift_users", {
                select: "user_id",
                filters: [
                  { column: "shift_id", op: "eq", value: openShift.id },
                  { column: "is_enabled", op: "eq", value: true },
                  { column: "can_serve_plates", op: "eq", value: true },
                ],
              }).then(async (serverUsers) => {
                if ((serverUsers ?? []).length === 0) {
                  return { filterOutPlatos: false };
                }
                return {
                  platosProductIds: await platosWarmPromise,
                  filterOutPlatos: true,
                };
              })
            : Promise.resolve({ filterOutPlatos: false });

      const [modifierRows, maps, paidMap, platosResult] = await Promise.all([
        itemIds.length > 0
          ? dbSelectStrict<any>("order_item_modifiers", {
              select: "id, order_item_id, modifiers(description)",
              filters: [{ column: "order_item_id", op: "in", value: itemIds }],
            })
          : Promise.resolve([] as any[]),
        fetchOperationalMapsForOrders(orderIdsToFetch),
        fetchActivePaidQuantityByOrderItemId(itemIds, { strict: true }),
        platosPromise,
      ]);

      for (const row of modifierRows ?? []) {
        if (!modifiersMap[row.order_item_id]) modifiersMap[row.order_item_id] = [];
        const rawDescription = Array.isArray(row.modifiers)
          ? row.modifiers[0]?.description
          : row.modifiers?.description;
        const description = String(rawDescription ?? "").trim();
        if (!description) continue;
        modifiersMap[row.order_item_id].push({ description });
      }

      operationalMaps = maps;
      clientPaidQtyByItemId = paidMap;
      const { platosProductIds, filterOutPlatos } = platosResult;

      const allCards = allPermittedOrders.flatMap((order) => {
        const orderWithContext = {
          ...order,
          created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? "Usuario") : null,
          table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
          split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
          is_packer_order: order.created_by ? packerUserIds.has(order.created_by) : false,
        };
        return groupItemsIntoDispatchCards(
          orderWithContext,
          items,
          modifiersMap,
          operationalMaps,
          clientPaidQtyByItemId,
          platosProductIds,
          filterOutPlatos,
          workflowMode,
        );
      }).filter((card) => dispatchCardHasWork(card));

      const counts = {
        ALL: allCards.length,
        TABLE: allCards.filter(c => !c.is_special && (c.order_type === "DINE_IN" || c.order_type === "TABLE" || c.order_type === "EXTRA")).length,
        TAKEOUT: allCards.filter(c => c.order_type === "TAKEOUT" || c.order_type === "EXPRESS").length,
        SPECIAL: allCards.filter(c => c.is_special).length,
      };

      const filteredCards = sortByBatchArrival(allCards) as DispatchOrder[];

      return {
        orders: filteredCards,
        counts
      };
    },
    enabled: !!activeBranchId && !!user,
    staleTime: OPERATIONAL_STALE_MS,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    // Realtime SUBSCRIBED → sin safety poll; si el hub cae → respaldo 30s.
    refetchInterval: adaptiveListPoll,
  });

  useOperationalOrdersRealtime({
    branchId: activeBranchId,
    queryClient: qc,
    channelPrefix: isServirModule ? "servir-orders-rt" : "dispatch-orders-rt",
    enabled: Boolean(activeBranchId && user),
    queryKeys: [
      // Ambos módulos + bundle: un solo evento debe refrescar la fuente compartida.
      qk.dispatchOrders,
      qk.servirOrders,
      qk.dispatchServirQueueBundle,
    ],
    includePayments: true,
    // El gate tiene su propio consumer; no re-suscribir cash_shifts aquí.
    includeShiftGate: false,
    shiftId: shiftGate?.shiftId ?? null,
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
      invalidateOperationalQueries(qc, activeBranchId);
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
      invalidateOperationalQueries(qc, activeBranchId);
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
      invalidateOperationalQueries(qc, activeBranchId);
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
      invalidateOperationalQueries(qc, activeBranchId);
      toast.success("Alerta de listo enviada");
    },
    onError: (error: any) => {
      toast.error(`Error al emitir alerta: ${error?.message || "Error desconocido"}`);
    },
  });

  const dispatchItem = useMutation({
    mutationFn: async ({ orderId, item, qty }: { orderId: string; item: DispatchOrderItem; qty: number }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");
      const allocations = buildDispatchAllocations(item, qty);
      if (allocations.length === 0) {
        throw new Error("No hay cantidades pendientes de despacho para este item");
      }

      const { error } = await supabase.rpc("dispatch_order_quantities" as any, {
        p_order_id: orderId,
        p_dispatched_by: user.id,
        p_items: allocations as any,
        p_operation_type: "partial",
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onMutate: async ({ orderId, item, qty }) => {
      await qc.cancelQueries({ queryKey: dispatchOrdersQueryKey });
      const previous = qc.getQueryData<DispatchOrdersCache>(dispatchOrdersQueryKey);
      patchDispatchOrdersCache(qc, dispatchOrdersQueryKey, (orders) =>
        applyOptimisticDispatchItem(orders, orderId, item.id, qty),
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success("Item despachado");
      reconcileDispatchOrdersInBackground(qc, dispatchOrdersQueryKey);
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(dispatchOrdersQueryKey, context.previous);
      }
      toast.error(`Error al despachar item: ${error?.message || "Error desconocido"}`);
    },
  });

  const dispatchOrder = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      if (!user?.id) throw new Error("Usuario no autenticado");

      const currentOrder = query.data?.orders.find((order) => order.id === orderId);
      if (!currentOrder) throw new Error("No se encontro la orden para despachar");
      if (currentOrder.dispatchable_count <= 0) {
        throw new Error("La orden no tiene cantidades pendientes de despacho");
      }

      const partialItems = buildPartialDispatchItems(currentOrder);

      const { error } = await supabase.rpc("dispatch_order_quantities" as any, {
        p_order_id: orderId,
        p_dispatched_by: user.id,
        p_items: partialItems as any,
        p_operation_type: "partial",
        p_source_module: "dispatch",
        p_notes: null,
      });
      if (error) throw error;
    },
    onMutate: async ({ orderId }) => {
      await qc.cancelQueries({ queryKey: dispatchOrdersQueryKey });
      const previous = qc.getQueryData<DispatchOrdersCache>(dispatchOrdersQueryKey);
      patchDispatchOrdersCache(qc, dispatchOrdersQueryKey, (orders) => applyOptimisticDispatchAll(orders, orderId));
      return { previous };
    },
    onSuccess: () => {
      toast.success("Orden despachada");
      // Caja/pagos se actualizan vía hub Realtime (payments + orders).
      reconcileDispatchOrdersInBackground(qc, dispatchOrdersQueryKey);
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(dispatchOrdersQueryKey, context.previous);
      }
      toast.error(`Error al despachar orden: ${error?.message || "Error desconocido"}`);
    },
  });

  const allOrders = query.data?.orders || [];
  const counts = query.data?.counts || { ALL: 0, TABLE: 0, TAKEOUT: 0, SPECIAL: 0 };
  const orders = useMemo(
    () => filterDispatchCardsByScope(allOrders, scope),
    [allOrders, scope],
  );

  return {
    orders,
    counts,
    // Solo spinner si aún no hay datos de esta cola (no ocultar cache fresco al reentrar).
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
