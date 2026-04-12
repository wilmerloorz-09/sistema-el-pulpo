import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { syncOrderPaymentState } from "@/hooks/useCaja";
import { fetchOrderDetail } from "@/hooks/useOrder";
import type { Database } from "@/integrations/supabase/types";

// include CANCELLED since we'll add it to the enum via migration
type OrderStatus = Database["public"]["Enums"]["order_status"] | "CANCELLED";

export interface TableWithStatus {
  id: string;
  name: string;
  visual_order: number;
  is_active: boolean;
  status: "free" | "occupied" | "to_pay";
  activeOrderId?: string;
  orderStatus?: OrderStatus;
  splitCount: number;
  totalDue: number;
  splitTotals: Array<{
    splitId: string | null;
    splitCode: string | null;
    totalDue: number;
  }>;
  itemCount: number;
  elapsedMinutes: number;
  hasVoidedPayment: boolean;
}

export interface VoidedOrder {
  id: string;
  order_number: number | null;
  order_code: string | null;
  table_id: string | null;
  status: OrderStatus;
  is_special: boolean;
  order_type: "DINE_IN" | "TAKEOUT";
  created_at: string;
  special_total_manual: number | null;
  table_name_snapshot?: string | null;
  total?: number;
}

export interface TablesWithStatusData {
  tables: TableWithStatus[];
  voidedOrders: VoidedOrder[];
}

interface TablesOverviewRow {
  table_id: string;
  table_name: string;
  visual_order: number;
  table_is_active: boolean;
  status: "free" | "occupied" | "to_pay";
  active_order_id: string | null;
  active_order_status: OrderStatus | null;
  split_count: number | null;
  total_due: number | string | null;
  split_totals: unknown;
  item_count: number | null;
  elapsed_minutes: number | null;
}

function parseSplitTotals(rawValue: unknown): TableWithStatus["splitTotals"] {
  if (!Array.isArray(rawValue)) return [];

  return rawValue
    .map((entry) => ({
      splitId: typeof entry?.split_id === "string" ? entry.split_id : null,
      splitCode: typeof entry?.split_code === "string" ? entry.split_code : null,
      totalDue: Number(entry?.total_due ?? 0),
    }))
    .filter((entry) => entry.totalDue > 0);
}

export function getTablesWithStatusQueryKey(branchId: string | null | undefined) {
  return ["tables-with-status", branchId ?? null] as const;
}

export async function fetchTablesWithStatus(branchId: string): Promise<TablesWithStatusData> {
  const { data, error } = await supabase.rpc("get_branch_tables_overview" as never, {
    p_branch_id: branchId,
  } as never);
  if (error) throw error;

  const rows = (data ?? []) as TablesOverviewRow[];
  
  // 1. Fetch ALL voided payments for this branch
  const { data: voidedPayments } = await (supabase
    .from("payments")
    .select("order_id, orders!inner(branch_id)")
    .eq("orders.branch_id", branchId)
    .ilike("notes", "%VOIDED%") as any);
  
  const voidedOrderIds = [...new Set((voidedPayments ?? []).map((p: any) => String(p.order_id)))]
    .filter((id) => id && id !== "undefined" && id !== "null") as string[];
  
  // 2. Fetch the orders for those voided payments (those that are still active)
  let voidedOrders: VoidedOrder[] = [];
  if (voidedOrderIds.length > 0) {
    const { data: ordersData } = await (supabase
      .from("orders")
      .select("id, order_number, order_code, table_id, status, is_special, order_type, created_at, special_total_manual, table_name_snapshot")
      .in("id", voidedOrderIds)
      .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"]) as any);

    const orderSummaries = (ordersData ?? []) as Array<Omit<VoidedOrder, "total">>;
    const detailedOrders = await Promise.all(
      orderSummaries.map(async (order) => {
        const detail = await fetchOrderDetail(order.id);
        const total = detail
          ? detail.items.reduce((sum, item) => sum + Number(item.total ?? 0), 0)
          : Number(order.special_total_manual ?? 0);

        return {
          ...order,
          total,
        };
      }),
    );

    voidedOrders = detailedOrders;
  }

  const voidedOrderIdSet = new Set(voidedOrders.map(o => o.id));

  const tables = rows.map((row) => {
    const hasVoidedPayment = row.active_order_id ? voidedOrderIdSet.has(row.active_order_id) : false;
    
    // If the active order on this table has a voided payment, we 'liberate' the table visual status
    // so it can be used for new orders, but we still track that it has a voided order for this branch.
    const effectiveStatus = hasVoidedPayment ? "free" : (row.status ?? "free");
    const effectiveOrderId = hasVoidedPayment ? undefined : (row.active_order_id ?? undefined);
    const effectiveOrderStatus = hasVoidedPayment ? undefined : (row.active_order_status ?? undefined);

    return {
      id: row.table_id,
      name: row.table_name,
      visual_order: Number(row.visual_order ?? 0),
      is_active: Boolean(row.table_is_active),
      status: effectiveStatus,
      activeOrderId: effectiveOrderId,
      orderStatus: effectiveOrderStatus,
      splitCount: hasVoidedPayment ? 0 : Number(row.split_count ?? 0),
      totalDue: hasVoidedPayment ? 0 : Number(row.total_due ?? 0),
      splitTotals: hasVoidedPayment ? [] : parseSplitTotals(row.split_totals),
      itemCount: hasVoidedPayment ? 0 : Number(row.item_count ?? 0),
      elapsedMinutes: hasVoidedPayment ? 0 : Number(row.elapsed_minutes ?? 0),
      hasVoidedPayment,
    };
  });

  return { tables, voidedOrders };
}

export function useTablesWithStatus() {
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const reconciledGhostOrdersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeBranchId) return;

    const invalidateTables = () => {
      qc.invalidateQueries({ queryKey: getTablesWithStatusQueryKey(activeBranchId) });
    };

    const channel = supabase
      .channel(`tables-overview:${activeBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `branch_id=eq.${activeBranchId}`,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurant_tables",
          filter: `branch_id=eq.${activeBranchId}`,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cash_shifts",
          filter: `branch_id=eq.${activeBranchId}`,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_items",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_items",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "table_splits",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_ready_events",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_ready_events",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_dispatch_events",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_dispatch_events",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_cancellations",
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_cancellations",
        },
        invalidateTables,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeBranchId, qc]);

  const query = useQuery({
    queryKey: getTablesWithStatusQueryKey(activeBranchId),
    queryFn: () => fetchTablesWithStatus(activeBranchId!),
    enabled: !!activeBranchId,
    staleTime: 5_000,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!activeBranchId || !query.data?.tables) return;

    const ghostOrderIds = query.data.tables
      .filter((table) =>
        table.totalDue <= 0
        && Boolean(table.activeOrderId)
        && ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"].includes(String(table.orderStatus ?? "")),
      )
      .map((table) => table.activeOrderId!)
      .filter((orderId) => !reconciledGhostOrdersRef.current.has(orderId));

    for (const orderId of ghostOrderIds) {
      reconciledGhostOrdersRef.current.add(orderId);
      void syncOrderPaymentState(orderId)
        .then(() => {
          qc.invalidateQueries({ queryKey: getTablesWithStatusQueryKey(activeBranchId) });
        })
        .catch((error) => {
          reconciledGhostOrdersRef.current.delete(orderId);
          console.error("No se pudo reconciliar el estado de pago de la orden", error);
        });
    }
  }, [activeBranchId, qc, query.data]);

  return query;
}
