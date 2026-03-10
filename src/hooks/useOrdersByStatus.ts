import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";
import { computeLineAmount } from "@/lib/paymentQuantity";

type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

export interface OrderItemSummary {
  id: string;
  description_snapshot: string;
  quantity: number;
  total: number;
  status: string;
  modifiers: { description: string }[];
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

async function fetchAppliedCancelledQuantityByOrderItem(orderItemIds: string[]): Promise<Record<string, number>> {
  if (orderItemIds.length === 0) return {};

  try {
    const { data: itemCancellations, error: itemCancellationsError } = await supabase
      .from("order_item_cancellations")
      .select("order_item_id, quantity_cancelled, order_cancellation_id")
      .in("order_item_id", orderItemIds);
    if (itemCancellationsError) throw itemCancellationsError;

    const cancellationIds = [...new Set((itemCancellations ?? []).map((row) => row.order_cancellation_id))];
    if (cancellationIds.length === 0) return {};

    const { data: cancellationHeaders, error: headersError } = await supabase
      .from("order_cancellations")
      .select("id, status")
      .in("id", cancellationIds);
    if (headersError) throw headersError;

    const activeCancellationIds = new Set(
      (cancellationHeaders ?? []).filter((header) => header.status === "APPLIED").map((header) => header.id)
    );

    const map: Record<string, number> = {};
    for (const row of itemCancellations ?? []) {
      if (!activeCancellationIds.has(row.order_cancellation_id)) continue;
      map[row.order_item_id] = (map[row.order_item_id] ?? 0) + Number(row.quantity_cancelled);
    }

    return map;
  } catch {
    return {};
  }
}

export function useOrdersByStatus(status: OrderStatus | null = null) {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["orders", activeBranchId, status],
    queryFn: async (): Promise<OrderSummary[]> => {
      if (!activeBranchId) return [];

      const cancelledView = status === "CANCELLED";

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
        filters: cancelledView || !status ? [] : [{ column: "status", op: "eq", value: status }],
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

        orders = orders.filter((order) => order.status === "CANCELLED" || cancelledOrderIds.has(order.id));
      }

      const orderIds = orders.map((order) => order.id);
      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        quantity: number;
        unit_price?: number;
        total: number;
        status: string;
      }>("order_items", {
        select: "id, order_id, description_snapshot, quantity, unit_price, total, status",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      const itemIds = items.map((item) => item.id);
      const cancelledQtyMap = await fetchAppliedCancelledQuantityByOrderItem(itemIds);

      const mods = await dbSelect<{
        order_item_id: string;
        description: string;
      }>("order_item_modifiers", {
        select: "order_item_id, description",
        filters: [{ column: "order_item_id", op: "in", value: itemIds }],
      });

      const modsMap: Record<string, { description: string }[]> = {};
      mods.forEach((modifier) => {
        if (!modsMap[modifier.order_item_id]) modsMap[modifier.order_item_id] = [];
        modsMap[modifier.order_item_id].push({ description: modifier.description });
      });

      const tableIds = [...new Set(orders.map((order) => order.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        if (tables) {
          tablesMap = Object.fromEntries(tables.map((table: { id: string; name: string }) => [table.id, table.name]));
        }
      }

      return orders.map((order) => {
        const related = items
          .filter((item) => item.order_id === order.id)
          .map((item) => {
            const originalQuantity = Number(item.quantity ?? 0);
            const cancelledQuantity = Math.min(originalQuantity, cancelledQtyMap[item.id] ?? 0);
            const activeQuantity = Math.max(0, originalQuantity - cancelledQuantity);
            const displayQuantity = cancelledView ? cancelledQuantity : activeQuantity;
            const effectiveStatus = cancelledView ? "CANCELLED" : activeQuantity <= 0 ? "CANCELLED" : item.status;

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
        }));

        const total = related.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
        const item_count = related.reduce((count, item) => count + Number(item.quantity ?? 0), 0);

        return {
          ...order,
          status: cancelledView ? "CANCELLED" : order.status,
          cancelled_at: cancelledView ? (order.cancelled_at ?? cancelledOrdersMeta[order.id]?.cancelled_at ?? null) : order.cancelled_at,
          split_code: null,
          table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
          total,
          item_count,
          items: formattedItems,
        };
      });
    },
    enabled: !!activeBranchId,
  });
}
