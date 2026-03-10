import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDispatchConfig } from "./useDispatchConfig";
import { computeLineAmount } from "@/lib/paymentQuantity";
import type { OrderStatus } from "@/types/cancellation";

export interface DispatchOrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  status: string;
  dispatched_at: string | null;
  modifiers: { description: string }[];
  item_note?: string | null;
  total?: number;
}

export interface DispatchOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  status: OrderStatus;
  updated_at: string;
  sent_to_kitchen_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  items: DispatchOrderItem[];
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

export function useDispatchOrders() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: configLoading } = useDispatchConfig();

  const query = useQuery({
    queryKey: ["dispatch-orders", activeBranchId, config?.dispatch_mode, user?.id],
    queryFn: async () => {
      if (!activeBranchId || !user) return [];

      const dispatchMode = configLoading ? "SINGLE" : (config?.dispatch_mode || "SINGLE");

      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, order_number, order_code, order_type, table_id, split_id, status, updated_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at")
        .eq("branch_id", activeBranchId)
        .in("status", ["SENT_TO_KITCHEN", "READY"])
        .order("updated_at", { ascending: true });

      if (ordersError) throw ordersError;
      if (!orders || orders.length === 0) return [];

      const tableIds = [...new Set(orders.map((order) => order.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((table) => [table.id, table.name]));
      }

      const splitIds = [...new Set(orders.map((order) => order.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((split) => [split.id, split.split_code]));
      }

      const orderIds = orders.map((order) => order.id);
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("id, order_id, description_snapshot, item_note, quantity, unit_price, total, status, dispatched_at")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const itemIds = (items ?? []).map((item) => item.id);
      const modifiersMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: modifierRows } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);

        for (const row of modifierRows ?? []) {
          if (!modifiersMap[row.order_item_id]) modifiersMap[row.order_item_id] = [];
          const rawDescription = Array.isArray((row as any).modifiers) ? (row as any).modifiers[0]?.description : (row as any).modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          modifiersMap[row.order_item_id].push({ description });
        }
      }
      const cancelledQtyMap = await fetchAppliedCancelledQuantityByOrderItem(itemIds);

      let filteredOrders = orders;
      if (dispatchMode === "SPLIT") {
        const userAssignments = (assignments || []).filter((assignment) => assignment.user_id === user.id);
        if (userAssignments.length > 0) {
          const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));
          filteredOrders = orders.filter((order) => {
            const orderType = order.order_type === "DINE_IN" || order.order_type === "TABLE" ? "TABLE" : "TAKEOUT";
            return assignedTypes.has(orderType) || assignedTypes.has("ALL");
          });
        }
      }

      const itemsMap = ((items ?? []) as any[])
        .map((item) => {
          const originalQuantity = Number(item.quantity ?? 0);
          const cancelledQuantity = Math.min(originalQuantity, cancelledQtyMap[item.id] ?? 0);
          const activeQuantity = Math.max(0, originalQuantity - cancelledQuantity);
          const effectiveStatus = activeQuantity <= 0 ? "CANCELLED" : (item.status ?? "SENT");

          return {
            ...item,
            quantity: activeQuantity,
            status: effectiveStatus,
            total: computeLineAmount(activeQuantity, Number(item.unit_price ?? 0)),
          };
        })
        .filter((item) => item.status !== "DRAFT" && item.quantity > 0)
        .reduce((acc: Record<string, any[]>, item: any) => {
          if (!acc[item.order_id]) acc[item.order_id] = [];
          acc[item.order_id].push(item);
          return acc;
        }, {});

      return filteredOrders
        .map((order) => ({
          id: order.id,
          order_number: order.order_number,
          order_code: order.order_code,
          order_type: order.order_type,
          table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
          split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
          status: order.status,
          updated_at: order.updated_at,
          sent_to_kitchen_at: order.sent_to_kitchen_at ?? null,
          ready_at: order.ready_at ?? null,
          dispatched_at: order.dispatched_at ?? null,
          paid_at: order.paid_at ?? null,
          cancelled_at: order.cancelled_at ?? null,
          items: (itemsMap[order.id] || []).map((item) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            quantity: item.quantity,
            status: item.status,
            dispatched_at: item.dispatched_at ?? null,
            total: item.total,
            modifiers: modifiersMap[item.id] ?? [],
            item_note: item.item_note ?? null,
          })),
        }))
        .filter((order) => order.items.length > 0) as DispatchOrder[];
    },
    enabled: !!activeBranchId && !!user,
    refetchInterval: 5000,
  });

  const markReadyMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "READY", ready_at: now })
        .eq("id", orderId);
      if (updateError) throw updateError;

      await supabase.from("order_items").update({ ready_at: now }).eq("order_id", orderId).neq("status", "CANCELLED");

      try {
        await (supabase.from("order_ready_notifications" as any).insert({ order_id: orderId, created_at: now }) as any);
      } catch {
        // Notification should not block dispatch flow.
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast.success("Orden lista para despachar");
    },
    onError: (error: any) => {
      toast.error(`Error al marcar orden lista: ${error?.message || "Error desconocido"}`);
    },
  });

  const markDispatchedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "KITCHEN_DISPATCHED", dispatched_at: now })
        .eq("id", orderId);
      if (updateError) throw updateError;

      const { error: itemsError } = await supabase.from("order_items").update({ dispatched_at: now }).eq("order_id", orderId);
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast.success("Orden despachada");
    },
    onError: (error: any) => {
      toast.error(`Error al despachar orden: ${error?.message || "Error desconocido"}`);
    },
  });

  return {
    orders: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    markReady: markReadyMutation,
    markDispatched: markDispatchedMutation,
  };
}




