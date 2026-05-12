import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CircleDollarSign, History, LayoutGrid, Loader2, Plus, RefreshCw, RotateCcw, Sparkles, UserRound, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { cn } from "@/lib/utils";
import { canOperate } from "@/lib/permissions";
import { roundMoney } from "@/lib/paymentQuantity";
import {
  fetchOrderDetail,
  getOrderQueryKey,
  purgeEmptyDineInTableDraftsForBranch,
  seedDineInDraftOrderCache,
} from "@/hooks/useOrder";
import { fetchMenuTreeNodes, getMenuTreeQueryKey, type MenuScope } from "@/hooks/useMenuTree";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MobileMenuSheet } from "@/components/MobileMenuSheet";

const STATUS_CONFIG = {
  free: {
    bg: "bg-gradient-to-br from-sky-50 via-white to-cyan-100 dark:from-sky-950/20 dark:via-card dark:to-cyan-950/20",
    border: "border-sky-300 dark:border-sky-800",
    text: "text-sky-700 dark:text-sky-400",
    label: "Libre",
    icon: null,
    artWrap:
      "border-sky-200 bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-300 text-white shadow-[0_18px_38px_-24px_rgba(14,165,233,0.8)] dark:border-sky-800 dark:from-sky-600 dark:via-cyan-600 dark:to-teal-500 dark:shadow-[0_18px_38px_-24px_rgba(14,165,233,0.3)]",
    artIcon: <LayoutGrid className="h-8 w-8" />,
  },
  occupied: {
    bg: "bg-gradient-to-br from-orange-50 via-white to-amber-100 dark:from-orange-950/20 dark:via-card dark:to-amber-950/20",
    border: "border-primary/40 dark:border-primary/30",
    text: "text-primary dark:text-orange-400",
    label: "Ocupada",
    icon: <Users className="h-4 w-4" />,
    artWrap:
      "border-orange-200 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(249,115,22,0.82)] dark:border-orange-800 dark:from-orange-600 dark:via-amber-500 dark:to-yellow-500 dark:shadow-[0_18px_38px_-24px_rgba(249,115,22,0.3)]",
    artIcon: <Users className="h-8 w-8" />,
  },
  to_pay: {
    bg: "bg-gradient-to-br from-amber-50 via-white to-lime-100 dark:from-amber-950/20 dark:via-card dark:to-lime-950/20",
    border: "border-warning/40 dark:border-warning/30",
    text: "text-amber-800 dark:text-amber-500",
    label: "Por pagar",
    icon: <CircleDollarSign className="h-4 w-4" />,
    artWrap:
      "border-lime-200 bg-gradient-to-br from-emerald-500 via-lime-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(132,204,22,0.82)] dark:border-lime-800 dark:from-emerald-600 dark:via-lime-600 dark:to-yellow-500 dark:shadow-[0_18px_38px_-24px_rgba(132,204,22,0.3)]",
    artIcon: <CircleDollarSign className="h-8 w-8" />,
  },
} as const;

const formatCurrency = (value: number) => `$${roundMoney(value).toFixed(2)}`;
const formatTableBadge = (name: string) => name.replace(/^mesa\s*/i, "").trim() || name;

const seedTakeoutOrderCache = (
  qc: ReturnType<typeof useQueryClient>,
  orderId: string,
  {
    branchId,
    createdAt,
  }: {
    branchId: string;
    createdAt: string;
  },
) => {
  qc.setQueryData(getOrderQueryKey(orderId), {
    id: orderId,
    order_number: null,
    order_code: null,
    status: "DRAFT",
    order_type: "TAKEOUT",
    menu_scope: "TAKEOUT",
    is_special: false,
    is_tray_order: false,
    special_total_manual: null,
    branch_id: branchId,
    table_id: null,
    split_id: null,
    table_name: undefined,
    created_at: createdAt,
    items: [],
    siblings: [],
  });
};

