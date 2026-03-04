import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, dbDelete, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type OrderStatus = Database["public"]["Enums"]["order_status"];

interface OrderItem {
  id: string;
  product_id: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
  modifiers: { id: string; modifier_id: string; description: string }[];
}

interface SiblingOrder {
  id: string;
  order_number: number;
  split_code: string;
  item_count: number;
}

interface Order {
  id: string;
  order_number: number;
  status: OrderStatus;
  order_type: "DINE_IN" | "TAKEOUT";
  table_id: string | null;
  split_id: string | null;
  table_name?: string;
  created_at: string;
  items: OrderItem[];
  siblings: SiblingOrder[];
}

export function useOrder(orderId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      if (!orderId) return null;

      // Complex relational query — use supabase passthrough for reads,
      // but simple table reads go through dbSelect for caching
      const { data: order, error } = await supabase
        .from("orders")
        .select("id, order_number, status, order_type, table_id, split_id, created_at")
        .eq("id", orderId)
        .single();
      if (error) throw error;

      // Fetch table name
      let table_name: string | undefined;
      if (order.table_id) {
        const { data: t } = await supabase
          .from("restaurant_tables")
          .select("name")
          .eq("id", order.table_id)
          .single();
        table_name = t?.name;
      }

      // Fetch items
      const items = await dbSelect<any>("order_items", {
        select: "id, product_id, description_snapshot, quantity, unit_price, total",
        filters: [{ column: "order_id", op: "eq", value: orderId }],
        orderBy: { column: "created_at" },
      });

      // Fetch modifiers for items (complex join — supabase passthrough)
      const itemIds = items.map((i: any) => i.id);
      let modifiersData: any[] = [];
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("id, modifier_id, order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        modifiersData = mods ?? [];
      }

      const enrichedItems: OrderItem[] = items.map((item: any) => ({
        ...item,
        modifiers: modifiersData
          .filter((m: any) => m.order_item_id === item.id)
          .map((m: any) => ({
            id: m.id,
            modifier_id: m.modifier_id,
            description: m.modifiers?.description ?? "",
          })),
      }));

      // Fetch sibling split orders if this order belongs to a table
      let siblings: SiblingOrder[] = [];
      if (order.table_id) {
        const { data: siblingOrders } = await supabase
          .from("orders")
          .select("id, order_number, split_id, order_items(id)")
          .eq("table_id", order.table_id)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "KITCHEN_DISPATCHED"])
          .not("split_id", "is", null);

        if (siblingOrders && siblingOrders.length > 0) {
          const splitIds = [...new Set(siblingOrders.map(o => o.split_id).filter(Boolean))] as string[];
          const { data: splits } = await supabase
            .from("table_splits")
            .select("id, split_code")
            .in("id", splitIds);

          siblings = siblingOrders.map(o => ({
            id: o.id,
            order_number: o.order_number,
            split_code: splits?.find(s => s.id === o.split_id)?.split_code ?? "",
            item_count: Array.isArray(o.order_items) ? o.order_items.length : 0,
          }));
        }
      }

      return {
        ...order,
        table_name,
        items: enrichedItems,
        siblings,
      } as Order;
    },
    enabled: !!orderId,
  });

  const addItem = useMutation({
    mutationFn: async (params: {
      product_id: string;
      description_snapshot: string;
      unit_price: number;
      quantity: number;
      modifier_ids: string[];
    }) => {
      const total = params.unit_price * params.quantity;
      const itemId = crypto.randomUUID();

      await dbInsert("order_items", {
        id: itemId,
        order_id: orderId!,
        product_id: params.product_id,
        description_snapshot: params.description_snapshot,
        unit_price: params.unit_price,
        quantity: params.quantity,
        total,
      });

      // Add modifiers
      if (params.modifier_ids.length > 0) {
        for (const mid of params.modifier_ids) {
          await dbInsert("order_item_modifiers", {
            id: crypto.randomUUID(),
            order_item_id: itemId,
            modifier_id: mid,
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      // Delete modifiers first — use supabase for bulk delete by non-PK
      if (navigator.onLine) {
        await supabase.from("order_item_modifiers").delete().eq("order_item_id", itemId);
      }
      await dbDelete("order_items", itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ itemId, quantity, unit_price }: { itemId: string; quantity: number; unit_price: number }) => {
      await dbUpdate("order_items", itemId, { quantity, total: quantity * unit_price });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      const order = query.data;
      const newStatus: OrderStatus =
        order?.order_type === "TAKEOUT" ? "KITCHEN_DISPATCHED" : "SENT_TO_KITCHEN";

      await dbUpdate("orders", orderId!, { status: newStatus });
    },
    onSuccess: () => {
      const order = query.data;
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      toast.success(
        order?.order_type === "TAKEOUT"
          ? "Orden lista para cobrar en caja"
          : "Orden enviada a cocina"
      );
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    order: query.data,
    isLoading: query.isLoading,
    addItem,
    removeItem,
    updateQuantity,
    sendToKitchen,
  };
}
