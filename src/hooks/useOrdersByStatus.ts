import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";
import { computeLineAmount } from "@/lib/paymentQuantity";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";

type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED" | "PENDING_CANCELLATION";

export interface OrderItemSummary {
  id: string;
  description_snapshot: string;
  quantity: number;
  quantity_total?: number;
  quantity_requested?: number;
  quantity_dispatched?: number;
  quantity_remaining?: number;
  total: number;
  status: string;
  modifiers: { description: string }[];
  item_note?: string | null;
}

function parsePaymentNotes(notes: string | null) {
  const segments = String(notes ?? "")
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let reversed = false;
  let voided = false;

  for (const segment of segments) {
    if (segment.startsWith("REVERSED:")) reversed = true;
    if (segment.startsWith("VOIDED:")) voided = true;
  }

  return { reversed, voided };
}

function parsePendingRequestItemsFromNotes(notes: string | null): Record<string, number> {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("[PENDING_REQUEST]")) return {};

  const jsonPart = raw.replace(/^\[PENDING_REQUEST\]\s*/, "").trim();
  if (!jsonPart) return {};

  try {
    const parsed = JSON.parse(jsonPart) as { items?: Array<{ order_item_id?: string; quantity_cancelled?: number }> };
    const map: Record<string, number> = {};
    for (const item of parsed.items ?? []) {
      const itemId = String(item?.order_item_id ?? "").trim();
      const qty = Math.max(0, Math.floor(Number(item?.quantity_cancelled ?? 0)));
      if (!itemId || qty <= 0) continue;
      map[itemId] = (map[itemId] ?? 0) + qty;
    }
    return map;
  } catch {
    return {};
  }
}

export interface OrderSummary {
  id: string;
  order_number: number;
  order_code: string | null;
  split_code?: string | null;
  status: OrderStatus;
  order_type: string;
  table_id: string | null;
  table_name: string | null;
  created_at: string;
  sent_to_kitchen_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  cancel_requested_at?: string | null;
  total: number;
  item_count: number;
  items: OrderItemSummary[];
}

