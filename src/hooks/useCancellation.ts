import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordOperationalLoss,
  notifyKitchenItemCancelled as notifyKitchenItemCancelledDB,
  notifyKitchenOrderCancelled as notifyKitchenOrderCancelledDB,
  dbSelect,
  supabase,
} from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import type { CancellationData } from "@/types/cancellation";

interface CancelItemParams {
  itemId: string;
  orderId: string;
  currentStatus: string;
  quantity: number;
  unitPrice: number;
  userId: string;
  cancellationData?: CancellationData;
}

interface CancelOrderItemSelection {
  order_item_id: string;
  quantity_cancelled: number;
  status: string;
  description_snapshot: string;
  unit_price: number;
}

interface CancelOrderParams {
  orderId: string;
  items: CancelOrderItemSelection[];
  userId: string;
  cancellationType: "partial" | "total";
  cancellationData?: CancellationData;
}

export function useCancellation() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  const runKitchenAndLossSideEffects = async (
    orderId: string,
    userId: string,
    reason: string,
    selections: CancelOrderItemSelection[]
  ) => {
    if (!activeBranchId) return;

    const dispatchedSelections = selections.filter((item) => item.status === "DISPATCHED" && item.quantity_cancelled > 0);
    const sentSelections = selections.filter((item) => item.status === "SENT" && item.quantity_cancelled > 0);

    for (const item of dispatchedSelections) {
      const amount = Math.round(item.quantity_cancelled * item.unit_price * 100) / 100;
      await recordOperationalLoss(orderId, item.order_item_id, amount, reason, userId, activeBranchId);
    }

    if (sentSelections.length > 0) {
      const orders = await dbSelect("orders", {
        select: "order_number",
        filters: [{ column: "id", op: "eq", value: orderId }],
      });

      const order = orders[0] as { order_number?: number } | undefined;
      if (order?.order_number) {
        await notifyKitchenOrderCancelledDB(orderId, order.order_number, sentSelections.length, reason, activeBranchId);

        for (const item of sentSelections) {
          await notifyKitchenItemCancelledDB(
            orderId,
            order.order_number,
            item.order_item_id,
            item.description_snapshot,
            item.quantity_cancelled,
            reason,
            activeBranchId
          );
        }
      }
    }
  };

  const cancelItemMutation = useMutation({
    mutationFn: async (params: CancelItemParams) => {
      const { itemId, orderId, currentStatus, quantity, unitPrice, userId, cancellationData } = params;
      const reason = cancellationData?.reason || "Sin especificar";

      const { error } = await supabase.rpc("cancel_order_quantities", {
        p_order_id: orderId,
        p_cancelled_by: userId,
        p_reason: reason,
        p_notes: cancellationData?.notes ?? null,
        p_items: [{ order_item_id: itemId, quantity_cancelled: quantity }],
        p_cancellation_type: "partial",
      });

      if (error) throw error;

      await runKitchenAndLossSideEffects(orderId, userId, reason, [
        {
          order_item_id: itemId,
          quantity_cancelled: quantity,
          status: currentStatus,
          description_snapshot: "",
          unit_price: unitPrice,
        },
      ]);

      return { itemId, orderId };
    },
    onSuccess: (data) => {
      toast.success("Item cancelado");
      qc.invalidateQueries({ queryKey: ["order", data.orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
    },
    onError: (error: any) => {
      console.error("Error cancelando item:", error);
      toast.error("Error al cancelar item: " + (error?.message || "Error desconocido"));
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (params: CancelOrderParams) => {
      const { orderId, items, userId, cancellationType, cancellationData } = params;
      const reason = cancellationData?.reason || "Sin especificar";

      const selectedItems = items.filter((item) => item.quantity_cancelled > 0);

      if (cancellationType === "partial" && selectedItems.length === 0) {
        throw new Error("Debes seleccionar al menos un item con cantidad a cancelar");
      }

      const { data, error } = await supabase.rpc("cancel_order_quantities", {
        p_order_id: orderId,
        p_cancelled_by: userId,
        p_reason: reason,
        p_notes: cancellationData?.notes ?? null,
        p_items: selectedItems.map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.quantity_cancelled,
        })),
        p_cancellation_type: cancellationType,
      });

      if (error) throw error;

      await runKitchenAndLossSideEffects(orderId, userId, reason, cancellationType === "total" ? items : selectedItems);

      return { orderId, cancellationId: data as string | null };
    },
    onSuccess: (data) => {
      toast.success("Cancelacion aplicada");
      qc.invalidateQueries({ queryKey: ["order", data.orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (error: any) => {
      console.error("Error cancelando orden:", error);
      toast.error("Error al cancelar orden: " + (error?.message || "Error desconocido"));
    },
  });

  return {
    cancelItemMutation,
    cancelOrderMutation,
  };
}

export type { CancelOrderItemSelection, CancelOrderParams };

