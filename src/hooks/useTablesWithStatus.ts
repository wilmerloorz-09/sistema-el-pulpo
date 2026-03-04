import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";

type OrderStatus = Database["public"]["Enums"]["order_status"];

interface TableWithStatus {
  id: string;
  name: string;
  visual_order: number;
  is_active: boolean;
  status: "free" | "occupied" | "to_pay";
  activeOrderId?: string;
  orderStatus?: OrderStatus;
  splitCount: number;
}

export function useTablesWithStatus() {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["tables-with-status", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const [tablesRes, ordersRes] = await Promise.all([
        supabase
          .from("restaurant_tables")
          .select("*")
          .eq("is_active", true)
          .eq("branch_id", activeBranchId)
          .order("visual_order"),
        supabase
          .from("orders")
          .select("id, table_id, status, split_id, order_items(id)")
          .not("table_id", "is", null)
          .eq("branch_id", activeBranchId)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "KITCHEN_DISPATCHED"]),
      ]);

      if (tablesRes.error) throw tablesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const tables = tablesRes.data;
      const orders = ordersRes.data;

      // Group orders by table — only include orders that have items OR are past DRAFT
      const ordersByTable = new Map<string, typeof orders>();
      for (const order of orders) {
        if (!order.table_id) continue;
        const hasItems = Array.isArray(order.order_items) && order.order_items.length > 0;
        const isPastDraft = order.status !== "DRAFT";
        if (!hasItems && !isPastDraft) continue; // DRAFT without items = still free
        const arr = ordersByTable.get(order.table_id) ?? [];
        arr.push(order);
        ordersByTable.set(order.table_id, arr);
      }

      // Also track draft orders without items so we can navigate to them
      const draftByTable = new Map<string, string>();
      for (const order of orders) {
        if (!order.table_id) continue;
        const hasItems = Array.isArray(order.order_items) && order.order_items.length > 0;
        if (order.status === "DRAFT" && !hasItems) {
          draftByTable.set(order.table_id, order.id);
        }
      }

      return tables.map((table): TableWithStatus => {
        const tableOrders = ordersByTable.get(table.id) ?? [];
        if (tableOrders.length === 0) {
          return {
            ...table,
            status: "free",
            splitCount: 0,
            activeOrderId: draftByTable.get(table.id), // link to empty draft if exists
          };
        }

        const hasDispatched = tableOrders.some((o) => o.status === "KITCHEN_DISPATCHED");
        const splits = new Set(tableOrders.filter(o => o.split_id).map(o => o.split_id));

        return {
          ...table,
          status: hasDispatched ? "to_pay" : "occupied",
          activeOrderId: tableOrders[0].id,
          orderStatus: tableOrders[0].status as OrderStatus,
          splitCount: splits.size,
        };
      });
    },
    enabled: !!activeBranchId,
    refetchInterval: 5000, // Poll every 5s for realtime-like updates
  });
}
