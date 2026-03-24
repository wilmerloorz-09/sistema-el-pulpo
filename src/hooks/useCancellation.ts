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
import { generateUUID } from "@/lib/uuid";

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

interface ApproveCancellationRequestParams {
  orderId: string;
  userId: string;
}

function parsePendingRequestItemsFromNotes(notes: string | null): Array<{ order_item_id: string; quantity_cancelled: number }> {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("[PENDING_REQUEST]")) return [];

  const jsonPart = raw.replace(/^\[PENDING_REQUEST\]\s*/, "").trim();
  if (!jsonPart) return [];

  try {
    const parsed = JSON.parse(jsonPart) as { items?: Array<{ order_item_id?: string; quantity_cancelled?: number }> };
    return (parsed.items ?? [])
      .map((item) => ({
        order_item_id: String(item?.order_item_id ?? "").trim(),
        quantity_cancelled: Math.max(0, Math.floor(Number(item?.quantity_cancelled ?? 0))),
      }))
      .filter((item) => item.order_item_id.length > 0 && item.quantity_cancelled > 0);
  } catch {
    return [];
  }
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

function isMissingRpcFunctionError(error: unknown, functionName: string) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: string }).message) : "";

  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes(`Could not find the function public.${functionName}`) ||
    message.includes(`function public.${functionName}`)
  );
}

