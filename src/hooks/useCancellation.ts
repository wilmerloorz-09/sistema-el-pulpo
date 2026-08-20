import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordOperationalLoss,
  notifyKitchenItemCancelled as notifyKitchenItemCancelledDB,
  notifyKitchenOrderCancelled as notifyKitchenOrderCancelledDB,
  dbSelect,
  dbInsert,
  dbUpdate,
  dbDelete,
  supabase,
} from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import type { CancellationData } from "@/types/cancellation";
import { generateUUID } from "@/lib/uuid";
import { applyCancellationToOrderCache } from "@/lib/orderCancellationCache";
import { invalidateOperationalOrderQueries } from "@/lib/queryEgress";
import { qk } from "@/lib/queryKeys";

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

function isOrderListQueryForBranch(queryKey: readonly unknown[], branchId: string | null | undefined) {
  return (
    queryKey[1] === branchId
    && (queryKey[0] === qk.orders[0] || queryKey[0] === qk.ordersList[0])
  );
}

interface OperationalSnapshotRow {
  order_item_id: string;
  description_snapshot?: string | null;
  unit_price?: number | string | null;
  quantity_pending_prepare?: number | string | null;
  quantity_ready_available?: number | string | null;
  quantity_dispatched_total?: number | string | null;
  quantity_dispatched?: number | string | null;
  quantity_cancelled_dispatched?: number | string | null;
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

function isRlsPolicyError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: string }).message) : "";

  return (
    code === "42501"
    || message.toLowerCase().includes("row-level security")
    || message.toLowerCase().includes("violates row-level security policy")
  );
}