export function useOrdersByStatus(status: OrderStatus | null = null) {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["orders", activeBranchId, status],
    queryFn: async (): Promise<OrderSummary[]> => {
      if (!activeBranchId) return [];

      const cancelledView = status === "CANCELLED";
      const sentView = status === "SENT_TO_KITCHEN";
      const readyView = status === "READY";
      const dispatchedView = status === "KITCHEN_DISPATCHED";
      const paidView = status === "PAID";
      const pendingCancellationView = status === "PENDING_CANCELLATION";

      const filters: any[] = (() => {
        if (!status || cancelledView || pendingCancellationView) return [];
        if (readyView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }];
        if (dispatchedView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"] }];
        if (sentView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }];
        if (paidView) return [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED", "PAID"] }];
        return [{ column: "status", op: "eq", value: status }];
      })();

      let orders = await dbSelect<{
        id: string;
        order_number: number;
        order_code: string | null;
        status: OrderStatus;
        order_type: string;
        table_id: string | null;
        created_at: string;
        sent_to_kitchen_at: string | null;
        ready_at: string | null;
        dispatched_at: string | null;
        paid_at: string | null;
        cancelled_at: string | null;
        cancel_requested_at: string | null;
        total: number;
      }>("orders", {
        select: "id, order_number, order_code, status, order_type, table_id, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, cancel_requested_at, total",
        branchId: activeBranchId,
        filters,
        orderBy: { column: "created_at", ascending: false },
      });

      let cancelledOrdersMeta: Record<string, { cancelled_at: string | null }> = {};
      let pendingCancellationItemsByOrder: Record<string, Record<string, number>> = {};
      let pendingCancellationOrderIds = new Set<string>();

      if (cancelledView) {
        const { data: cancellationHeaders, error: cancellationHeadersError } = await supabase
          .from("order_cancellations")
          .select("order_id, status, created_at")
          .eq("status", "APPLIED");

        if (cancellationHeadersError) throw cancellationHeadersError;

        const cancelledOrderIds = new Set<string>();
        for (const header of cancellationHeaders ?? []) {
          const orderId = (header as any).order_id as string | null;
          if (!orderId) continue;
          cancelledOrderIds.add(orderId);
          const createdAt = (header as any).created_at ?? null;
          const current = cancelledOrdersMeta[orderId]?.cancelled_at;
          if (!current || (createdAt && createdAt > current)) {
            cancelledOrdersMeta[orderId] = { cancelled_at: createdAt };
          }
        }

        orders = orders.filter(
          (order) =>
            order.status === "CANCELLED" ||
            cancelledOrderIds.has(order.id) ||
            (order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED")
        );
      }

      if (pendingCancellationView) {
        const eligibleOrderIds = orders
          .filter((order) => order.status !== "CANCELLED" && order.status !== "PAID" && !!order.cancel_requested_at)
          .map((order) => order.id);

        if (eligibleOrderIds.length > 0) {
          const { data: pendingHeaders, error: pendingHeadersError } = await supabase
            .from("order_cancellations")
            .select("id, order_id, status, notes, created_at")
            .in("order_id", eligibleOrderIds)
            .eq("status", "VOIDED")
            .ilike("notes", "[PENDING_REQUEST]%")
            .order("created_at", { ascending: false });
          if (pendingHeadersError) throw pendingHeadersError;

          const allPendingHeaderIds = (pendingHeaders ?? []).map((header) => header.id);
          if (allPendingHeaderIds.length > 0) {
            const { data: pendingItems, error: pendingItemsError } = await supabase
              .from("order_item_cancellations")
              .select("order_cancellation_id, order_id, order_item_id, quantity_cancelled")
              .in("order_cancellation_id", allPendingHeaderIds);
            if (pendingItemsError) throw pendingItemsError;

            const pendingItemsByHeaderId: Record<string, typeof pendingItems> = {};
            for (const row of pendingItems ?? []) {
              if (!pendingItemsByHeaderId[row.order_cancellation_id]) {
                pendingItemsByHeaderId[row.order_cancellation_id] = [];
              }
              pendingItemsByHeaderId[row.order_cancellation_id]!.push(row);
            }

            const latestPendingHeaderByOrder: Record<string, string> = {};
            const pendingHeaderById = Object.fromEntries((pendingHeaders ?? []).map((header) => [header.id, header]));
            for (const header of pendingHeaders ?? []) {
              const headerRows = pendingItemsByHeaderId[header.id] ?? [];
              const fallbackMap = headerRows.length === 0 ? parsePendingRequestItemsFromNotes(header.notes) : {};
              const hasFallbackItems = Object.keys(fallbackMap).length > 0;
              if (headerRows.length === 0 && !hasFallbackItems) continue;
              if (!latestPendingHeaderByOrder[header.order_id]) {
                latestPendingHeaderByOrder[header.order_id] = header.id;
              }
            }

            for (const [orderId, headerId] of Object.entries(latestPendingHeaderByOrder)) {
              pendingCancellationOrderIds.add(orderId);
              const orderMap: Record<string, number> = {};
              const headerRows = pendingItemsByHeaderId[headerId] ?? [];
              if (headerRows.length > 0) {
                for (const row of headerRows) {
                  orderMap[row.order_item_id] = (orderMap[row.order_item_id] ?? 0) + Number(row.quantity_cancelled ?? 0);
                }
              } else {
                Object.assign(orderMap, parsePendingRequestItemsFromNotes(pendingHeaderById[headerId]?.notes ?? null));
              }
              pendingCancellationItemsByOrder[orderId] = orderMap;
            }
          }
        }

        orders = orders.filter(
          (order) =>
            order.status !== "CANCELLED" &&
            order.status !== "PAID" &&
            !!order.cancel_requested_at &&
            pendingCancellationOrderIds.has(order.id),
        );
      } else {
        orders = orders.filter((order) => !order.cancel_requested_at);
      }

      const orderIds = orders.map((order) => order.id);
      if (orderIds.length === 0) return [];

      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        item_note?: string | null;
        quantity: number;
        unit_price?: number;
        total: number;
        status: string;
        paid_at?: string | null;
      }>("order_items", {
        select: "id, order_id, description_snapshot, item_note, quantity, unit_price, total, status, paid_at",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      const {
        readyMap,
        readyAvailableMap,
        pendingPrepareMap,
        dispatchedTotalMap,
        paidMap,
        cancelledPendingMap,
        cancelledReadyMap,
        cancelledDispatchedMap,
        cancelledTotalMap,
      } = await fetchOperationalMapsForOrders(orderIds);
      const itemIds = items.map((item) => item.id);
      const paidQuantityByItem: Record<string, number> = {};

      if (itemIds.length > 0) {
        const { data: paymentItems, error: paymentItemsError } = await supabase
          .from("payment_items")
          .select("payment_id, order_item_id, quantity_paid")
          .in("order_item_id", itemIds);
        if (paymentItemsError) throw paymentItemsError;

        const paymentIds = [...new Set((paymentItems ?? []).map((row) => row.payment_id).filter(Boolean))];
        let blockedPaymentIds = new Set<string>();

        if (paymentIds.length > 0) {
          const { data: payments, error: paymentsError } = await supabase
            .from("payments")
            .select("id, notes")
            .in("id", paymentIds);
          if (paymentsError) throw paymentsError;

          blockedPaymentIds = new Set(
            (payments ?? [])
              .filter((payment) => {
                const meta = parsePaymentNotes(payment.notes);
                return meta.reversed || meta.voided;
              })
              .map((payment) => payment.id),
          );
        }

        for (const row of paymentItems ?? []) {
          if (blockedPaymentIds.has(row.payment_id)) continue;
          paidQuantityByItem[row.order_item_id] = (paidQuantityByItem[row.order_item_id] ?? 0) + Number(row.quantity_paid ?? 0);
        }
      }

      const modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods, error: modsError } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
        if (modsError) throw modsError;

        for (const modifier of mods ?? []) {
          const rawDescription = Array.isArray((modifier as any).modifiers)
            ? (modifier as any).modifiers[0]?.description
            : (modifier as any).modifiers?.description;
          const description = String(rawDescription ?? "").trim();
          if (!description) continue;
          if (!modsMap[modifier.order_item_id]) modsMap[modifier.order_item_id] = [];
          modsMap[modifier.order_item_id].push({ description });
        }
      }

      const tableIds = [...new Set(orders.map((order) => order.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        if (tables) {
          tablesMap = Object.fromEntries(tables.map((table: { id: string; name: string }) => [table.id, table.name]));
        }
      }

      return orders
        .map((order) => {
          const related = items
            .filter((item) => item.order_id === order.id)
            .map((item) => {
              const quantities = computeOperationalQuantities({
                quantityOrdered: Number(item.quantity ?? 0),
                quantityReadyTotal: readyMap[item.id] ?? 0,
                quantityDispatchedTotal: dispatchedTotalMap[item.id] ?? 0,
                quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
                quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
                quantityCancelledDispatched: cancelledDispatchedMap[item.id] ?? 0,
              });

              const activeQuantity = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
              const cancelledQuantity = Math.min(quantities.quantityOrdered, cancelledTotalMap[item.id] ?? quantities.quantityCancelledTotal);
              const dispatchedQuantity = Math.max(
                0,
                (dispatchedTotalMap[item.id] ?? quantities.quantityDispatchedTotal) - (cancelledDispatchedMap[item.id] ?? 0),
              );
              const readyQuantity = readyAvailableMap[item.id] ?? quantities.quantityReadyAvailable;
              const pendingQuantity = pendingPrepareMap[item.id] ?? quantities.quantityPendingPrepare;
              const effectivePaidQuantity = Math.max(
                0,
                paidQuantityByItem[item.id] ??
                  paidMap[item.id] ??
                  (item.paid_at ? activeQuantity : 0),
              );
              const payableBaseQuantity =
                order.order_type === "TAKEOUT"
                  ? activeQuantity
                  : Math.max(0, readyQuantity + dispatchedQuantity + pendingQuantity);
              const paidDisplayQuantity = Math.max(0, Math.min(payableBaseQuantity, effectivePaidQuantity));
              const unpaidDispatchedQuantity = Math.max(0, dispatchedQuantity - effectivePaidQuantity);
              const paidAfterDispatched = Math.max(0, effectivePaidQuantity - dispatchedQuantity);
              const unpaidReadyQuantity = Math.max(0, readyQuantity - paidAfterDispatched);
              const paidAfterReady = Math.max(0, paidAfterDispatched - readyQuantity);
              const unpaidPendingQuantity = Math.max(0, pendingQuantity - paidAfterReady);
              const unpaidActiveQuantity = Math.max(0, activeQuantity - effectivePaidQuantity);

              const isTakeoutDispatchedOnCancelledTab =
                cancelledView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED";

              const pendingRequestedItems = pendingCancellationView
                ? pendingCancellationItemsByOrder[order.id] ?? null
                : null;
              const pendingRequestedQuantity = pendingCancellationView
                ? pendingRequestedItems?.[item.id] ?? 0
                : 0;

              const displayQuantity = cancelledView
                ? isTakeoutDispatchedOnCancelledTab
                  ? unpaidDispatchedQuantity
                  : cancelledQuantity
                : pendingCancellationView
                  ? Math.max(0, pendingRequestedQuantity)
                : paidView
                  ? paidDisplayQuantity
                : readyView
                  ? unpaidReadyQuantity
                : dispatchedView
                    ? unpaidDispatchedQuantity
                  : sentView
                      ? unpaidPendingQuantity
                      : unpaidActiveQuantity;

              const effectiveStatus = cancelledView
                ? isTakeoutDispatchedOnCancelledTab
                  ? "DISPATCHED"
                  : "CANCELLED"
                : pendingCancellationView
                  ? "PENDING_CANCELLATION"
                : paidView
                  ? "PAID"
                : readyView
                  ? "READY"
                : dispatchedView
                    ? "DISPATCHED"
                    : sentView
                      ? "SENT"
                      : activeQuantity <= 0
                        ? "CANCELLED"
                        : item.status;

              return {
                ...item,
                activeQuantity,
                quantity: displayQuantity,
                total: computeLineAmount(displayQuantity, Number(item.unit_price ?? 0)),
                status: effectiveStatus,
              };
            })
            .filter((item) => item.status !== "DRAFT" && item.quantity > 0);

          const fallbackStageItems = items
            .filter((item) => item.order_id === order.id)
            .map((item) => {
              const quantities = computeOperationalQuantities({
                quantityOrdered: Number(item.quantity ?? 0),
                quantityReadyTotal: readyMap[item.id] ?? 0,
                quantityDispatchedTotal: dispatchedTotalMap[item.id] ?? 0,
                quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
                quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
                quantityCancelledDispatched: cancelledDispatchedMap[item.id] ?? 0,
              });

              const activeQuantity = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
              const dispatchedQuantity = Math.max(
                0,
                (dispatchedTotalMap[item.id] ?? quantities.quantityDispatchedTotal) - (cancelledDispatchedMap[item.id] ?? 0),
              );
              const readyQuantity = readyAvailableMap[item.id] ?? quantities.quantityReadyAvailable;
              const pendingQuantity = pendingPrepareMap[item.id] ?? quantities.quantityPendingPrepare;
              const effectivePaidQuantity = Math.max(0, paidMap[item.id] ?? 0);
              const unpaidDispatchedQuantity = Math.max(0, dispatchedQuantity - effectivePaidQuantity);
              const paidAfterDispatched = Math.max(0, effectivePaidQuantity - dispatchedQuantity);
              const unpaidReadyQuantity = Math.max(0, readyQuantity - paidAfterDispatched);
              const paidAfterReady = Math.max(0, paidAfterDispatched - readyQuantity);
              const unpaidPendingQuantity = Math.max(0, pendingQuantity - paidAfterReady);
              const unpaidActiveQuantity = Math.max(0, activeQuantity - effectivePaidQuantity);
              const fallbackQuantity = dispatchedView
                ? unpaidDispatchedQuantity
                : readyView
                  ? unpaidReadyQuantity
                  : sentView
                    ? unpaidPendingQuantity
                    : unpaidActiveQuantity;

              if (fallbackQuantity <= 0) return null;

              const fallbackStatus = dispatchedView
                ? "DISPATCHED"
                : readyView
                  ? "READY"
                  : sentView
                    ? "SENT"
                    : item.status ?? "SENT";

              return {
                ...item,
                activeQuantity: unpaidActiveQuantity,
                quantity: fallbackQuantity,
                total: computeLineAmount(fallbackQuantity, Number(item.unit_price ?? 0)),
                status: fallbackStatus,
              };
            })
            .filter((item): item is NonNullable<typeof item> => !!item && item.status !== "DRAFT" && item.quantity > 0);

          const shouldUseOrderStageFallback =
            !cancelledView &&
            !paidView &&
            related.length === 0 &&
            fallbackStageItems.length > 0 &&
            (
              (sentView && order.status === "SENT_TO_KITCHEN" && !!order.sent_to_kitchen_at) ||
              (readyView && order.status === "READY" && !!order.ready_at) ||
              (dispatchedView && order.status === "KITCHEN_DISPATCHED" && !!order.dispatched_at)
            );

          const effectiveItems = shouldUseOrderStageFallback ? fallbackStageItems : related;

          const formattedItems: OrderItemSummary[] = effectiveItems.map((item) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            quantity: item.quantity,
            quantity_total: Number((item as any).activeQuantity ?? item.quantity ?? 0),
            quantity_requested: pendingCancellationView
              ? Math.max(
                  0,
                  (pendingCancellationItemsByOrder[order.id] ?? {})[item.id] ?? item.quantity ?? 0,
                )
              : undefined,
            quantity_dispatched: Math.max(
              0,
              (dispatchedTotalMap[item.id] ?? 0) - (cancelledDispatchedMap[item.id] ?? 0),
            ),
            quantity_remaining: Math.max(
              0,
              (pendingPrepareMap[item.id] ?? 0) + (readyAvailableMap[item.id] ?? 0),
            ),
            total: Number(item.total ?? 0),
            status: item.status,
            modifiers: modsMap[item.id] || [],
            item_note: item.item_note ?? null,
          }));

          const total = effectiveItems.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
          const item_count = pendingCancellationView
            ? formattedItems.length
            : effectiveItems.reduce((count, item) => count + Number(item.quantity ?? 0), 0);

          const isTakeoutDispatchedOnCancelledTab =
            cancelledView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED";

          const effectiveOrderStatus = cancelledView
            ? isTakeoutDispatchedOnCancelledTab
              ? "KITCHEN_DISPATCHED"
              : "CANCELLED"
            : pendingCancellationView
              ? "PENDING_CANCELLATION"
            : readyView
              ? "READY"
              : dispatchedView
                ? "KITCHEN_DISPATCHED"
                : sentView
                  ? "SENT_TO_KITCHEN"
                  : paidView
                    ? "PAID"
                    : order.status;

          return {
            ...order,
            status: effectiveOrderStatus,
            cancelled_at: cancelledView && !isTakeoutDispatchedOnCancelledTab
              ? (order.cancelled_at ?? cancelledOrdersMeta[order.id]?.cancelled_at ?? null)
              : order.cancelled_at,
            cancel_requested_at: order.cancel_requested_at ?? null,
            split_code: null,
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            total,
            item_count,
            items: formattedItems,
          };
        })
        .filter((order) => {
          if (order.items.length === 0) {
            if (pendingCancellationView) {
              return !!order.cancel_requested_at && pendingCancellationOrderIds.has(order.id);
            }
            return false;
          }
          if (pendingCancellationView) {
            const pendingRequestedItems = pendingCancellationItemsByOrder[order.id] ?? null;
            if (!pendingRequestedItems || Object.keys(pendingRequestedItems).length === 0) {
              return !!order.cancel_requested_at && pendingCancellationOrderIds.has(order.id);
            }
          }
          if (dispatchedView && order.order_type === "TAKEOUT" && order.status === "KITCHEN_DISPATCHED") {
            return false;
          }
          return true;
        });
    },
    enabled: !!activeBranchId,
  });
}
