import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { syncOrderPaymentState } from "@/hooks/useCaja";
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

export async function fetchTablesWithStatus(branchId: string): Promise<TableWithStatus[]> {
  const { data, error } = await supabase.rpc("get_branch_tables_overview" as never, {
    p_branch_id: branchId,
  } as never);
  if (error) throw error;

  return ((data ?? []) as TablesOverviewRow[]).map((row) => ({
    id: row.table_id,
    name: row.table_name,
    visual_order: Number(row.visual_order ?? 0),
    is_active: Boolean(row.table_is_active),
    status: row.status ?? "free",
    activeOrderId: row.active_order_id ?? undefined,
    orderStatus: row.active_order_status ?? undefined,
    splitCount: Number(row.split_count ?? 0),
    totalDue: Number(row.total_due ?? 0),
    splitTotals: parseSplitTotals(row.split_totals),
    itemCount: Number(row.item_count ?? 0),
    elapsedMinutes: Number(row.elapsed_minutes ?? 0),
  }));
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
    if (!activeBranchId || !query.data) return;

    const ghostOrderIds = query.data
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