const Mesas = () => {
  const tablesQuery = useTablesWithStatus();
  const tables = tablesQuery.data?.tables;
  const isLoading = tablesQuery.isLoading;
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canOperateMesas =
    canOperate(permissions, "mesas")
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  /** Sin `tablesQuery` en dependencias: el objeto del hook cambia cada render y relanzaba purgas + invalidaciones masivas de órdenes. */
  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    void purgeEmptyDineInTableDraftsForBranch(qc, activeBranchId).then(() => {
      if (!cancelled) {
        void qc.invalidateQueries({ queryKey: ["tables-with-status", activeBranchId], exact: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeBranchId, qc]);

  useEffect(() => {
    if (!activeBranchId) return;

    const menuScopes: MenuScope[] = ["TABLE", "TAKEOUT", "BULK"];
    for (const menuScope of menuScopes) {
      void qc.prefetchQuery({
        queryKey: getMenuTreeQueryKey({
          branchId: activeBranchId,
          menuScope,
          includeInactive: false,
          hasOverride: false,
        }),
        queryFn: () =>
          fetchMenuTreeNodes({
            branchId: activeBranchId,
            menuScope,
            includeInactive: false,
          }),
        staleTime: 60_000,
        gcTime: 10 * 60_000,
      });
    }

    const warmOrderIdSet = new Set<string>((tables ?? []).map((table) => table.activeOrderId).filter(Boolean));
    const warmOrderIds = Array.from(warmOrderIdSet);
    for (const warmOrderId of warmOrderIds) {
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(warmOrderId),
        queryFn: () => fetchOrderDetail(warmOrderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
    }
  }, [activeBranchId, qc, tables]);

  const warmOrderId = (orderId: string) => {
    void qc.prefetchQuery({
      queryKey: getOrderQueryKey(orderId),
      queryFn: () => fetchOrderDetail(orderId),
      staleTime: 15_000,
      gcTime: 10 * 60_000,
    });
  };

  const warmTableFlow = (t: NonNullable<typeof tables>[number]) => {
    const orderIdToWarm = t.activeOrderId ?? t.reusableDraftOrderId;
    if (orderIdToWarm) warmOrderId(orderIdToWarm);
  };

  const handleTableClick = async (table: NonNullable<typeof tables>[number]) => {
    if (table.status === "free") {
      if (!canOperateMesas) return;
      // activeOrderId / reusableDraftOrderId pueden quedar obsoletos en caché tras purgar un borrador vacío al salir de Órdenes.
      if (table.activeOrderId) {
        try {
          const detail = await fetchOrderDetail(table.activeOrderId);
          if (detail) {
            warmOrderId(table.activeOrderId);
            navigate(`/ordenes?order=${table.activeOrderId}&origin=mesas`, { replace: true });
            return;
          }
        } catch {
          /* id fantasma: abrir como mesa libre real */
        }
      }
      if (table.reusableDraftOrderId) {
        try {
          const detail = await fetchOrderDetail(table.reusableDraftOrderId);
          if (detail && detail.status === "DRAFT" && detail.order_type === "DINE_IN") {
            warmOrderId(table.reusableDraftOrderId);
            toast.success(`Entrando a ${table.name}...`);
            navigate(`/ordenes?order=${table.reusableDraftOrderId}&origin=mesas`, { replace: true });
            return;
          }
        } catch {
          /* borrador ya no existe */
        }
      }
      if (!user || !activeBranchId) return;
      const optimisticOrderId = crypto.randomUUID();
      const now = new Date().toISOString();
      seedDineInDraftOrderCache(qc, optimisticOrderId, {
        branchId: activeBranchId,
        tableId: table.id,
        tableName: table.name,
        createdAt: now,
        tableOrderPosition: 1,
        siblings: [
          {
            id: optimisticOrderId,
            order_number: null,
            order_code: null,
            split_code: null,
            table_order_position: 1,
            item_count: 0,
            created_at: now,
          },
        ],
      });
      toast.success(`Entrando a ${table.name}...`);
      navigate(
        `/ordenes?order=${optimisticOrderId}&openTable=${table.id}&tableName=${encodeURIComponent(table.name)}&origin=mesas`,
        { replace: true },
      );
    } else if (table.activeOrderId) {
      warmOrderId(table.activeOrderId);
      navigate(`/ordenes?order=${table.activeOrderId}&origin=mesas`, { replace: true });
    }
  };

  if (tablesQuery.isError) {
    return (
      <div className="p-4">
        <div className="rounded-[24px] border border-orange-200 bg-white/80 p-5 text-center text-sm text-muted-foreground shadow-sm">
          <p className="font-semibold text-foreground">No se pudieron cargar las mesas</p>
          <p className="mt-2">{tablesQuery.error instanceof Error ? tablesQuery.error.message : "Intenta nuevamente."}</p>
          <Button type="button" variant="outline" className="mt-4 rounded-2xl" onClick={() => tablesQuery.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !tables) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const freeCount = (tables?.filter((table) => table.status === "free") ?? []).length;
  const occupiedCount = (tables?.filter((table) => table.status === "occupied" && !table.hasVoidedPayment) ?? []).length;
  const toPayCount = (tables?.filter((table) => table.status === "to_pay" && !table.hasVoidedPayment) ?? []).length;

  return (
    <div className="pb-8">
      <section className="px-2.5 pb-2 pt-2 sm:px-4 sm:pt-2">
        {!canOperateMesas && (
          <div className="mb-2 flex justify-end">
            <span className="rounded-full border border-border bg-white/85 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm">
              Solo consulta
            </span>
          </div>
        )}

      </section>

      <div className="sticky top-14 z-30 bg-background px-2.5 pb-3 pt-2 md:top-0 sm:px-4 sm:pt-3">
        <div className="surface-glow px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="relative flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <h1 className="font-display text-lg font-bold text-foreground sm:text-xl">Mesas</h1>
            </div>
            <div className="scrollbar-none -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 text-[11px] font-medium whitespace-nowrap">
              <span className="flex items-center gap-1 rounded-full border border-white/70 bg-white/85 px-2.5 py-0.5 text-muted-foreground shadow-sm">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                {freeCount} libres
              </span>
              <span className="flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-primary shadow-sm dark:border-primary/30 dark:bg-orange-950/40">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {occupiedCount} ocupadas
              </span>
              {toPayCount > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-warning shadow-sm dark:border-warning/30 dark:bg-amber-950/40">
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  {toPayCount} por pagar
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "px-2.5 sm:px-4",
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              "grid grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]",
            )}
          >
            {tables?.map((table, index) => {
              const config = STATUS_CONFIG[table.status];
              const isFreeAndReadonly = table.status === "free" && !canOperateMesas;
              const tableBadge = formatTableBadge(table.name);
              const visibleSplitTotals =
                table.splitTotals.length > 0 && table.splitTotals.length <= 2 ? table.splitTotals.slice(0, 2) : [];
              const showSingleTotal = table.totalDue > 0 && visibleSplitTotals.length === 0;

              return (
                <motion.button
                  key={table.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (index + 1) * 0.03 }}
                  onClick={() => handleTableClick(table)}
                  onMouseEnter={() => warmTableFlow(table)}
                  onTouchStart={() => warmTableFlow(table)}
                  className={cn(
                    "relative flex min-h-[142px] flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 p-2.5 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95 sm:min-h-[188px] sm:gap-3 sm:rounded-[28px] sm:p-5",
                    config.bg,
                    config.border,
                    table.totalDue > 0 && "pb-11 sm:pb-12",
                    visibleSplitTotals.length > 0 && "pb-12 sm:pb-12",
                    table.status === "free" && canOperateMesas && "hover:border-primary/30 hover:bg-primary/5",
                    isFreeAndReadonly && "cursor-default opacity-70",
                  )}
                >
                  <>
                      <span className={cn(
                        "absolute right-2 top-2 inline-flex min-h-[2.45rem] min-w-[2.45rem] items-center justify-center rounded-full border px-2 text-[1.15rem] font-black leading-none shadow-sm sm:right-3 sm:top-3 sm:min-h-[2.9rem] sm:min-w-[2.9rem] sm:text-[1.45rem]",
                        table.status === "free"
                          ? "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-950/80 dark:text-sky-300"
                          : "border-orange-300 bg-amber-100 text-primary dark:border-primary/40 dark:bg-orange-950/80 dark:text-orange-300",
                      )}>
                        {tableBadge}
                      </span>
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-[16px] border-2 sm:h-16 sm:w-16 sm:rounded-[22px]", config.artWrap)}>
                        {config.artIcon}
                      </div>
                      <div className={cn("flex items-center gap-1 text-[10px] font-medium sm:text-xs", config.text)}>
                        {config.icon}
                        <span>{config.label}</span>
                      </div>
                      {table.created_by_name && (
                        <div className="max-w-[85%] rounded-full border border-orange-200 bg-white/85 px-2 py-1 text-[9px] font-semibold text-orange-700 shadow-sm sm:text-[10px] dark:border-primary/30 dark:bg-card/85 dark:text-orange-300">
                          <span className="flex min-w-0 items-center gap-1">
                            <UserRound className="h-3 w-3 shrink-0" />
                            <span className="truncate">{table.created_by_name}</span>
                          </span>
                        </div>
                      )}
                      {table.status === "free" && canOperateMesas && (
                        <div className="absolute left-2 top-2 rounded-full bg-primary/10 p-1 sm:left-3 sm:top-3">
                          <Plus className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      {table.status === "free" && (
                        <div className="flex items-center gap-1 rounded-full border border-sky-200 bg-white/85 px-2 py-1 text-[8px] font-semibold text-sky-700 shadow-sm sm:text-[10px] dark:border-sky-800 dark:bg-card/85 dark:text-sky-400">
                          <Sparkles className="h-3 w-3" />
                          Lista para abrir
                        </div>
                      )}
                      {showSingleTotal && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-amber-300 bg-white/95 px-3 py-1.5 text-[13px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:left-auto sm:right-3 sm:translate-x-0 sm:px-4 sm:py-2.5 sm:text-base">
                          {formatCurrency(table.totalDue)}
                        </div>
                      )}
                      {visibleSplitTotals[0] && (
                        <div className="absolute bottom-2 left-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-amber-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:left-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                          <span className="block truncate">{formatCurrency(visibleSplitTotals[0].totalDue)}</span>
                        </div>
                      )}
                      {visibleSplitTotals[1] && (
                        <div className="absolute bottom-2 right-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-amber-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:right-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                          <span className="block truncate">{formatCurrency(visibleSplitTotals[1].totalDue)}</span>
                        </div>
                      )}
                      {table.splitCount > 0 && (
                        <span className="absolute left-2 top-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                          {table.splitCount} {table.splitCount === 1 ? "orden" : "ordenes"}
                        </span>
                      )}
                  </>
                </motion.button>
              );
            })}
          </div>

          {(tables?.length ?? 0) === 0 && (
            <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
              No hay mesas habilitadas para el turno actual. La cantidad disponible se define al abrir turno en Caja.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Mesas;