function buildSelectionsFromOperationalSnapshot(
  snapshotRows: OperationalSnapshotRow[],
  requestedItems: Array<{ order_item_id: string; quantity_cancelled: number }>,
) {
  return requestedItems
    .map((requestedItem) => {
      const snapshot = snapshotRows.find((row) => String(row.order_item_id) === requestedItem.order_item_id);
      if (!snapshot) return null;

      let remainingQty = Math.max(0, Math.floor(Number(requestedItem.quantity_cancelled ?? 0)));
      const quantityCancelledPending = Math.min(remainingQty, Math.max(0, Number(snapshot.quantity_pending_prepare ?? 0)));
      remainingQty = Math.max(0, remainingQty - quantityCancelledPending);
      const quantityCancelledReady = Math.min(remainingQty, Math.max(0, Number(snapshot.quantity_ready_available ?? 0)));
      remainingQty = Math.max(0, remainingQty - quantityCancelledReady);
      const dispatchedAvailable = Math.max(
        0,
        Number(snapshot.quantity_dispatched_total ?? snapshot.quantity_dispatched ?? 0)
          - Number(snapshot.quantity_cancelled_dispatched ?? 0),
      );
      const quantityCancelledDispatched = Math.min(remainingQty, dispatchedAvailable);
      const quantityCancelled = quantityCancelledPending + quantityCancelledReady + quantityCancelledDispatched;

      if (quantityCancelled <= 0) return null;

      return {
        order_item_id: requestedItem.order_item_id,
        quantity_cancelled: quantityCancelled,
        quantity_cancelled_pending: quantityCancelledPending,
        quantity_cancelled_ready: quantityCancelledReady,
        quantity_cancelled_dispatched: quantityCancelledDispatched,
        unit_price: Number(snapshot.unit_price ?? 0),
        description_snapshot: String(snapshot.description_snapshot ?? "Item"),
        status: "PENDING_CANCELLATION",
      } satisfies CancelOrderItemSelection;
    })
    .filter((item) => item !== null) as CancelOrderItemSelection[];
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

    const existingDrafts = await dbSelect<any>("order_cancellations", {
      select: "id, notes",
      filters: [
        { column: "order_id", op: "eq", value: orderId },
        { column: "status", op: "eq", value: "VOIDED" },
        { column: "notes", op: "ilike" as any, value: "[PENDING_REQUEST]%" }
      ]
    });

    const existingDraftIds = (existingDrafts ?? []).map((row) => row.id);
    const mergedItemsMap = new Map<string, number>();

    if (existingDraftIds.length > 0) {
      const existingDetailRows = await dbSelect<any>("order_item_cancellations", {
        select: "order_cancellation_id, order_item_id, quantity_cancelled",
        filters: [{ column: "order_cancellation_id", op: "in", value: existingDraftIds }]
      });

      for (const row of existingDetailRows ?? []) {
        const orderItemId = String(row.order_item_id ?? "").trim();
        const qty = Math.max(0, Math.floor(Number(row.quantity_cancelled ?? 0)));
        if (!orderItemId || qty <= 0) continue;
        mergedItemsMap.set(orderItemId, (mergedItemsMap.get(orderItemId) ?? 0) + qty);
      }

      if (mergedItemsMap.size === 0) {
        for (const draft of existingDrafts ?? []) {
          for (const item of parsePendingRequestItemsFromNotes(draft.notes ?? null)) {
            mergedItemsMap.set(item.order_item_id, (mergedItemsMap.get(item.order_item_id) ?? 0) + item.quantity_cancelled);
          }
        }
      }
    }

    for (const item of items) {
      const orderItemId = String(item.order_item_id ?? "").trim();
      const qty = Math.max(0, Math.floor(Number(item.quantity_cancelled ?? 0)));
      if (!orderItemId || qty <= 0) continue;
      mergedItemsMap.set(orderItemId, (mergedItemsMap.get(orderItemId) ?? 0) + qty);
    }

    const mergedItems = Array.from(mergedItemsMap.entries()).map(([order_item_id, quantity_cancelled]) => ({
      order_item_id,
      quantity_cancelled,
    }));
    const payload = {
      notes: notes?.trim() || null,
      items: mergedItems,
    };

    if (existingDraftIds.length > 0) {
      for (const id of existingDraftIds) {
        // Bulk delete items first
        const itemsToDelete = await dbSelect<any>("order_item_cancellations", {
          select: "id",
          filters: [{ column: "order_cancellation_id", op: "eq", value: id }]
        });
        for (const item of itemsToDelete) {
          await dbDelete("order_item_cancellations", item.id);
        }
        // Then the header
        await dbDelete("order_cancellations", id);
      }
    }

    await dbInsert("order_cancellations", {
      id: draftId,
      order_id: orderId,
      cancellation_type: cancellationType,
      reason,
      notes: `[PENDING_REQUEST] ${JSON.stringify(payload)}`,
      created_by: userId,
      status: "VOIDED",
      created_at: now,
    });

    try {
      const snapshotResponse = await (supabase as any).rpc("get_order_operational_snapshot" as any, {
        p_order_id: orderId,
      });
      if (snapshotResponse.error) throw snapshotResponse.error;

      const snapshotRows = Array.isArray(snapshotResponse.data) ? snapshotResponse.data : [];
      const detailRows = mergedItems.flatMap((item) => {
        const snapshot = snapshotRows.find((row: any) => String(row.order_item_id) === item.order_item_id);
        if (!snapshot) return [];

        const unitPrice = Number(snapshot.unit_price ?? 0);
        let remainingQty = item.quantity_cancelled;
        const pendingQty = Math.min(remainingQty, Math.max(0, Number(snapshot.quantity_pending_prepare ?? 0)));
        remainingQty = Math.max(0, remainingQty - pendingQty);
        const readyQty = Math.min(remainingQty, Math.max(0, Number(snapshot.quantity_ready_available ?? 0)));
        remainingQty = Math.max(0, remainingQty - readyQty);
        const dispatchedAvailable = Math.max(
          0,
          Number(snapshot.quantity_dispatched_total ?? snapshot.quantity_dispatched ?? 0)
            - Number(snapshot.quantity_cancelled_dispatched ?? 0),
        );
        const dispatchedQty = Math.min(remainingQty, dispatchedAvailable);

        const rows = [];
        if (pendingQty > 0) {
          rows.push({
            id: generateUUID(),
            order_cancellation_id: draftId,
            order_id: orderId,
            order_item_id: item.order_item_id,
            quantity_cancelled: pendingQty,
            unit_price: unitPrice,
            total_amount: Math.round(pendingQty * unitPrice * 100) / 100,
            source_stage: "PENDING",
            created_at: now,
          });
        }
        if (readyQty > 0) {
          rows.push({
            id: generateUUID(),
            order_cancellation_id: draftId,
            order_id: orderId,
            order_item_id: item.order_item_id,
            quantity_cancelled: readyQty,
            unit_price: unitPrice,
            total_amount: Math.round(readyQty * unitPrice * 100) / 100,
            source_stage: "READY",
            created_at: now,
          });
        }
        if (dispatchedQty > 0) {
          rows.push({
            id: generateUUID(),
            order_cancellation_id: draftId,
            order_id: orderId,
            order_item_id: item.order_item_id,
            quantity_cancelled: dispatchedQty,
            unit_price: unitPrice,
            total_amount: Math.round(dispatchedQty * unitPrice * 100) / 100,
            source_stage: "DISPATCHED",
            created_at: now,
          });
        }

        return rows;
      });

      if (detailRows.length > 0) {
        for (const row of detailRows) {
          await dbInsert("order_item_cancellations", row);
        }
      }
    } catch (detailPersistenceError) {
      if (
        isRlsPolicyError(detailPersistenceError) ||
        isMissingRelationError(detailPersistenceError, "order_item_cancellations")
      ) {
        console.warn("No se pudo guardar detalle operativo de la solicitud; se reconstruira desde notes al autorizar.", detailPersistenceError);
        return;
      }

      throw detailPersistenceError;
    }
  };

  const requestOrderCancellationFallback = async (orderId: string, userId: string) => {
    const now = new Date().toISOString();

    await dbUpdate("orders", orderId, {
      cancel_requested_by: userId,
      cancel_requested_at: now,
    });
  };

  const ensureOrderCancellationRequested = async (orderId: string, userId: string) => {
    const response = await supabase.rpc("request_order_cancellation" as any, {
      p_order_id: orderId,
      p_user_id: userId,
    });

    if (!response.error) return;

    if (!isMissingRpcFunctionError(response.error, "request_order_cancellation")) {
      throw response.error;
    }

    await requestOrderCancellationFallback(orderId, userId);
  };

  const ensurePendingCancellationPersisted = async (orderId: string) => {
    const attempts = 3;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const [orderResult, pendingRows] = await Promise.all([
        dbSelect<any>("orders", {
          select: "id, cancel_requested_at",
          filters: [{ column: "id", op: "eq", value: orderId }]
        }),
        dbSelect<any>("order_cancellations", {
          select: "id",
          filters: [
            { column: "order_id", op: "eq", value: orderId },
            { column: "status", op: "eq", value: "VOIDED" },
            { column: "notes", op: "ilike" as any, value: "[PENDING_REQUEST]%" }
          ]
        }),
      ]);

      const orderRow = Array.isArray(orderResult) ? orderResult[0] : orderResult;
      const hasOrderFlag = Boolean(orderRow?.cancel_requested_at);
      const hasPendingHeader = Array.isArray(pendingRows) && pendingRows.length > 0;
      if (hasOrderFlag || hasPendingHeader) return;

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    throw new Error("La solicitud no se guardo en la base de datos. Verifica permisos o la RPC remota.");
  };

  const buildPendingSelectionsFromNotes = async (orderId: string, notes: string | null) => {
    const requestedItems = parsePendingRequestItemsFromNotes(notes);
    if (requestedItems.length === 0) return [];

    const snapshotResponse = await (supabase as any).rpc("get_order_operational_snapshot" as any, {
      p_order_id: orderId,
    });
    if (snapshotResponse.error) throw snapshotResponse.error;

    const snapshotRows = Array.isArray(snapshotResponse.data) ? snapshotResponse.data : [];
    return buildSelectionsFromOperationalSnapshot(snapshotRows, requestedItems);
  };

  const cancelItemMutation = useMutation({
    mutationFn: async (params: CancelItemParams) => {
      const { itemId, orderId, currentStatus, quantity, unitPrice, userId, cancellationData } = params;
      const reason = cancellationData?.reason || "Sin especificar";

      const createAuthorizationRequest = async () => {
        let requestStoredWithoutDraft = false;

        const { error } = await supabase.rpc("create_pending_order_cancellation_request" as any, {
          p_order_id: orderId,
          p_user_id: userId,
          p_reason: reason,
          p_notes: cancellationData?.notes ?? null,
          p_items: [{ order_item_id: itemId, quantity_cancelled: quantity }],
          p_cancellation_type: "partial",
        });

        if (error) {
          console.error("Error al registrar solicitud de anulacion por item (RPC principal):", error);

          if (isMissingRpcFunctionError(error, "create_pending_order_cancellation_request")) {
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

            try {
              await createPendingCancellationDraftDirect(
                orderId,
                userId,
                reason,
                cancellationData?.notes ?? null,
                [{
                  order_item_id: itemId,
                  quantity_cancelled: quantity,
                  status: currentStatus,
                  description_snapshot: "",
                  unit_price: unitPrice,
                }],
                "partial",
              );
            } catch (draftError) {
              if (
                !isRlsPolicyError(draftError) &&
                !isMissingRelationError(draftError, "order_cancellations") &&
                !isMissingRelationError(draftError, "order_item_cancellations")
              ) {
                throw draftError;
              }

              requestStoredWithoutDraft = true;
              console.warn("No se pudo guardar borrador detallado para item (RLS?), se conserva solicitud basica.", draftError);
            }
          } else {
            throw error;
          }
        }

        await ensureOrderCancellationRequested(orderId, userId);
        await ensurePendingCancellationPersisted(orderId);

        return {
          itemId,
          orderId,
          isRequest: true,
          selections: [{ order_item_id: itemId, quantity_cancelled: quantity }],
          cancellationType: "partial" as const,
          requestStoredWithoutDraft,
        };
      };

      try {
        const { error } = await supabase.rpc("cancel_order_quantities" as any, {
          p_order_id: orderId,
          p_cancelled_by: userId,
          p_reason: reason,
          p_notes: cancellationData?.notes ?? null,
          p_items: [{ order_item_id: itemId, quantity_cancelled: quantity }],
          p_cancellation_type: "partial",
        });

        if (error) throw error;
      } catch (error) {
        if (!isAuthorizationRequiredError(error)) {
          throw error;
        }

        return createAuthorizationRequest();
      }

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
        const requestedAt = new Date().toISOString();
        toast.success("Solicitud de anulación enviada");
        qc.setQueryData(["order", data.orderId], (current: any) => {
          if (!current) return current;
          return { ...current, cancel_requested_at: requestedAt };
        });
        syncPendingRequestIntoOrderListCaches(qc, data.orderId, requestedAt);
      } else {
        qc.setQueryData(["order", data.orderId], (current: any) =>
          applyCancellationToOrderCache(current, data.selections, data.cancellationType)
        );
        toast.success("Item cancelado");
      }
      if (data.isRequest) {
        invalidateOperationalOrderQueries(qc, {
          branchId: activeBranchId,
          orderId: data.orderId,
          includeCompletedPayments: false,
          includeTables: true,
        });
      } else {
        invalidateOperationalOrderQueries(qc, {
          branchId: activeBranchId,
          orderId: data.orderId,
          includeCompletedPayments: false,
          includeTables: true,
        });
        await qc.refetchQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key) && isOrderListQueryForBranch(key, activeBranchId);
          },
        });
      }
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
        let requestStoredWithoutDraft = false;

        const { error } = await supabase.rpc("create_pending_order_cancellation_request" as any, {
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
          console.error("Error al registrar solicitud de anulacion (RPC principal):", error);
          
          // Solo caemos en fallback si la funcion NO existe realmente
          if (isMissingRpcFunctionError(error, "create_pending_order_cancellation_request")) {
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

            try {
              await createPendingCancellationDraftDirect(
                orderId,
                userId,
                reason,
                cancellationData?.notes ?? null,
                items,
                cancellationType,
              );
            } catch (draftError) {
              if (
                !isRlsPolicyError(draftError) &&
                !isMissingRelationError(draftError, "order_cancellations") &&
                !isMissingRelationError(draftError, "order_item_cancellations")
              ) {
                throw draftError;
              }

              requestStoredWithoutDraft = true;
              console.warn("No se pudo guardar borrador detallado (RLS?), se conserva solicitud basica.", draftError);
            }
          } else {
            // Si la funcion EXISTE pero lanzo error (ej. RLS, validacion), lo lanzamos hacia arriba
            throw error;
          }
        }

        await ensureOrderCancellationRequested(orderId, userId);
        await ensurePendingCancellationPersisted(orderId);

        return {
          orderId,
          isRequest: true,
          cancellationId: null,
          selections: (cancellationType === "total" ? items : selectedItems).map(item => ({
            order_item_id: item.order_item_id,
            quantity_cancelled: item.quantity_cancelled,
          })),
          cancellationType,
          requestStoredWithoutDraft,
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
        const response = await supabase.rpc("cancel_order_quantities" as any, {
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
        const requestedAt = new Date().toISOString();
        toast.success("Solicitud de anulación enviada");
        qc.setQueryData(["order", data.orderId], (current: any) => {
          if (!current) return current;
          return { ...current, cancel_requested_at: requestedAt };
        });
        syncPendingRequestIntoOrderListCaches(qc, data.orderId, requestedAt);
      } else {
        qc.setQueryData(["order", data.orderId], (current: any) =>
          applyCancellationToOrderCache(current, data.selections, data.cancellationType)
        );
        toast.success("Cancelacion aplicada");
      }
      if (data.isRequest) {
        invalidateOperationalOrderQueries(qc, {
          branchId: activeBranchId,
          orderId: data.orderId,
          includeCompletedPayments: true,
          includeTables: true,
        });
      } else {
        invalidateOperationalOrderQueries(qc, {
          branchId: activeBranchId,
          orderId: data.orderId,
          includeCompletedPayments: true,
          includeTables: true,
        });
        await qc.refetchQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key) && isOrderListQueryForBranch(key, activeBranchId);
          },
        });
      }
    },
    onError: (error: any) => {
      console.error("Error cancelando orden:", error);
      toast.error("Error al cancelar orden: " + (error?.message || "Error desconocido"));
    },
  });

  const rejectCancellationRequestMutation = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase.rpc("clear_pending_order_cancellation_request" as any, {
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
      qc.invalidateQueries({ queryKey: qk.order(orderId) });
      invalidateOperationalOrderQueries(qc, {
        branchId: activeBranchId,
        orderId,
        includeCompletedPayments: false,
        includeTables: true,
      });
      await qc.refetchQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && isOrderListQueryForBranch(key, activeBranchId);
        },
      });
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
        const snapshotResponse = await (supabase as any).rpc("get_order_operational_snapshot", {
          p_order_id: orderId,
        });
        if (snapshotResponse.error) throw snapshotResponse.error;

        const fallbackSelections: CancelOrderItemSelection[] = (Array.isArray(snapshotResponse.data) ? snapshotResponse.data : [])
          .map((row: any) => {
            const quantityPending = Math.max(0, Number(row.quantity_pending_prepare ?? 0));
            const quantityReady = Math.max(0, Number(row.quantity_ready_available ?? 0));
            const quantityDispatched = Math.max(
              0,
              Number(row.quantity_dispatched_total ?? row.quantity_dispatched ?? 0)
                - Number(row.quantity_cancelled_dispatched ?? 0),
            );
            const quantityCancelled = quantityPending + quantityReady + quantityDispatched;

            return {
              order_item_id: String(row.order_item_id),
              quantity_cancelled: quantityCancelled,
              quantity_cancelled_pending: quantityPending,
              quantity_cancelled_ready: quantityReady,
              quantity_cancelled_dispatched: quantityDispatched,
              unit_price: Number(row.unit_price ?? 0),
              description_snapshot: String(row.description_snapshot ?? "Item"),
              status: "PENDING_CANCELLATION",
            } satisfies CancelOrderItemSelection;
          })
          .filter((item) => item.quantity_cancelled > 0);

        if (fallbackSelections.length === 0) {
          throw new Error("No se encontro una solicitud pendiente para esta orden");
        }

        const { data, error } = await supabase.rpc("cancel_order_quantities" as any, {
          p_order_id: orderId,
          p_cancelled_by: userId,
          p_reason: "Solicitud pendiente aprobada",
          p_notes: "[LEGACY_PENDING_REQUEST]",
          p_items: fallbackSelections.map((item) => ({
            order_item_id: item.order_item_id,
            quantity_cancelled: item.quantity_cancelled,
          })),
          p_cancellation_type: "total",
        });
        if (error) throw error;

        const { error: clearPendingError } = await supabase.rpc("clear_pending_order_cancellation_request" as any, {
          p_order_id: orderId,
        });
        if (clearPendingError) throw clearPendingError;

        return {
          orderId,
          cancellationId: data as string | null,
          selections: fallbackSelections.map((item) => ({
            order_item_id: item.order_item_id,
            quantity_cancelled: item.quantity_cancelled,
            quantity_cancelled_pending: item.quantity_cancelled_pending,
            quantity_cancelled_ready: item.quantity_cancelled_ready,
            quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
          })),
          cancellationType: "total" as const,
        };
      }

      const draftIds = drafts.map((draft) => draft.id);
      const { data: draftItems, error: draftItemsError } = await supabase
        .from("order_item_cancellations")
        .select("order_cancellation_id, order_item_id, quantity_cancelled, source_stage, unit_price")
        .in("order_cancellation_id", draftIds);
      if (draftItemsError && !isMissingRelationError(draftItemsError, "order_item_cancellations")) {
        throw draftItemsError;
      }

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
      let selectedItems: CancelOrderItemSelection[] = [];

      if (selectedDraftItems.length === 0) {
        selectedItems = await buildPendingSelectionsFromNotes(orderId, draft.notes ?? null);
        if (selectedItems.length === 0) {
          throw new Error("La solicitud pendiente no tiene detalle operativo para autorizar");
        }
      } else {
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

        selectedItems = Array.from(aggregatedByItem.entries()).map(([orderItemId, row]) => ({
          order_item_id: orderItemId,
          quantity_cancelled: row.quantity_cancelled,
          quantity_cancelled_pending: row.quantity_cancelled_pending,
          quantity_cancelled_ready: row.quantity_cancelled_ready,
          quantity_cancelled_dispatched: row.quantity_cancelled_dispatched,
          unit_price: row.unit_price,
          description_snapshot: itemDescriptionMap[orderItemId] ?? "Item",
          status: "PENDING_CANCELLATION",
        }));
      }

      const { data, error } = await supabase.rpc("cancel_order_quantities" as any, {
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

      const { error: clearPendingError } = await supabase.rpc("clear_pending_order_cancellation_request" as any, {
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
      invalidateOperationalOrderQueries(qc, {
        branchId: activeBranchId,
        orderId: data.orderId,
        includeCompletedPayments: true,
        includeTables: true,
      });
      await qc.refetchQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && isOrderListQueryForBranch(key, activeBranchId);
        },
      });
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

function buildPendingOrderSummaryFromOrderCache(currentOrder: any, requestedAt: string) {
  if (!currentOrder?.id) return null;

  const items = Array.isArray(currentOrder.items)
    ? currentOrder.items.map((item: any) => ({
        id: item.id,
        product_id: item.product_id ?? undefined,
        description_snapshot: item.description_snapshot,
        quantity: Number(item.quantity ?? 0),
        quantity_total: Number(item.quantity_ordered ?? item.original_quantity ?? item.quantity ?? 0),
        quantity_requested: Number(item.quantity ?? 0),
        quantity_dispatched: Number(item.quantity_dispatched ?? 0),
        quantity_remaining: Number(item.quantity_remaining ?? 0),
        total: Number(item.total ?? 0),
        status: "PENDING_CANCELLATION",
        tray_item_type: item.tray_item_type ?? null,
        modifiers: Array.isArray(item.modifiers)
          ? item.modifiers.map((modifier: any) => ({ description: String(modifier.description ?? "").trim() }))
          : [],
        item_note: item.item_note ?? null,
      }))
    : [];

  return {
    id: currentOrder.id,
    order_number: Number(currentOrder.order_number ?? 0),
    order_code: currentOrder.order_code ?? null,
    split_code: currentOrder.split_code ?? null,
    status: "PENDING_CANCELLATION",
    order_type: currentOrder.order_type ?? "DINE_IN",
    is_special: Boolean(currentOrder.is_special),
    special_total_manual: currentOrder.special_total_manual ?? null,
    table_id: currentOrder.table_id ?? null,
    table_name: currentOrder.table_name ?? null,
    created_by: currentOrder.created_by ?? null,
    created_by_name: currentOrder.created_by_name ?? null,
    created_at: currentOrder.created_at,
    sent_to_kitchen_at: currentOrder.sent_to_kitchen_at ?? null,
    ready_at: currentOrder.ready_at ?? null,
    dispatched_at: currentOrder.dispatched_at ?? null,
    paid_at: currentOrder.paid_at ?? null,
    cancelled_at: currentOrder.cancelled_at ?? null,
    cancel_requested_at: requestedAt,
    total: items.reduce((sum: number, item: any) => sum + Number(item.total ?? 0), 0),
    item_count: items.length,
    items,
  };
}

function markOrderPendingRequestInListCaches(qc: ReturnType<typeof useQueryClient>, orderId: string, requestedAt: string) {
  const currentOrder = qc.getQueryData(["order", orderId]) as any;
  const pendingSummary = buildPendingOrderSummaryFromOrderCache(currentOrder, requestedAt);

  qc.setQueriesData({ queryKey: ["orders"] }, (current: any) => {
    if (!Array.isArray(current)) return current;

    const next = current.map((order: any) =>
      order?.id === orderId
        ? {
            ...order,
            // Mantenemos el estado original para que no desaparezca de la pestaña actual (Despachadas, etc.)
            // Pero actualizamos la fecha de solicitud para disparar la logica de "Pendiente" en items
            cancel_requested_at: requestedAt,
            // El status global solo se pone en PENDING_CANCELLATION si la vista lo requiere (calculado en el hook listador)
          }
        : order,
    );

    const exists = next.some((order: any) => order?.id === orderId);
    return exists || !pendingSummary ? next : [pendingSummary, ...next];
  });
}

function syncPendingRequestIntoOrderListCaches(qc: ReturnType<typeof useQueryClient>, orderId: string, requestedAt: string) {
  const currentOrder = qc.getQueryData(["order", orderId]) as any;
  const pendingSummary = buildPendingOrderSummaryFromOrderCache(currentOrder, requestedAt);
  const queryEntries = qc.getQueriesData({ queryKey: ["orders"] });

  for (const [queryKey, current] of queryEntries) {
    if (!Array.isArray(current) || !Array.isArray(queryKey)) continue;

    const viewStatus = queryKey[2];
    const next = current.map((order: any) =>
      order?.id === orderId
        ? {
            ...order,
            cancel_requested_at: requestedAt,
          }
        : order,
    );

    const exists = next.some((order: any) => order?.id === orderId);
    if (viewStatus === "PENDING_CANCELLATION") {
      qc.setQueryData(queryKey, exists || !pendingSummary ? next : [pendingSummary, ...next]);
      continue;
    }

    qc.setQueryData(queryKey, next);
  }
}

export type { CancelOrderItemSelection, CancelOrderParams };
