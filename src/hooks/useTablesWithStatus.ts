import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { syncOrderPaymentState } from "@/hooks/useCaja";
import type { Database } from "@/integrations/supabase/types";
import { buildUserDisplayMap } from "@/lib/userDisplay";

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
  created_by_name?: string | null;
  reusableDraftOrderId?: string;
}

export interface TablesWithStatusData {
  tables: TableWithStatus[];
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

/** Incluye el turno para no reusar snapshot de otro turno en React Query. */
export function getTablesWithStatusQueryKey(
  branchId: string | null | undefined,
  shiftKeyPart: string | null | undefined = "shift-gate-pending",
) {
  return ["tables-with-status", branchId ?? null, shiftKeyPart ?? "shift-gate-pending"] as const;
}

const withTablesTimeout = <T,>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("La carga de mesas tardo demasiado. Revisa la conexion e intenta otra vez."));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });

async function fetchTablesWithStatusInternal(branchId: string): Promise<TablesWithStatusData> {
  const { data, error } = await supabase.rpc("get_branch_tables_overview" as any, {
    p_branch_id: branchId,
  } as any);
  if (error) throw error;

  const rows = (data ?? []) as TablesOverviewRow[];
  const activeOrderIds = Array.from(
    new Set(rows.map((row) => row.active_order_id).filter((id): id is string => Boolean(id))),
  );
  
  const activeOrders = activeOrderIds.length > 0
    ? ((await supabase
      .from("orders" as any)
      .select("id, created_by")
      .in("id", activeOrderIds) as any).data ?? [])
    : [];

  const activeCreatorIds = Array.from(
    new Set((activeOrders ?? []).map((order: any) => order.created_by).filter(Boolean)),
  ) as string[];

  const activeCreatorProfiles = activeCreatorIds.length > 0
    ? ((await supabase
      .from("profiles" as any)
      .select("id, first_name, full_name, username, email")
      .in("id", activeCreatorIds) as any).data ?? [])
    : [];

  const activeOrdersMap = Object.fromEntries((activeOrders ?? []).map((order: any) => [order.id, order]));
  const activeCreatorNameMap = buildUserDisplayMap(activeCreatorProfiles);
  
  // We check for voided payments to set the visual flag on tables, but we don't return them as a separate list anymore
  const { data: voidedPayments } = await (supabase
    .from("payments" as any)
    .select("order_id, orders!inner(branch_id)")
    .eq("orders.branch_id", branchId)
    .ilike("notes", "%VOIDED%") as any);
  
  const voidedOrderIdSet = new Set<string>((voidedPayments ?? []).map((p: any) => String(p.order_id)));

  const tables = rows.map((row) => {
    const hasVoidedPayment = row.active_order_id ? voidedOrderIdSet.has(row.active_order_id) : false;
    const isEmptyDraft =
      row.active_order_status === "DRAFT"
      && Number(row.total_due ?? 0) <= 0
      && parseSplitTotals(row.split_totals).length === 0;
    
    const effectiveStatus = isEmptyDraft
      ? "free"
      : row.status === "to_pay"
        ? "occupied"
        : (row.status ?? "free");

    const effectiveOrderId = isEmptyDraft ? undefined : (row.active_order_id ?? undefined);
    const effectiveOrderStatus = isEmptyDraft ? undefined : (row.active_order_status ?? undefined);
    const effectiveSplitTotals = isEmptyDraft ? [] : parseSplitTotals(row.split_totals);

    return {
      id: row.table_id,
      name: row.table_name,
      visual_order: Number(row.visual_order ?? 0),
      is_active: Boolean(row.table_is_active),
      status: effectiveStatus,
      activeOrderId: effectiveOrderId,
      orderStatus: effectiveOrderStatus,
      splitCount: isEmptyDraft ? 0 : Number(row.split_count ?? 0),
      totalDue: isEmptyDraft ? 0 : Number(row.total_due ?? 0),
      splitTotals: effectiveSplitTotals,
      itemCount: isEmptyDraft ? 0 : Number(row.item_count ?? 0),
      elapsedMinutes: isEmptyDraft ? 0 : Number(row.elapsed_minutes ?? 0),
      hasVoidedPayment,
      reusableDraftOrderId: isEmptyDraft ? (row.active_order_id ?? undefined) : undefined,
      created_by_name: effectiveStatus !== "free" && effectiveOrderId
        ? (activeOrdersMap[effectiveOrderId]?.created_by
          ? (activeCreatorNameMap[activeOrdersMap[effectiveOrderId].created_by] ?? "Usuario")
          : null)
        : null,
    };
  });

  return { tables };
}

export async function fetchTablesWithStatus(branchId: string): Promise<TablesWithStatusData> {
  return withTablesTimeout(fetchTablesWithStatusInternal(branchId));
}

export function useTablesWithStatus() {
  const { activeBranchId } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const reconciledGhostOrdersRef = useRef<Set<string>>(new Set());

  const tablesShiftKeyPart = shiftGateQuery.isLoading
    ? "shift-gate-pending"
    : (shiftGateQuery.data?.shiftId ?? "no-open-shift");

  useEffect(() => {
    if (!activeBranchId) return;

    const invalidateTables = () => {
      qc.invalidateQueries({ queryKey: ["tables-with-status", activeBranchId], exact: false });
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
          table: "order_ready_events" as any,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_ready_events" as any,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_dispatch_events" as any,
        },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_dispatch_events" as any,
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
    queryKey: getTablesWithStatusQueryKey(activeBranchId, tablesShiftKeyPart),
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
          qc.invalidateQueries({ queryKey: ["tables-with-status", activeBranchId], exact: false });
        })
        .catch((error) => {
          reconciledGhostOrdersRef.current.delete(orderId);
          console.error("No se pudo reconciliar el estado de pago de la orden", error);
        });
    }
  }, [activeBranchId, qc, query.data]);

  return query;
}