function isAuthorizationRequiredError(error: unknown) {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: string }).message) : "";
  return message.toLowerCase().includes("requiere autorizacion");
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

  const requestOrderCancellationFallback = async (orderId: string, userId: string) => {
    const now = new Date().toISOString();

    try {
      const { error } = await (supabase.from("orders") as any)
        .update({
          cancel_requested_by: userId,
          cancel_requested_at: now,
        })
        .eq("id", orderId);

      if (!error) return;

      const { error: retryError } = await (supabase.from("orders") as any)
        .update({
          cancel_requested_at: now,
        })
        .eq("id", orderId);

      if (retryError) throw retryError;
    } catch (fallbackError) {
      throw fallbackError;
    }
  };

  const createPendingCancellationDraftDirect = async (
    orderId: string,
    userId: string,
    reason: string,
    notes: string | null | undefined,
    items: CancelOrderItemSelection[],
    cancellationType: "partial" | "total",
  ) => {
    const now = new Date().toISOString();
    const draftId = generateUUID();
    const payload = {
      notes: notes?.trim() || null,
      items: items
        .filter((item) => item.quantity_cancelled > 0)
        .map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.quantity_cancelled,
        })),
    };

    const { data: existingDrafts, error: existingDraftsError } = await supabase
      .from("order_cancellations")
      .select("id")
      .eq("order_id", orderId)
      .eq("status", "VOIDED")
      .ilike("notes", "[PENDING_REQUEST]%");
    if (existingDraftsError) throw existingDraftsError;

    const existingDraftIds = (existingDrafts ?? []).map((row) => row.id);
    if (existingDraftIds.length > 0) {
      const { error: deleteDetailError } = await supabase
        .from("order_item_cancellations")
        .delete()
        .in("order_cancellation_id", existingDraftIds);
      if (deleteDetailError) throw deleteDetailError;

      const { error: deleteHeaderError } = await supabase
        .from("order_cancellations")
        .delete()
        .in("id", existingDraftIds);
      if (deleteHeaderError) throw deleteHeaderError;
    }

    const { error: headerError } = await supabase.from("order_cancellations").insert({
      id: draftId,
      order_id: orderId,
      cancellation_type: cancellationType,
      reason,
      notes: `[PENDING_REQUEST] ${JSON.stringify(payload)}`,
      created_by: userId,
      status: "VOIDED",
      created_at: now,
    } as any);
    if (headerError) throw headerError;

    const detailRows = items
      .filter((item) => item.quantity_cancelled > 0)
      .map((item) => ({
        id: generateUUID(),
        order_cancellation_id: draftId,
        order_id: orderId,
        order_item_id: item.order_item_id,
        quantity_cancelled: item.quantity_cancelled,
        unit_price: item.unit_price,
        total_amount: Math.round(item.quantity_cancelled * item.unit_price * 100) / 100,
        source_stage:
          (item.quantity_cancelled_dispatched ?? 0) > 0
            ? "DISPATCHED"
            : (item.quantity_cancelled_ready ?? 0) > 0
              ? "READY"
              : "PENDING",
        created_at: now,
      }));

    if (detailRows.length > 0) {
      const { error: detailError } = await supabase.from("order_item_cancellations").insert(detailRows as any);
      if (detailError) throw detailError;
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
      const selectedItems = items.filter((item) => item.quantity_cancelled > 0);

      const createAuthorizationRequest = async () => {
        const { error } = await supabase.rpc("create_pending_order_cancellation_request", {
          p_order_id: orderId,
          p_user_id: userId,
          p_reason: reason,
          p_notes: cancellationData?.notes ?? null,
          p_items: items.map((item) => ({
            order_item_id: item.order_item_id,
            quantity_cancelled: item.quantity_cancelled,
          })),
          p_cancellation_type: cancellationType,
        });

        if (error) {
          if (!isMissingRpcFunctionError(error, "create_pending_order_cancellation_request")) {
            throw error;
          }

          const fallbackRequest = await supabase.rpc("request_order_cancellation", {
            p_order_id: orderId,
            p_user_id: userId,
          });

          if (fallbackRequest.error) {
            if (!isMissingRpcFunctionError(fallbackRequest.error, "request_order_cancellation")) {
              throw fallbackRequest.error;
            }

            await requestOrderCancellationFallback(orderId, userId);
          }

          await createPendingCancellationDraftDirect(
            orderId,
            userId,
            reason,
            cancellationData?.notes ?? null,
            items,
            cancellationType,
          );
        }

        return {
          orderId,
          isRequest: true,
          cancellationId: null,
          selections: [],
          cancellationType,
        };
      };

      if (requiresAuthorization) {
        return createAuthorizationRequest();
      }

      if (cancellationType === "partial" && selectedItems.length === 0) {
        throw new Error("Debes seleccionar al menos un item con cantidad a cancelar");
      }

      let data;
      try {
        const response = await supabase.rpc("cancel_order_quantities", {
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

        if (response.error) throw response.error;
        data = response.data;
      } catch (error) {
        if (!isAuthorizationRequiredError(error)) {
          throw error;
        }

        return createAuthorizationRequest();
      }

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

  const rejectCancellationRequestMutation = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase.rpc("clear_pending_order_cancellation_request", {
        p_order_id: orderId,
      });
      if (error) throw error;

      return { orderId };
    },
    onSuccess: async ({ orderId }) => {
      qc.setQueryData(["order", orderId], (current: any) => {
        if (!current) return current;
        return {
          ...current,
          cancel_requested_at: null,
        };
      });
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      await qc.refetchQueries({ queryKey: ["orders"] });
      toast.success("Solicitud de anulacion negada");
    },
    onError: (error: any) => {
      console.error("Error negando solicitud de anulacion:", error);
      toast.error("Error al negar la solicitud: " + (error?.message || "Error desconocido"));
    },
  });

  const approveCancellationRequestMutation = useMutation({
    mutationFn: async ({ orderId, userId }: ApproveCancellationRequestParams) => {
      const { data: pendingDrafts, error: pendingDraftsError } = await supabase
        .from("order_cancellations")
        .select("id, reason, notes, cancellation_type, created_at")
        .eq("order_id", orderId)
        .eq("status", "VOIDED")
        .ilike("notes", "[PENDING_REQUEST]%")
        .order("created_at", { ascending: false });
      if (pendingDraftsError) throw pendingDraftsError;

      const drafts = pendingDrafts ?? [];
      if (drafts.length === 0) {
        throw new Error("No se encontro una solicitud pendiente para esta orden");
      }

      const draftIds = drafts.map((draft) => draft.id);
      const { data: draftItems, error: draftItemsError } = await supabase
        .from("order_item_cancellations")
        .select("order_cancellation_id, order_item_id, quantity_cancelled, source_stage, unit_price")
        .in("order_cancellation_id", draftIds);
      if (draftItemsError) throw draftItemsError;

      const itemsByDraftId = new Map<string, typeof draftItems>();
      for (const row of draftItems ?? []) {
        const bucket = itemsByDraftId.get(row.order_cancellation_id) ?? [];
        bucket.push(row);
        itemsByDraftId.set(row.order_cancellation_id, bucket);
      }

      const draft =
        drafts.find((candidate) => (itemsByDraftId.get(candidate.id)?.length ?? 0) > 0)
        ?? drafts.find((candidate) => parsePendingRequestItemsFromNotes(candidate.notes).length > 0)
        ?? null;

      if (!draft) {
        throw new Error("La solicitud pendiente no tiene detalle para autorizar");
      }

      const selectedDraftItems = itemsByDraftId.get(draft.id) ?? [];
      if (selectedDraftItems.length === 0) {
        throw new Error("La solicitud pendiente no tiene detalle operativo para autorizar");
      }

      const aggregatedByItem = new Map<string, {
        quantity_cancelled: number;
        quantity_cancelled_pending: number;
        quantity_cancelled_ready: number;
        quantity_cancelled_dispatched: number;
        unit_price: number;
      }>();

      for (const row of selectedDraftItems) {
        const current = aggregatedByItem.get(row.order_item_id) ?? {
          quantity_cancelled: 0,
          quantity_cancelled_pending: 0,
          quantity_cancelled_ready: 0,
          quantity_cancelled_dispatched: 0,
          unit_price: Number(row.unit_price ?? 0),
        };

        const qty = Number(row.quantity_cancelled ?? 0);
        current.quantity_cancelled += qty;
        current.unit_price = Number(row.unit_price ?? current.unit_price ?? 0);

        if (row.source_stage === "DISPATCHED") current.quantity_cancelled_dispatched += qty;
        else if (row.source_stage === "READY") current.quantity_cancelled_ready += qty;
        else current.quantity_cancelled_pending += qty;

        aggregatedByItem.set(row.order_item_id, current);
      }

      const orderItems = await dbSelect<{
        id: string;
        description_snapshot: string;
      }>("order_items", {
        select: "id, description_snapshot",
        filters: [{ column: "order_id", op: "eq", value: orderId }],
      });
      const itemDescriptionMap = Object.fromEntries(orderItems.map((item) => [item.id, item.description_snapshot]));

      const selectedItems: CancelOrderItemSelection[] = Array.from(aggregatedByItem.entries()).map(([orderItemId, row]) => ({
        order_item_id: orderItemId,
        quantity_cancelled: row.quantity_cancelled,
        quantity_cancelled_pending: row.quantity_cancelled_pending,
        quantity_cancelled_ready: row.quantity_cancelled_ready,
        quantity_cancelled_dispatched: row.quantity_cancelled_dispatched,
        unit_price: row.unit_price,
        description_snapshot: itemDescriptionMap[orderItemId] ?? "Item",
        status: "PENDING_CANCELLATION",
      }));

      const { data, error } = await supabase.rpc("cancel_order_quantities", {
        p_order_id: orderId,
        p_cancelled_by: userId,
        p_reason: draft.reason || "Sin especificar",
        p_notes: draft.notes ?? null,
        p_items: selectedItems.map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.quantity_cancelled,
        })),
        p_cancellation_type: (draft.cancellation_type as "partial" | "total") ?? "partial",
      });
      if (error) throw error;

      const { error: clearPendingError } = await supabase.rpc("clear_pending_order_cancellation_request", {
        p_order_id: orderId,
      });
      if (clearPendingError) throw clearPendingError;

      await runKitchenAndLossSideEffects(orderId, userId, draft.reason || "Sin especificar", selectedItems);

      return {
        orderId,
        cancellationId: data as string | null,
        selections: selectedItems.map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.quantity_cancelled,
          quantity_cancelled_pending: item.quantity_cancelled_pending,
          quantity_cancelled_ready: item.quantity_cancelled_ready,
          quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
        })),
        cancellationType: (draft.cancellation_type as "partial" | "total") ?? "partial",
      };
    },
    onSuccess: async (data) => {
      qc.setQueryData(["order", data.orderId], (current: any) =>
        ({
          ...applyCancellationToOrderCache(current, data.selections, data.cancellationType),
          cancel_requested_at: null,
          cancel_requested_by: null,
        })
      );
      qc.setQueriesData({ queryKey: ["orders"] }, (current: any) => {
        if (!Array.isArray(current)) return current;
        return current.map((order: any) =>
          order?.id === data.orderId
            ? { ...order, cancel_requested_at: null, cancel_requested_by: null }
            : order,
        );
      });
      qc.setQueriesData({ queryKey: ["orders"] }, (current: any) => {
        if (!Array.isArray(current)) return current;
        return current.filter((order: any) => !(order?.id === data.orderId && order?.status === "PENDING_CANCELLATION"));
      });
      qc.invalidateQueries({ queryKey: ["order", data.orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      await qc.refetchQueries({ queryKey: ["orders"] });
      toast.success("Anulacion autorizada");
    },
    onError: (error: any) => {
      console.error("Error autorizando solicitud de anulacion:", error);
      toast.error("Error al autorizar la anulacion: " + (error?.message || "Error desconocido"));
    },
  });

  return {
    cancelItemMutation,
    cancelOrderMutation,
    rejectCancellationRequestMutation,
    approveCancellationRequestMutation,
  };
}

export type { CancelOrderItemSelection, CancelOrderParams };
