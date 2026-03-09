import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
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
      console.log("🚀 useOrdersByStatus: Starting query", { activeBranchId, status });
      
      if (!activeBranchId) {
        console.log("⚠️ useOrdersByStatus: No active branch, returning empty array");
        return [];
      }

      const filters = status ? [{ column: "status" as const, op: "eq" as const, value: status }] : [];
      console.log("🔍 useOrdersByStatus: Filters:", filters);

      try {
        const orders = await dbSelect<{
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

        console.log("✅ useOrdersByStatus: Orders fetched:", orders.length, "orders");
        if (orders.length > 0) {
          console.log("🔍 useOrdersByStatus: Sample order:", orders[0]);
        }

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

        console.log("✅ useOrdersByStatus: Items fetched:", items.length, "items");

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

        // Resolver nombres de mesa (join con restaurant_tables)
        const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
        let tablesMap: Record<string, string> = {};
        if (tableIds.length > 0) {
          const { data: tables } = await supabase
            .from("restaurant_tables")
            .select("id, name")
            .in("id", tableIds);
          if (tables) {
            tablesMap = Object.fromEntries(tables.map((t: { id: string; name: string }) => [t.id, t.name]));
          }
        }

        const ordersWithDetails = orders.map((order) => {
          // Only show items that were already sent (no drafts) in the Orders module.
          const related = items
            .filter((i) => i.order_id === order.id)
            .filter((i) => i.status !== "DRAFT");

          const formattedItems: OrderItemSummary[] = related.map((i) => ({
            id: i.id,
            description_snapshot: i.description_snapshot,
            quantity: i.quantity,
            total: parseFloat(i.total?.toString() || "0"),
            status: i.status,
            modifiers: modsMap[i.id] || [],
          }));

          const total = Number(order.total ?? 0) || related.reduce((sum, item) => sum + parseFloat(item.total?.toString() || "0"), 0);
          const item_count = related.reduce((count, it) => count + it.quantity, 0);

          return {
            ...order,
            split_code: null,
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            total,
            item_count,
            items: formattedItems,
          };
        });

        console.log("✅ useOrdersByStatus: Final orders with details:", ordersWithDetails.length, "orders");
        return ordersWithDetails;
      } catch (error) {
        console.error("❌ useOrdersByStatus: Query error:", error);
        throw error;
      }
    },
    enabled: !!activeBranchId,
  });
}



