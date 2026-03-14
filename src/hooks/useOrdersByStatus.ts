import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";
import { computeLineAmount } from "@/lib/paymentQuantity";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";

type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

export interface OrderItemSummary {
  id: string;
  description_snapshot: string;
  quantity: number;
  total: number;
  status: string;
  modifiers: { description: string }[];
  item_note?: string | null;
}

export interface OrderSummary {
  id: string;
  order_number: number;
  order_code: string | null;
  split_code?: string | null;
  status: OrderStatus;
  order_type: string;
  table_id: string | null;
  table_name: string | null;
  created_at: string;
  sent_to_kitchen_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  total: number;
  item_count: number;
  items: OrderItemSummary[];
}

export function useOrdersByStatus(status: OrderStatus | null = null) {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["orders", activeBranchId, status],
    queryFn: async (): Promise<OrderSummary[]> => {
      if (!activeBranchId) return [];

      const cancelledView = status === "CANCELLED";
      const sentView = status === "SENT_TO_KITCHEN";
      const readyView = status === "READY";
      const dispatchedView = status === "KITCHEN_DISPATCHED";
      const paidView = status === "PAID";

      const filters = (() => {
        if (!status || cancelledView) return [];
        if (readyView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }];
        if (dispatchedView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"] }];
        if (sentView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }];
        return [{ column: "status", op: "eq", value: status }];
      })();

      let orders = await dbSelect<{
        id: string;
        order_number: number;
        order_code: string | null;
        status: OrderStatus;
        order_type: string;
        table_id: string | null;
        created_at: string;
        sent_to_kitchen_at: string | null;
        ready_at: string | null;
        dispatched_at: string | null;
        paid_at: string | null;
        cancelled_at: string | null;
        total: number;
      }>("orders", {
        select: "id, order_number, order_code, status, order_type, table_id, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, total",
        branchId: activeBranchId,
        filters,
        orderBy: { column: "created_at", ascending: false },
      });

      let cancelledOrdersMeta: Record<string, { cancelled_at: string | null }> = {};

      if (cancelledView) {
        const { data: cancellationHeaders, error: cancellationHeadersError } = await supabase
          .from("order_cancellations")
          .select("order_id, status, created_at")
          .eq("status", "APPLIED");

        if (cancellationHeadersError) throw cancellationHeadersError;

        const cancelledOrderIds = new Set<string>();
        for (const header of cancellationHeaders ?? []) {
          const orderId = (header as any).order_id as string | null;
          if (!orderId) continue;
          cancelledOrderIds.add(orderId);
          const createdAt = (header as any).created_at ?? null;
          const current = cancelledOrdersMeta[orderId]?.cancelled_at;
          if (!current || (createdAt && createdAt > current)) {
            cancelledOrdersMeta[orderId] = { cancelled_at: createdAt };
          }
        }

        orders = orders.filter(
          (order) =>
            order.status === "CANCELLED" ||
            cancelledOrderIds.has(order.id) ||
            (order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED")
        );
      }

      const orderIds = orders.map((order) => order.id);
      if (orderIds.length === 0) return [];

      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        item_note?: string | null;
        quantity: number;
        unit_price?: number;
        total: number;
        status: string;
      }>("order_items", {
        select: "id, order_id, description_snapshot, item_note, quantity, unit_price, total, status",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      const { readyMap, dispatchedMap, cancelledPendingMap, cancelledReadyMap, cancelledTotalMap } =
        await fetchOperationalMapsForOrders(orderIds);
      const itemIds = items.map((item) => item.id);

      const modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods, error: modsError } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        if (modsError) throw modsError;

        for (const modifier of mods ?? []) {
          const rawDescription = Array.isArray((modifier as any).modifiers)
            ? (modifier as any).modifiers[0]?.description
            : (modifier as any).modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          if (!modsMap[modifier.order_item_id]) modsMap[modifier.order_item_id] = [];
          modsMap[modifier.order_item_id].push({ description });
        }
      }

      const tableIds = [...new Set(orders.map((order) => order.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        if (tables) {
          tablesMap = Object.fromEntries(tables.map((table: { id: string; name: string }) => [table.id, table.name]));
        }
      }

      return orders
        .map((order) => {
          const related = items
            .filter((item) => item.order_id === order.id)
            .map((item) => {
              const quantities = computeOperationalQuantities({
                quantityOrdered: Number(item.quantity ?? 0),
                quantityReadyTotal: readyMap[item.id] ?? 0,
                quantityDispatched: dispatchedMap[item.id] ?? 0,
                quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
                quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
              });

              const activeQuantity = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
              const cancelledQuantity = Math.min(quantities.quantityOrdered, cancelledTotalMap[item.id] ?? quantities.quantityCancelledTotal);

              const isTakeoutDispatchedOnCancelledTab =
                cancelledView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED";

              const displayQuantity = cancelledView
                ? isTakeoutDispatchedOnCancelledTab
                  ? quantities.quantityDispatched
                  : cancelledQuantity
                : readyView
                  ? quantities.quantityReadyAvailable
                  : dispatchedView
                    ? quantities.quantityDispatched
                    : sentView
                      ? quantities.quantityPendingPrepare
                      : activeQuantity;

              const effectiveStatus = cancelledView
                ? isTakeoutDispatchedOnCancelledTab
                  ? "DISPATCHED"
                  : "CANCELLED"
                : readyView
                  ? "READY"
                  : dispatchedView
                    ? "DISPATCHED"
                    : sentView
                      ? "SENT"
                      : activeQuantity <= 0
                        ? "CANCELLED"
                        : item.status;

              return {
                ...item,
                quantity: displayQuantity,
                total: computeLineAmount(displayQuantity, Number(item.unit_price ?? 0)),
                status: effectiveStatus,
              };
            })
            .filter((item) => item.status !== "DRAFT" && item.quantity > 0);

          const formattedItems: OrderItemSummary[] = related.map((item) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            quantity: item.quantity,
            total: Number(item.total ?? 0),
            status: item.status,
            modifiers: modsMap[item.id] || [],
            item_note: item.item_note ?? null,
          }));

          const total = related.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
          const item_count = related.reduce((count, item) => count + Number(item.quantity ?? 0), 0);

          const isTakeoutDispatchedOnCancelledTab =
            cancelledView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED";

          const effectiveOrderStatus = cancelledView
            ? isTakeoutDispatchedOnCancelledTab
              ? "KITCHEN_DISPATCHED"
              : "CANCELLED"
            : readyView
              ? "READY"
              : dispatchedView
                ? "KITCHEN_DISPATCHED"
                : sentView
                  ? "SENT_TO_KITCHEN"
                  : paidView
                    ? "PAID"
                    : order.status;

          return {
            ...order,
            status: effectiveOrderStatus,
            cancelled_at: cancelledView && !isTakeoutDispatchedOnCancelledTab
              ? (order.cancelled_at ?? cancelledOrdersMeta[order.id]?.cancelled_at ?? null)
              : order.cancelled_at,
            split_code: null,
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            total,
            item_count,
            items: formattedItems,
          };
        })
        .filter((order) => {
          if (order.items.length === 0) return false;
          if (dispatchedView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED") {
            return false;
          }
          return true;
        });
    },
    enabled: !!activeBranchId,
  });
}
