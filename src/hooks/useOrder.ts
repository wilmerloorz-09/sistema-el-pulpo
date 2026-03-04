import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

interface Order {
  id: string;
  order_number: number;
  status: OrderStatus;
  order_type: "DINE_IN" | "TAKEOUT";
  table_id: string | null;
  table_name?: string;
  created_at: string;
  items: OrderItem[];
}

export function useOrder(orderId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      if (!orderId) return null;

      const { data: order, error } = await supabase
        .from("orders")
        .select("id, order_number, status, order_type, table_id, created_at")
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
      const { data: items, error: itemsErr } = await supabase
        .from("order_items")
        .select("id, product_id, description_snapshot, quantity, unit_price, total")
        .eq("order_id", orderId)
        .order("created_at");
      if (itemsErr) throw itemsErr;

      // Fetch modifiers for items
      const itemIds = items.map((i) => i.id);
      let modifiersData: any[] = [];
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("id, modifier_id, order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        modifiersData = mods ?? [];
      }

      const enrichedItems: OrderItem[] = items.map((item) => ({
        ...item,
        modifiers: modifiersData
          .filter((m: any) => m.order_item_id === item.id)
          .map((m: any) => ({
            id: m.id,
            modifier_id: m.modifier_id,
            description: m.modifiers?.description ?? "",
          })),
      }));

      return {
        ...order,
        table_name,
        items: enrichedItems,
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
      const { data: item, error } = await supabase
        .from("order_items")
        .insert({
          order_id: orderId!,
          product_id: params.product_id,
          description_snapshot: params.description_snapshot,
          unit_price: params.unit_price,
          quantity: params.quantity,
          total,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Add modifiers
      if (params.modifier_ids.length > 0) {
        const { error: modErr } = await supabase
          .from("order_item_modifiers")
          .insert(
            params.modifier_ids.map((mid) => ({
              order_item_id: item.id,
              modifier_id: mid,
            }))
          );
        if (modErr) throw modErr;
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
      // Delete modifiers first
      await supabase.from("order_item_modifiers").delete().eq("order_item_id", itemId);
      const { error } = await supabase.from("order_items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ itemId, quantity, unit_price }: { itemId: string; quantity: number; unit_price: number }) => {
      const { error } = await supabase
        .from("order_items")
        .update({ quantity, total: quantity * unit_price })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("orders")
        .update({ status: "SENT_TO_KITCHEN" as OrderStatus })
        .eq("id", orderId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Orden enviada a cocina");
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
