import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";

export interface KitchenOrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  dispatched_at: string | null;
  modifiers: { description: string }[];
}

export interface KitchenOrder {
  id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  sent_at: string;
  items: KitchenOrderItem[];
}

export function useKitchenOrders() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  const query = useQuery({
    queryKey: ["kitchen-orders", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_type, table_id, split_id, updated_at")
        .eq("status", "SENT_TO_KITCHEN")
        .eq("branch_id", activeBranchId)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      if (!orders || orders.length === 0) return [];

      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      }

      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      const orderIds = orders.map((o) => o.id);
      const { data: items } = await supabase
        .from("order_items")
        .select("id, order_id, description_snapshot, quantity, dispatched_at")
        .in("order_id", orderIds)
        .order("created_at");

      const itemIds = (items ?? []).map((i) => i.id);
      let modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        for (const m of mods ?? []) {
          if (!modsMap[m.order_item_id]) modsMap[m.order_item_id] = [];
          modsMap[m.order_item_id].push({ description: (m.modifiers as any)?.description ?? "" });
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
            dispatched_at: (i as any).dispatched_at ?? null,
            modifiers: modsMap[i.id] ?? [],
          })),
      })) as KitchenOrder[];
    },
    refetchInterval: 10000,
  });

  const dispatchItem = useMutation({
    mutationFn: async ({ itemId, orderId }: { itemId: string; orderId: string }) => {
      const { error } = await supabase
        .from("order_items")
        .update({ dispatched_at: new Date().toISOString() } as any)
        .eq("id", itemId);
      if (error) throw error;

      // Check if all items in the order are now dispatched
      const { data: remaining } = await supabase
        .from("order_items")
        .select("id, dispatched_at")
        .eq("order_id", orderId);

      const allDispatched = (remaining ?? []).every((r: any) => r.dispatched_at != null);
      if (allDispatched) {
        // Takeout orders already paid → set PAID (final); Dine-in → KITCHEN_DISPATCHED (ready for caja)
        const { data: orderData } = await supabase
          .from("orders")
          .select("order_type")
          .eq("id", orderId)
          .single();
        const hasPaid = await supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId);
        const nextStatus = (hasPaid.count ?? 0) > 0 ? "PAID" : "KITCHEN_DISPATCHED";
        await supabase.from("orders").update({ status: nextStatus }).eq("id", orderId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const dispatchAll = useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();
      const { error: itemsErr } = await supabase
        .from("order_items")
        .update({ dispatched_at: now } as any)
        .eq("order_id", orderId)
        .is("dispatched_at", null);
      if (itemsErr) throw itemsErr;

      // If order was already paid (takeout), set PAID; otherwise KITCHEN_DISPATCHED
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId);
      const nextStatus = (count ?? 0) > 0 ? "PAID" : "KITCHEN_DISPATCHED";
      const { error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
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
    dispatchItem,
    dispatchAll,
  };
}
