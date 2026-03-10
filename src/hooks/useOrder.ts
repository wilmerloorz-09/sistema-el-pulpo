import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, dbDelete, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { generateUUID } from "@/lib/uuid";
import { computeLineAmount } from "@/lib/paymentQuantity";

// support CANCELLED status even if enum not yet updated locally
type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

interface OrderItem {
  id: string;
  product_id: string;
  description_snapshot: string;
  item_note?: string | null;
  quantity: number;
  original_quantity?: number;
  cancelled_quantity?: number;
  unit_price: number;
  total: number;
  status: string;
  modifiers: { id: string; modifier_id: string; description: string }[];
}

interface SiblingOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  split_code: string;
  item_count: number;
}

interface Order {
  id: string;
  order_number: number;
  order_code: string | null;
  status: OrderStatus;
  order_type: "DINE_IN" | "TAKEOUT";
  table_id: string | null;
  split_id: string | null;
  table_name?: string;
  created_at: string;
  items: OrderItem[];
  siblings: SiblingOrder[];
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

export function useOrder(orderId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      if (!orderId) return null;

      const { data: order, error } = await supabase
        .from("orders")
        .select("id, order_number, order_code, status, order_type, table_id, split_id, created_at")
        .eq("id", orderId)
        .single();
      if (error) throw error;

      let table_name: string | undefined;
      if (order.table_id) {
        const { data: table } = await supabase
          .from("restaurant_tables")
          .select("name")
          .eq("id", order.table_id)
          .single();
        table_name = table?.name;
      }

      const items = await dbSelect<any>("order_items", {
        select: "id, product_id, description_snapshot, item_note, quantity, unit_price, total, status",
        filters: [{ column: "order_id", op: "eq", value: orderId }],
        orderBy: { column: "created_at" },
      });

      const itemIds = items.map((item: any) => item.id);
      const cancelledQtyMap = await fetchAppliedCancelledQuantityByOrderItem(itemIds);

      let modifiersData: any[] = [];
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("id, modifier_id, order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        modifiersData = mods ?? [];
      }

      const enrichedItems: OrderItem[] = items
        .map((item: any) => {
          const originalQuantity = Number(item.quantity ?? 0);
          const cancelledQuantity = Math.min(originalQuantity, cancelledQtyMap[item.id] ?? 0);
          const activeQuantity = Math.max(0, originalQuantity - cancelledQuantity);
          const effectiveStatus = activeQuantity <= 0 ? "CANCELLED" : (item.status ?? "DRAFT");

          return {
            ...item,
            quantity: activeQuantity,
            original_quantity: originalQuantity,
            cancelled_quantity: cancelledQuantity,
            total: computeLineAmount(activeQuantity, Number(item.unit_price ?? 0)),
            status: effectiveStatus,
            modifiers: modifiersData
              .filter((modifier: any) => modifier.order_item_id === item.id)
              .map((modifier: any) => ({
                id: modifier.id,
                modifier_id: modifier.modifier_id,
                description: String(Array.isArray((modifier as any).modifiers) ? (modifier as any).modifiers[0]?.description : (modifier as any).modifiers?.description ?? "").trim(),
              })),
          };
        })
        .filter((item) => item.quantity > 0 || item.status === "DRAFT");

      let siblings: SiblingOrder[] = [];
      if (order.table_id) {
        const { data: siblingOrders } = await supabase
          .from("orders")
          .select("id, order_number, order_code, split_id, order_items(id)")
          .eq("table_id", order.table_id)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
          .not("split_id", "is", null);

        if (siblingOrders && siblingOrders.length > 0) {
          const splitIds = [...new Set(siblingOrders.map((sibling) => sibling.split_id).filter(Boolean))] as string[];
          const { data: splits } = await supabase
            .from("table_splits")
            .select("id, split_code")
            .in("id", splitIds);

          siblings = siblingOrders.map((sibling) => ({
            id: sibling.id,
            order_number: sibling.order_number,
            order_code: (sibling as any).order_code ?? null,
            split_code: splits?.find((split) => split.id === sibling.split_id)?.split_code ?? "",
            item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
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
  item_note?: string | null;
      unit_price: number;
      quantity: number;
      modifier_ids: string[];
    }) => {
      const total = params.unit_price * params.quantity;
      const itemId = generateUUID();

      await dbInsert("order_items", {
        id: itemId,
        order_id: orderId!,
        product_id: params.product_id,
        description_snapshot: params.description_snapshot,
        item_note: params.item_note ?? null,
        unit_price: params.unit_price,
        quantity: params.quantity,
        total,
        status: "DRAFT",
      });

      if (params.modifier_ids.length > 0) {
        for (const modifierId of params.modifier_ids) {
          await dbInsert("order_item_modifiers", {
            id: generateUUID(),
            order_item_id: itemId,
            modifier_id: modifierId,
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
      if (!order) return;

      const draftItems = order.items.filter((item) => item.status === "DRAFT");
      if (draftItems.length === 0) return;

      const now = new Date().toISOString();

      await Promise.all(
        draftItems.map((item) =>
          dbUpdate("order_items", item.id, {
            status: "SENT",
            sent_to_kitchen_at: now,
          })
        )
      );

      if (order.status === "DRAFT") {
        const newStatus: OrderStatus = order.order_type === "TAKEOUT" ? "KITCHEN_DISPATCHED" : "SENT_TO_KITCHEN";
        const orderUpdate: Record<string, unknown> = { status: newStatus };
        if (newStatus === "SENT_TO_KITCHEN") {
          orderUpdate.sent_to_kitchen_at = now;
        }
        if (newStatus === "KITCHEN_DISPATCHED") {
          orderUpdate.dispatched_at = now;
        }
        await dbUpdate("orders", orderId!, orderUpdate);
      }
    },
    onSuccess: () => {
      const order = query.data;
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });

      const hasSentAlready = order?.items.some((item) => item.status !== "DRAFT");
      const message = order?.order_type === "TAKEOUT"
        ? hasSentAlready
          ? "Nuevos items listos para cobrar"
          : "Orden lista para cobrar en caja"
        : hasSentAlready
          ? "Nuevos items enviados a cocina"
          : "Orden enviada a cocina";

      toast.success(message);
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



