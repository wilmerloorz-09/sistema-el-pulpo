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
  quantity_cancelled_pending?: number;
  quantity_cancelled_ready?: number;
  quantity_cancelled_dispatched?: number;
}

interface CancelOrderParams {
  orderId: string;
  items: CancelOrderItemSelection[];
  userId: string;
  cancellationType: "partial" | "total";
  cancellationData?: CancellationData;
  requiresAuthorization?: boolean;
}

function isMissingRelationError(error: unknown, relationName: string) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: string }).message) : "";

  return (
    code === "PGRST205" ||
    code === "PGRST204" ||
    message.includes(`Could not find the table 'public.${relationName}'`) ||
    message.includes(`Could not find the '${"branch_id"}' column of '${relationName}'`)
  );
}

function applyCancellationToOrderCache(
  current: any,
  selections: Array<{ order_item_id: string; quantity_cancelled: number }>,
  cancellationType: "partial" | "total"
) {
  if (!current) return current;

  const cancelledMap = Object.fromEntries(
    selections.map((selection) => [selection.order_item_id, Number(selection.quantity_cancelled) || 0])
  );

  const nextItems = (current.items ?? [])
    .map((item: any) => {
      const cancelled = cancelledMap[item.id] ?? 0;
      if (!cancelled) return item;

      const originalQuantity = Number(item.original_quantity ?? item.quantity ?? 0);
      const previousCancelled = Number(item.cancelled_quantity ?? 0);
      const totalCancelled = Math.min(originalQuantity, previousCancelled + cancelled);
      const activeQuantity = Math.max(0, originalQuantity - totalCancelled);

      return {
        ...item,
        quantity: activeQuantity,
        cancelled_quantity: totalCancelled,
        total: Math.round(activeQuantity * Number(item.unit_price ?? 0) * 100) / 100,
        status: activeQuantity <= 0 ? "CANCELLED" : item.status,
      };
    })
    .filter((item: any) => item.quantity > 0);

  return {
    ...current,
    status: cancellationType === "total" || nextItems.length === 0 ? "CANCELLED" : current.status,
    items: nextItems,
  };
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

    const dispatchedSelections = selections.filter((item) => (item.quantity_cancelled_dispatched ?? 0) > 0);
    const sentSelections = selections.filter(
      (item) => ((item.quantity_cancelled_pending ?? 0) + (item.quantity_cancelled_ready ?? 0)) > 0,
    );

    for (const item of dispatchedSelections) {
      const amount = Math.round((item.quantity_cancelled_dispatched ?? 0) * item.unit_price * 100) / 100;
      try {
        await recordOperationalLoss(orderId, item.order_item_id, amount, reason, userId, activeBranchId);
      } catch (error) {
        if (!isMissingRelationError(error, "operational_losses")) {
          throw error;
        }
        console.warn("operational_losses no disponible; se omite el registro de merma", error);
      }
    }

    if (sentSelections.length > 0) {
      const orders = await dbSelect("orders", {
        select: "order_number",
        filters: [{ column: "id", op: "eq", value: orderId }],
      });

      const order = orders[0] as { order_number?: number } | undefined;
      if (order?.order_number) {
        try {
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
        } catch (error) {
          if (!isMissingRelationError(error, "kitchen_notifications")) {
            throw error;
          }
          console.warn("kitchen_notifications no disponible; se omiten notificaciones de cocina", error);
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

      return {
        itemId,
        orderId,
        isRequest: false,
        selections: [{ order_item_id: itemId, quantity_cancelled: quantity }],
        cancellationType: "partial" as const,
      };
    },
    onSuccess: async (data) => {
      if (data.isRequest) {
        toast.success("Solicitud de anulación enviada");
        qc.setQueryData(["order", data.orderId], (current: any) => {
          if (!current) return current;
          return { ...current, cancel_requested_at: new Date().toISOString() };
        });
      } else {
        qc.setQueryData(["order", data.orderId], (current: any) =>
          applyCancellationToOrderCache(current, data.selections, data.cancellationType)
        );
        toast.success("Item cancelado");
      }
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      await qc.refetchQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      console.error("Error cancelando item:", error);
      toast.error("Error al cancelar item: " + (error?.message || "Error desconocido"));
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (params: CancelOrderParams) => {
      const { orderId, items, userId, cancellationType, cancellationData, requiresAuthorization } = params;
      const reason = cancellationData?.reason || "Sin especificar";

      if (requiresAuthorization) {
        const { error } = await supabase.rpc("request_order_cancellation", {
          p_order_id: orderId,
          p_user_id: userId,
        });

        if (error) throw error;

        return {
          orderId,
          isRequest: true,
          cancellationId: null,
          selections: [],
          cancellationType,
        };
      }

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

      return {
        orderId,
        isRequest: false,
        cancellationId: data as string | null,
        selections: (cancellationType === "total" ? items : selectedItems).map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.quantity_cancelled,
          quantity_cancelled_pending: item.quantity_cancelled_pending,
          quantity_cancelled_ready: item.quantity_cancelled_ready,
          quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
        })),
        cancellationType,
      };
    },
    onSuccess: async (data) => {
      if (data.isRequest) {
        toast.success("Solicitud de anulación enviada");
        qc.setQueryData(["order", data.orderId], (current: any) => {
          if (!current) return current;
          return { ...current, cancel_requested_at: new Date().toISOString() };
        });
      } else {
        qc.setQueryData(["order", data.orderId], (current: any) =>
          applyCancellationToOrderCache(current, data.selections, data.cancellationType)
        );
        toast.success("Cancelacion aplicada");
      }
      qc.invalidateQueries({ queryKey: ["order", data.orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      await qc.refetchQueries({ queryKey: ["orders"] });
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
