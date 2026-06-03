import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CircleDollarSign, History, LayoutGrid, Loader2, Plus, RotateCcw, UserRound, Users, ClipboardPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { cn } from "@/lib/utils";
import { getOrderRef } from "@/lib/orderPresentation";
import { canOperate } from "@/lib/permissions";
import { roundMoney } from "@/lib/paymentQuantity";
import { fetchOrderDetail, getOrderQueryKey } from "@/hooks/useOrder";
import { fetchMenuTreeNodes, getMenuTreeQueryKey, type MenuScope } from "@/hooks/useMenuTree";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

const EditarOrden = () => {
  const tablesQuery = useTablesWithStatus();
  // FILTER: Only show tables that have an order that is "KITCHEN_DISPATCHED" (item despachado) OR table is "to_pay" (orden cerrada)
  const allTables = tablesQuery.data?.tables ?? [];
  const editableTables = allTables.filter(
    (table) => table.orderStatus === "KITCHEN_DISPATCHED" || table.status === "to_pay"
  );
  
  const voidedOrders = tablesQuery.data?.voidedOrders ?? [];
  const isLoading = tablesQuery.isLoading;
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [isVoidedOrdersOpen, setIsVoidedOrdersOpen] = useState(false);
  const canOperateMesas =
    canOperate(permissions, "mesas")
    || Boolean(shiftGateQuery.data?.canEditOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  useEffect(() => {
    if (!activeBranchId) return;

    const menuScopes: MenuScope[] = ["TABLE", "TAKEOUT", "BULK", "EXTRA"];
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

    const warmOrderIdSet = new Set<string>((editableTables ?? []).map((table) => table.activeOrderId).filter(Boolean));
    const warmOrderIds = Array.from(warmOrderIdSet);
    for (const warmOrderId of warmOrderIds) {
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(warmOrderId),
        queryFn: () => fetchOrderDetail(warmOrderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
    }
  }, [activeBranchId, qc, editableTables.length]);

  const warmTableFlow = (table: NonNullable<typeof editableTables>[number]) => {
    if (!activeBranchId) return;

    if (table.activeOrderId) {
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(table.activeOrderId),
        queryFn: () => fetchOrderDetail(table.activeOrderId!),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
    }
  };

  const handleTableClick = async (table: NonNullable<typeof editableTables>[number]) => {
    if (!canOperateMesas) return;
    if (table.activeOrderId) {
      warmTableFlow(table);
      navigate(`/ordenes?order=${table.activeOrderId}&from=editar`);
    } else {
        toast.error("No hay una orden activa para editar en esta mesa.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const occupiedCount = editableTables.filter((table) => table.status === "occupied" && !table.hasVoidedPayment).length;
  const toPayCount = editableTables.filter((table) => table.status === "to_pay" && !table.hasVoidedPayment).length;

  const allVoidedOrdersCount = voidedOrders?.length ?? 0;

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

        {allVoidedOrdersCount > 0 && (
          <div className="mb-3">
              <motion.button
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setIsVoidedOrdersOpen(true)}
                className={cn(
                  "w-full relative flex min-h-[58px] items-center justify-center gap-3 overflow-hidden rounded-[18px] border-2 px-4 py-2 text-left shadow-lg transition-all active:scale-[0.98] sm:min-h-[64px] sm:rounded-[20px]",
                  "border-red-300 bg-gradient-to-r from-red-50 via-white to-rose-50 dark:border-red-900/50 dark:from-red-950/30 dark:via-card dark:to-rose-950/30",
                  "hover:border-red-400 hover:shadow-red-200/50 dark:hover:shadow-red-900/20"
                )}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50 font-black text-red-600 dark:text-red-400 shadow-inner">
                  {allVoidedOrdersCount}
                </div>
                <div className="flex flex-col">
                  <span className="font-display text-sm font-black text-red-700 dark:text-red-400 sm:text-base">Pagos Anulados</span>
                  <span className="text-[10px] text-red-500/80 dark:text-red-500/60 font-medium">Revisar órdenes pendientes</span>
                </div>
                <History className="ml-auto h-5 w-5 text-red-400/70" />
              </motion.button>
          </div>
        )}
      </section>

      <div className="sticky top-14 z-30 bg-background px-2.5 pb-3 pt-2 md:top-0 sm:px-4 sm:pt-3">
        <div className="surface-glow px-3 py-2.5 sm:px-4 sm:py-3 border-amber-200/60 from-amber-50/40">
          <div className="relative flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <ClipboardPen className="h-5 w-5" />
              <h1 className="font-display text-lg font-bold sm:text-xl">Editar Orden</h1>
            </div>
            <div className="scrollbar-none -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 text-[11px] font-medium whitespace-nowrap">
              {occupiedCount > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-primary shadow-sm dark:border-primary/30 dark:bg-orange-950/40">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {occupiedCount} ocupadas
                </span>
              )}
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
            {editableTables.map((table, index) => {
              const config = STATUS_CONFIG[table.status];
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
                    !canOperateMesas && "cursor-default opacity-70",
                  )}
                >
                  <span className={cn(
                    "absolute right-2 top-2 inline-flex min-h-[2.45rem] min-w-[2.45rem] items-center justify-center rounded-full border px-2 text-[1.15rem] font-black leading-none shadow-sm sm:right-3 sm:top-3 sm:min-h-[2.9rem] sm:min-w-[2.9rem] sm:text-[1.45rem]",
                    "border-orange-300 bg-amber-100 text-primary dark:border-primary/40 dark:bg-orange-950/80 dark:text-orange-300",
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
                </motion.button>
              );
            })}
          </div>

          {editableTables.length === 0 && (
            <div className="rounded-[24px] border border-orange-200 bg-white/80 p-6 text-center text-sm font-medium text-orange-800/70 shadow-sm">
              <ClipboardPen className="mx-auto mb-2 h-10 w-10 opacity-40 text-orange-600" />
              No hay mesas con órdenes despachadas o cerradas para editar.
            </div>
          )}
        </div>
      </div>

      <Dialog open={isVoidedOrdersOpen} onOpenChange={setIsVoidedOrdersOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden rounded-[24px] border-none sm:rounded-[32px]">
          <DialogHeader className="p-6 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card border-b border-red-100 dark:border-red-900/30">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500 text-white shadow-lg shadow-red-200 dark:shadow-red-950/40">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="font-display text-xl font-black text-red-900 dark:text-red-400">Pagos Anulados</DialogTitle>
                <p className="text-xs text-red-600/70 dark:text-red-500/50 font-medium">Órdenes que requieren atención</p>
              </div>
            </div>
          </DialogHeader>
          
          <div className="max-h-[60vh] overflow-y-auto p-4 flex flex-col gap-3">
            {voidedOrders.map((order) => {
              const tablesMap = Object.fromEntries(allTables.map(t => [t.id, t.name]));
              const currentTableName = order.table_id ? tablesMap[order.table_id] : null;
              const snapshotName = order.table_name_snapshot;
              
              const title = currentTableName || snapshotName || (order.is_special ? "Orden Especial" : (order.order_type === "DINE_IN" ? "Mesa (Anulada)" : "Para Llevar"));
              const id = order.id;
              const badge = (currentTableName || snapshotName) 
                ? formatTableBadge(currentTableName || snapshotName!) 
                : getOrderRef(order.order_code, order.order_number);
              
              return (
                <button
                  key={id}
                  onClick={() => {
                    setIsVoidedOrdersOpen(false);
                    navigate(`/ordenes?order=${id}&from=mesas`);
                  }}
                  className="flex items-center gap-4 p-4 rounded-[22px] border-2 border-red-100 bg-white hover:border-red-300 hover:bg-red-50/50 transition-all text-left group dark:bg-card dark:border-red-900/30 dark:hover:border-red-700/50 dark:hover:bg-red-950/10"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 font-black text-lg group-hover:scale-110 transition-transform dark:bg-red-900/30 dark:text-red-400">
                    {badge}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-display font-black text-red-900 dark:text-red-300 truncate">{title}</span>
                    {order.created_by_name && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-red-600/80">
                        <UserRound className="h-3 w-3" />
                        {order.created_by_name}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full w-fit dark:bg-red-950/50">Pendiente de cobro</span>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-xs font-black text-red-900 dark:text-red-400">
                      {formatCurrency(order.total || order.special_total_manual || 0)}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-medium">Revisar →</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="p-4 bg-muted/30 border-t border-border">
            <p className="text-[10px] text-center text-muted-foreground font-medium">
              Estas órdenes han sido removidas de su mesa para permitir nuevos pedidos, pero aún deben ser procesadas en Caja.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EditarOrden;
