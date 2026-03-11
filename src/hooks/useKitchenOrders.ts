import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { computeOperationalQuantities, sumRowsByItem } from "@/lib/orderOperational";

interface OperationalRow {
  order_item_id: string;
  quantity_ready?: number;
  quantity_dispatched?: number;
  quantity_cancelled?: number;
  source_stage?: string | null;
  order_ready_event_id?: string;
  order_dispatch_event_id?: string;
  order_cancellation_id?: string;
}

export interface KitchenOrderItem {
  id: string;
  description_snapshot: string;
  quantity_ordered: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatched: number;
  quantity_cancelled: number;
  modifiers: { description: string }[];
  item_note?: string | null;
  sent_to_kitchen_at: string | null;
}

export interface KitchenOrder {
  card_id: string;
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  sent_at: string;
  pending_prepare_count: number;
  items: KitchenOrderItem[];
}

export interface ReadyOperationPayload {
  orderId: string;
  operationType: "partial" | "total";
  items: Array<{ order_item_id: string; quantity_ready: number }>;
}

function sortBySentAt<T extends { sent_at: string }>(rows: T[]) {
  return [...rows].sort((left, right) => new Date(left.sent_at).getTime() - new Date(right.sent_at).getTime());
}

export function useKitchenOrders() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["kitchen-orders", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const orders = await dbSelect<{
        id: string;
        order_number: number;
        order_code: string | null;
        order_type: string;
        table_id: string | null;
        split_id: string | null;
        updated_at: string;
        sent_to_kitchen_at: string | null;
      }>("orders", {
        select: "id, order_number, order_code, order_type, table_id, split_id, updated_at, sent_to_kitchen_at, status",
        branchId: activeBranchId,
        filters: [{ column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY"] }],
        orderBy: { column: "updated_at", ascending: true },
      });

      if (orders.length === 0) return [];

      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const tables = await dbSelect<{ id: string; name: string }>("restaurant_tables", {
          select: "id, name",
          filters: [{ column: "id", op: "in", value: tableIds }],
        });
        tablesMap = Object.fromEntries(tables.map((t) => [t.id, t.name]));
      }

      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      const orderIds = orders.map((o) => o.id);
      const items = await dbSelect<{
        id: string;
        order_id: string;
        description_snapshot: string;
        quantity: number;
        item_note?: string | null;
        sent_to_kitchen_at: string | null;
      }>("order_items", {
        select: "id, order_id, description_snapshot, quantity, item_note, status, sent_to_kitchen_at",
        filters: [{ column: "order_id", op: "in", value: orderIds }],
      });

      const itemIds = items.map((item) => item.id);
      const modsMap: Record<string, { description: string }[]> = {};
      if (itemIds.length > 0) {
        const { data: mods } = await supabase
          .from("order_item_modifiers")
          .select("order_item_id, modifiers(description)")
          .in("order_item_id", itemIds);
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

      let readyRows: OperationalRow[] = [];
      let dispatchRows: OperationalRow[] = [];
      let cancellationRows: OperationalRow[] = [];

      if (itemIds.length > 0) {
        const [readyResponse, dispatchResponse, cancellationResponse] = await Promise.all([
          (supabase as any)
            .from("order_item_ready_events")
            .select("order_item_id, quantity_ready, order_ready_event_id")
            .in("order_item_id", itemIds),
          (supabase as any)
            .from("order_item_dispatch_events")
            .select("order_item_id, quantity_dispatched, order_dispatch_event_id")
            .in("order_item_id", itemIds),
          (supabase as any)
            .from("order_item_cancellations")
            .select("order_item_id, quantity_cancelled, source_stage, order_cancellation_id")
            .in("order_item_id", itemIds),
        ]);

        const readyEventIds = [...new Set(((readyResponse.data ?? []) as OperationalRow[]).map((row) => row.order_ready_event_id).filter(Boolean))] as string[];
        const dispatchEventIds = [...new Set(((dispatchResponse.data ?? []) as OperationalRow[]).map((row) => row.order_dispatch_event_id).filter(Boolean))] as string[];
        const cancellationIds = [...new Set(((cancellationResponse.data ?? []) as OperationalRow[]).map((row) => row.order_cancellation_id).filter(Boolean))] as string[];

        let activeReadyIds = new Set<string>();
        let activeDispatchIds = new Set<string>();
        let activeCancellationIds = new Set<string>();

        if (readyEventIds.length > 0) {
          const { data } = await (supabase as any)
            .from("order_ready_events")
            .select("id, status")
            .in("id", readyEventIds);
          activeReadyIds = new Set((data ?? []).filter((row: any) => row.status === "APPLIED").map((row: any) => row.id));
        }

        if (dispatchEventIds.length > 0) {
          const { data } = await (supabase as any)
            .from("order_dispatch_events")
            .select("id, status")
            .in("id", dispatchEventIds);
          activeDispatchIds = new Set((data ?? []).filter((row: any) => row.status === "APPLIED").map((row: any) => row.id));
        }

        if (cancellationIds.length > 0) {
          const { data } = await supabase
            .from("order_cancellations")
            .select("id, status")
            .in("id", cancellationIds);
          activeCancellationIds = new Set((data ?? []).filter((row) => row.status === "APPLIED").map((row) => row.id));
        }

        readyRows = (readyResponse.data ?? []).filter((row: OperationalRow) => row.order_ready_event_id && activeReadyIds.has(row.order_ready_event_id));
        dispatchRows = (dispatchResponse.data ?? []).filter((row: OperationalRow) => row.order_dispatch_event_id && activeDispatchIds.has(row.order_dispatch_event_id));
        cancellationRows = (cancellationResponse.data ?? []).filter((row: OperationalRow) => row.order_cancellation_id && activeCancellationIds.has(row.order_cancellation_id));
      }

      const readyMap = sumRowsByItem(readyRows, "order_item_id", "quantity_ready");
      const dispatchedMap = sumRowsByItem(dispatchRows, "order_item_id", "quantity_dispatched");
      const cancelledPendingMap = sumRowsByItem(cancellationRows, "order_item_id", "quantity_cancelled", (row) => String(row.source_stage ?? "PENDING") === "PENDING");
      const cancelledReadyMap = sumRowsByItem(cancellationRows, "order_item_id", "quantity_cancelled", (row) => String(row.source_stage ?? "PENDING") === "READY");

      const cards = orders.flatMap((order) => {
        const mappedItems = items
          .filter((item) => item.order_id === order.id && !!(item.sent_to_kitchen_at ?? order.sent_to_kitchen_at))
          .map((item) => {
            const quantities = computeOperationalQuantities({
              quantityOrdered: Number(item.quantity ?? 0),
              quantityReadyTotal: readyMap[item.id] ?? 0,
              quantityDispatched: dispatchedMap[item.id] ?? 0,
              quantityCancelledPending: cancelledPendingMap[item.id] ?? 0,
              quantityCancelledReady: cancelledReadyMap[item.id] ?? 0,
            });

            return {
              id: item.id,
              description_snapshot: item.description_snapshot,
              quantity_ordered: quantities.quantityOrdered,
              quantity_pending_prepare: quantities.quantityPendingPrepare,
              quantity_ready_available: quantities.quantityReadyAvailable,
              quantity_dispatched: quantities.quantityDispatched,
              quantity_cancelled: quantities.quantityCancelledTotal,
              item_note: item.item_note ?? null,
              modifiers: modsMap[item.id] ?? [],
              sent_to_kitchen_at: item.sent_to_kitchen_at ?? order.sent_to_kitchen_at,
            };
          })
          .filter((item) => item.quantity_ordered - item.quantity_cancelled > 0 && !!item.sent_to_kitchen_at);

        const batches = new Map<string, KitchenOrderItem[]>();
        for (const item of mappedItems) {
          const batchKey = item.sent_to_kitchen_at as string;
          if (!batches.has(batchKey)) batches.set(batchKey, []);
          batches.get(batchKey)!.push(item);
        }

        return Array.from(batches.entries()).map(([sentAt, batchItems]) => {
          const pendingPrepareCount = batchItems.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);

          return {
            card_id: `${order.id}:${sentAt}`,
            id: order.id,
            order_number: order.order_number,
            order_code: order.order_code ?? null,
            order_type: order.order_type as "DINE_IN" | "TAKEOUT",
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
            sent_at: sentAt,
            pending_prepare_count: pendingPrepareCount,
            items: batchItems,
          };
        });
      });

      return sortBySentAt(cards).filter((order) => order.pending_prepare_count > 0) as KitchenOrder[];
    },
    refetchInterval: 10000,
  });

  const applyReadyOperation = useMutation({
    mutationFn: async (payload: ReadyOperationPayload) => {
      if (!user?.id) throw new Error("Usuario no autenticado");

      const { error } = await (supabase as any).rpc("mark_order_quantities_ready", {
        p_order_id: payload.orderId,
        p_ready_by: user.id,
        p_items: payload.items,
        p_operation_type: payload.operationType,
        p_source_module: "kitchen",
        p_notes: null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Operacion de listo aplicada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo aplicar la operacion de listo"),
  });

  return {
    orders: query.data ?? [],
    isLoading: query.isLoading,
    applyReadyOperation,
  };
}
