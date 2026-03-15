import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";

// include CANCELLED since we'll add it to the enum via migration
type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

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
          .select("id, table_id, status, split_id, order_items(id)")
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

      return visibleTables.map((table): TableWithStatus => {
        const tableOrders = ordersByTable.get(table.id) ?? [];
        if (tableOrders.length === 0) {
          return {
            ...table,
            status: "free",
            splitCount: 0,
            activeOrderId: draftByTable.get(table.id),
          };
        }

        const hasDispatched = tableOrders.some((o) => o.status === "KITCHEN_DISPATCHED");
        const splits = new Set(tableOrders.filter((o) => o.split_id).map((o) => o.split_id));

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
    refetchInterval: 5000,
  });
}
