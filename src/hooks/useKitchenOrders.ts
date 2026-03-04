import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface KitchenOrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  modifiers: { description: string }[];
}

export interface KitchenOrder {
  id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  sent_at: string; // created_at or updated_at when status changed
  items: KitchenOrderItem[];
}

export function useKitchenOrders() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["kitchen-orders"],
    queryFn: async () => {
      // Fetch orders sent to kitchen
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_type, table_id, split_id, updated_at")
        .eq("status", "SENT_TO_KITCHEN")
        .order("updated_at", { ascending: true });
      if (error) throw error;
      if (!orders || orders.length === 0) return [];

      // Batch fetch table names
      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase
          .from("restaurant_tables")
          .select("id, name")
          .in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      }

      // Batch fetch split codes
      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase
          .from("table_splits")
          .select("id, split_code")
          .in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      // Batch fetch items
      const orderIds = orders.map((o) => o.id);
      const { data: items } = await supabase
        .from("order_items")
        .select("id, order_id, description_snapshot, quantity")
        .in("order_id", orderIds)
        .order("created_at");

      // Batch fetch modifiers
      const itemIds = (items ?? []).map((i) => i.id);
      let modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        for (const m of mods ?? []) {
          if (!modsMap[m.order_item_id]) modsMap[m.order_item_id] = [];
          modsMap[m.order_item_id].push({
            description: (m.modifiers as any)?.description ?? "",
          });
        }
      }

      return orders.map((o) => ({
        id: o.id,
        order_number: o.order_number,
        order_type: o.order_type as "DINE_IN" | "TAKEOUT",
        table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
        split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
        sent_at: o.updated_at,
        items: (items ?? [])
          .filter((i) => i.order_id === o.id)
          .map((i) => ({
            id: i.id,
            description_snapshot: i.description_snapshot,
            quantity: i.quantity,
            modifiers: modsMap[i.id] ?? [],
          })),
      })) as KitchenOrder[];
    },
    refetchInterval: 10000, // Auto-refresh every 10s
  });

  const dispatch = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: "KITCHEN_DISPATCHED" })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Orden despachada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    orders: query.data ?? [],
    isLoading: query.isLoading,
    dispatch,
  };
}
