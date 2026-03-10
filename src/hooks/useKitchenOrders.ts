import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";

export interface KitchenOrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  dispatched_at: string | null;
  modifiers: { description: string }[];
  item_note?: string | null;
}

export interface KitchenOrder {
  id: string;
  order_number: number;
  order_code: string | null;
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

      // Fetch orders with SENT_TO_KITCHEN status via DatabaseService
      const orders = await dbSelect<{
        id: string;
        order_number: number;
        order_code: string | null;
        order_type: string;
        table_id: string | null;
        split_id: string | null;
        updated_at: string;
      }>("orders", {
        select: "id, order_number, order_code, order_type, table_id, split_id, updated_at",
        branchId: activeBranchId,
        filters: [{ column: "status", op: "eq", value: "SENT_TO_KITCHEN" }],
        orderBy: { column: "updated_at", ascending: true },
      });

      if (orders.length === 0) return [];

      // Fetch table names for DINE_IN orders
      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const tables = await dbSelect<{ id: string; name: string }>("restaurant_tables", {
          select: "id, name",
          filters: [{ column: "id", op: "in", value: tableIds }],
        });
        tablesMap = Object.fromEntries(tables.map((t) => [t.id, t.name]));
      }

      // Fetch split codes (relational query — passthrough)
      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      // Fetch order items via DatabaseService
      const orderIds = orders.map((o) => o.id);
      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        quantity: number;
        dispatched_at: string | null;
      }>("order_items", {
        select: "id, order_id, description_snapshot, item_note, quantity, dispatched_at",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      // Fetch modifiers (relational join — passthrough)
      const itemIds = items.map((i) => i.id);
      const modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        for (const m of mods ?? []) {
          if (!modsMap[m.order_item_id]) modsMap[m.order_item_id] = [];
          const rawDescription = Array.isArray((m as any).modifiers) ? (m as any).modifiers[0]?.description : (m as any).modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          modsMap[m.order_item_id].push({ description });
        }
      }

      return orders.map((o) => ({
        id: o.id,
        order_number: o.order_number,
        order_code: o.order_code ?? null,
        order_type: o.order_type as "DINE_IN" | "TAKEOUT",
        table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
        split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
        sent_at: o.updated_at,
        items: items
          .filter((i) => i.order_id === o.id)
          .map((i) => ({
            id: i.id,
            description_snapshot: i.description_snapshot,
            quantity: i.quantity,
            item_note: i.item_note ?? null,
            dispatched_at: i.dispatched_at ?? null,
            modifiers: modsMap[i.id] ?? [],
          })),
      })) as KitchenOrder[];
    },
    refetchInterval: 10000,
  });

  const dispatchItem = useMutation({
    mutationFn: async ({ itemId, orderId }: { itemId: string; orderId: string }) => {
      await dbUpdate("order_items", itemId, { dispatched_at: new Date().toISOString() });

      // Check if all items in the order are now dispatched
      const remaining = await dbSelect<{ id: string; dispatched_at: string | null }>("order_items", {
        select: "id, dispatched_at",
        filters: [{ column: "order_id", op: "eq", value: orderId }],
      });

      const allDispatched = remaining.every((r) => r.dispatched_at != null);
      if (allDispatched) {
        const { count } = await supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId);
        const nextStatus = (count ?? 0) > 0 ? "PAID" : "KITCHEN_DISPATCHED";
        await dbUpdate("orders", orderId, { status: nextStatus });
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
      // Get all undispatched items for this order
      const items = await dbSelect<{ id: string; dispatched_at: string | null }>("order_items", {
        filters: [{ column: "order_id", op: "eq", value: orderId }],
      });

      // Dispatch each undispatched item via DatabaseService
      const undispatched = items.filter((i) => !i.dispatched_at);
      await Promise.all(
        undispatched.map((item) => dbUpdate("order_items", item.id, { dispatched_at: now }))
      );

      // Determine next status
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId);
      const nextStatus = (count ?? 0) > 0 ? "PAID" : "KITCHEN_DISPATCHED";
      await dbUpdate("orders", orderId, { status: nextStatus });
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





