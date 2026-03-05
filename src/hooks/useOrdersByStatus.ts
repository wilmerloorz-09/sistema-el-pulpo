import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";

// order_status enum in DB currently has DRAFT,SENT_TO_KITCHEN,KITCHEN_DISPATCHED,PAID
// we add CANCELLED on the client-side and via migration to support cancelled orders
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
  status: OrderStatus;
  order_type: string;
  table_id: string | null;
  created_at: string;
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

      const filters = status ? [{ column: "status", op: "eq", value: status }] : [];

      const orders = await dbSelect<{
        id: string;
        order_number: number;
        order_code: string | null;
        status: OrderStatus;
        order_type: string;
        table_id: string | null;
        created_at: string;
      }>("orders", {
        select: "id, order_number, order_code, status, order_type, table_id, created_at",
        branchId: activeBranchId,
        filters,
        orderBy: { column: "created_at", ascending: false },
      });

      // Calculate totals and item counts safely
      // Collect order ids for fetching items
      const orderIds = orders.map((o) => o.id);

      // Fetch items including modifiers
      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        quantity: number;
        total: number;
        status: string;
      }>("order_items", {
        select: "id, order_id, description_snapshot, quantity, total, status",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      // fetch modifiers separately
      const itemIds = items.map((i) => i.id);
      const mods = await dbSelect<{
        order_item_id: string;
        description: string;
      }>("order_item_modifiers", {
        select: "order_item_id, description",
        filters: [{ column: "order_item_id", op: "in", value: itemIds }],
      });

      const modsMap: Record<string, { description: string }[]> = {};
      mods.forEach((m) => {
        if (!modsMap[m.order_item_id]) modsMap[m.order_item_id] = [];
        modsMap[m.order_item_id].push({ description: m.description });
      });

      const ordersWithDetails = orders.map((order) => {
        const related = items.filter((i) => i.order_id === order.id);
        const formattedItems: OrderItemSummary[] = related.map((i) => ({
          id: i.id,
          description_snapshot: i.description_snapshot,
          quantity: i.quantity,
          total: parseFloat(i.total?.toString() || "0"),
          status: i.status,
          modifiers: modsMap[i.id] || [],
        }));

        const total = related.reduce((sum, item) => sum + parseFloat(item.total?.toString() || "0"), 0);
        const item_count = related.reduce((count, it) => count + it.quantity, 0);

        return {
          ...order,
          total,
          item_count,
          items: formattedItems,
        };
      });


      return ordersWithDetails;
    },
    enabled: !!activeBranchId,
  });
}