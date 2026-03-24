import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";

// include CANCELLED since we'll add it to the enum via migration
type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

export interface TableWithStatus {
  id: string;
  name: string;
  visual_order: number;
  is_active: boolean;
  status: "free" | "occupied" | "to_pay";
  activeOrderId?: string;
  orderStatus?: OrderStatus;
  splitCount: number;
  totalDue: number;
  splitTotals: Array<{
    splitId: string | null;
    splitCode: string | null;
    totalDue: number;
  }>;
}

function getVisibleMesaQuantity(
  _orderType: "DINE_IN" | "TAKEOUT",
  quantities: ReturnType<typeof computeOperationalQuantities>,
) {
  return Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
}

function resolvePaidQuantity(params: {
  payableQuantity: number;
  orderedQuantity: number;
  paidQuantityFromSnapshot: number;
  paidAt?: string | null;
}) {
  const fallbackPaidQuantity = params.paidQuantityFromSnapshot > 0
    ? params.paidQuantityFromSnapshot
    : params.paidAt
      ? params.orderedQuantity
      : 0;

  return Math.min(params.payableQuantity, fallbackPaidQuantity);
}

export function useTablesWithStatus() {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["tables-with-status", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      // Fetch tables and active orders in parallel via DatabaseService
      const [tables, openShift, orders] = await Promise.all([
        dbSelect<{
          id: string;
          name: string;
          visual_order: number;
          is_active: boolean;
          branch_id: string;
          created_at: string;
          updated_at: string;
        }>("restaurant_tables", {
          branchId: activeBranchId,
          orderBy: { column: "visual_order" },
        }),
        supabase
          .rpc("get_my_branch_shift_gate" as never, {
            p_branch_id: activeBranchId,
          } as never)
          .then(({ data, error }) => {
            if (error) throw error;
            return Array.isArray(data) ? data[0] ?? null : data ?? null;
          }),
        // Orders need a relational sub-select (order_items count), use passthrough
        supabase
          .from("orders")
          .select("id, table_id, status, split_id, order_type, order_items(id)")
          .not("table_id", "is", null)
          .eq("branch_id", activeBranchId)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          }),
      ]);

      const activeTableCount = openShift?.shift_open
        ? Math.max(0, Number(openShift.active_tables_count ?? 0))
        : 0;
      const visibleTables = activeTableCount > 0 ? tables.slice(0, activeTableCount) : [];
      const visibleTableIds = new Set(visibleTables.map((table) => table.id));

      // Group orders by table — only include orders that have items OR are past DRAFT
      const ordersByTable = new Map<string, typeof orders>();
      for (const order of orders) {
        if (!order.table_id) continue;
        if (!visibleTableIds.has(order.table_id)) continue;
        const hasItems = Array.isArray(order.order_items) && order.order_items.length > 0;
        const isPastDraft = order.status !== "DRAFT";
        if (!hasItems && !isPastDraft) continue;
        const arr = ordersByTable.get(order.table_id) ?? [];
        arr.push(order);
        ordersByTable.set(order.table_id, arr);
      }

      // Track draft orders without items so we can navigate to them
      const draftByTable = new Map<string, string>();
      for (const order of orders) {
        if (!order.table_id) continue;
        if (!visibleTableIds.has(order.table_id)) continue;
        const hasItems = Array.isArray(order.order_items) && order.order_items.length > 0;
        if (order.status === "DRAFT" && !hasItems) {
          draftByTable.set(order.table_id, order.id);
        }
      }

      const relevantOrderIds = [...new Set(
        orders
          .filter((order) => {
            if (!order.table_id || !visibleTableIds.has(order.table_id)) return false;
            const hasItems = Array.isArray(order.order_items) && order.order_items.length > 0;
            const isPastDraft = order.status !== "DRAFT";
            return hasItems || isPastDraft;
          })
          .map((order) => order.id),
      )];

      const splitIds = [...new Set(
        orders
          .filter((order) => order.table_id && visibleTableIds.has(order.table_id) && order.split_id)
          .map((order) => order.split_id)
          .filter(Boolean),
      )] as string[];

      const [orderItems, operationalMaps, splitRows] = await Promise.all([
        relevantOrderIds.length > 0
          ? supabase
              .from("order_items")
              .select("id, order_id, quantity, unit_price, paid_at")
              .in("order_id", relevantOrderIds)
              .then(({ data, error }) => {
                if (error) throw error;
                return data ?? [];
              })
          : Promise.resolve([] as Array<{
              id: string;
              order_id: string;
              quantity: number | null;
              unit_price: number | null;
              paid_at: string | null;
            }>),
        fetchOperationalMapsForOrders(relevantOrderIds),
        splitIds.length > 0
          ? supabase
              .from("table_splits")
              .select("id, split_code")
              .in("id", splitIds)
              .then(({ data, error }) => {
                if (error) throw error;
                return data ?? [];
              })
          : Promise.resolve([] as Array<{ id: string; split_code: string }>),
      ]);

      const splitCodeMap = new Map(splitRows.map((split) => [split.id, split.split_code]));
      const itemsByOrder = new Map<string, typeof orderItems>();
      for (const item of orderItems) {
        const bucket = itemsByOrder.get(item.order_id) ?? [];
        bucket.push(item);
        itemsByOrder.set(item.order_id, bucket);
      }

      const pendingTotalByOrder = new Map<string, number>();
      for (const order of orders) {
        const orderItemsForOrder = itemsByOrder.get(order.id) ?? [];
        const orderPendingTotal = roundMoney(
          orderItemsForOrder.reduce((sum, item) => {
            const quantities = computeOperationalQuantities({
              quantityOrdered: Number(item.quantity ?? 0),
              quantityReadyTotal: operationalMaps.readyMap[item.id] ?? 0,
              quantityDispatchedTotal: operationalMaps.dispatchedTotalMap[item.id] ?? 0,
              quantityCancelledPending: operationalMaps.cancelledPendingMap[item.id] ?? 0,
              quantityCancelledReady: operationalMaps.cancelledReadyMap[item.id] ?? 0,
              quantityCancelledDispatched: operationalMaps.cancelledDispatchedMap[item.id] ?? 0,
            });

            const visibleQty = getVisibleMesaQuantity(order.order_type as "DINE_IN" | "TAKEOUT", quantities);
            const paidQty = resolvePaidQuantity({
              payableQuantity: visibleQty,
              orderedQuantity: Number(item.quantity ?? 0),
              paidQuantityFromSnapshot: operationalMaps.paidMap[item.id] ?? 0,
              paidAt: item.paid_at,
            });
            const pendingQty = Math.max(0, visibleQty - paidQty);
            return sum + computeLineAmount(pendingQty, Number(item.unit_price ?? 0));
          }, 0),
        );

        pendingTotalByOrder.set(order.id, orderPendingTotal);
      }

      return visibleTables.map((table): TableWithStatus => {
        const tableOrders = ordersByTable.get(table.id) ?? [];
        if (tableOrders.length === 0) {
          return {
            ...table,
            status: "free",
            splitCount: 0,
            totalDue: 0,
            splitTotals: [],
            activeOrderId: draftByTable.get(table.id),
          };
        }

        const hasDispatched = tableOrders.some((o) => o.status === "KITCHEN_DISPATCHED");
        const splits = new Set(tableOrders.filter((o) => o.split_id).map((o) => o.split_id));
        const splitTotals = tableOrders
          .filter((order) => order.split_id)
          .map((order) => ({
            splitId: order.split_id,
            splitCode: order.split_id ? splitCodeMap.get(order.split_id) ?? null : null,
            totalDue: roundMoney(pendingTotalByOrder.get(order.id) ?? 0),
          }))
          .filter((entry) => entry.totalDue > 0)
          .sort((left, right) => (left.splitCode ?? "").localeCompare(right.splitCode ?? ""));
        const totalDue = roundMoney(
          tableOrders.reduce((sum, order) => sum + (pendingTotalByOrder.get(order.id) ?? 0), 0),
        );

        return {
          ...table,
          status: hasDispatched ? "to_pay" : "occupied",
          activeOrderId: tableOrders[0].id,
          orderStatus: tableOrders[0].status as OrderStatus,
          splitCount: splits.size,
          totalDue,
          splitTotals,
        };
      });
    },
    enabled: !!activeBranchId,
    refetchInterval: 5000,
  });
}
