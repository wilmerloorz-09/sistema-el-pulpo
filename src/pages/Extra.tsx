import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, PackagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { canOperate } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { getOrderRef } from "@/lib/orderPresentation";
import {
  closeExtraOrder,
  extraOrderCanCloseFromHome,
  getExtraOrderCloseErrorMessage,
  extraOrderShowsOnExtraHome,
  extraOrderStatusBadgeLabel,
} from "@/lib/extraOrders";
import { Button } from "@/components/ui/button";
import {
  fetchExtraSiblingOrders,
  fetchOrderDetail,
  getOrderQueryKey,
  type SiblingOrder,
} from "@/hooks/useOrder";
import { ExtraTableSelectorModal } from "@/components/order/ExtraTableSelectorModal";

const seedExtraOrderCache = (
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
    order_type: "EXTRA",
    menu_scope: "TABLE",
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

const getExtraReference = (order: SiblingOrder, fallbackIndex: number) => {
  const ref = getOrderRef(order.order_code, order.order_number);
  return ref === "Borrador" ? `Orden ${fallbackIndex + 1}` : ref;
};

const Extra = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const [creating, setCreating] = useState(false);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);

  const canOperateExtra =
    canOperate(permissions, "mesas")
    || canOperate(permissions, "ordenes")
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.canAccessOrders)
    || Boolean(shiftGateQuery.data?.canPackOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  const extraOrdersQuery = useQuery({
    queryKey: ["extra-orders", activeBranchId ?? null, shiftGateQuery.data?.shiftId ?? "_", user?.id ?? "_"],
    queryFn: () => fetchExtraSiblingOrders(activeBranchId!, user!.id),
    enabled: !!activeBranchId && !!user?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
    gcTime: 2 * 60_000,
  });

  const homeOrders = useMemo(
    () => (extraOrdersQuery.data ?? []).filter(extraOrderShowsOnExtraHome),
    [extraOrdersQuery.data],
  );



  useEffect(() => {
    for (const order of homeOrders) {
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(order.id),
        queryFn: () => fetchOrderDetail(order.id),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
    }
  }, [homeOrders, qc]);

  const warmExtraOrder = (orderId: string) => {
    void qc.prefetchQuery({
      queryKey: getOrderQueryKey(orderId),
      queryFn: () => fetchOrderDetail(orderId),
      staleTime: 15_000,
      gcTime: 10 * 60_000,
    });
  };

  const handleOpenOrder = (orderId: string) => {
    warmExtraOrder(orderId);
    navigate(`/ordenes?order=${orderId}&origin=extra`, { replace: true });
  };

  const handleCloseOrder = async (orderId: string) => {
    if (!orderId) {
      toast.error("No se encontro la orden a cerrar");
      return;
    }
    if (!activeBranchId || !user?.id) {
      toast.error("Selecciona sucursal e inicia sesion para cerrar la orden");
      return;
    }

    setClosingOrderId(orderId);
    try {
      await closeExtraOrder(orderId);
      toast.success("Orden Extra cerrada");
      qc.invalidateQueries({
        queryKey: ["extra-orders", activeBranchId, shiftGateQuery.data?.shiftId ?? "_", user.id],
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      void extraOrdersQuery.refetch();
    } catch (err: unknown) {
      toast.error(getExtraOrderCloseErrorMessage(err));
    } finally {
      setClosingOrderId(null);
    }
  };

  const handleCreateOrder = async () => {
    if (!user) {
      toast.error("Debes iniciar sesion para crear una orden.");
      return false;
    }
    if (!activeBranchId) {
      toast.error("Selecciona una sucursal activa.");
      return false;
    }
    if (!canOperateExtra) {
      toast.error("No tienes permiso para crear ordenes Extra en este turno.");
      return false;
    }
    if (creating) return false;

    // Pequeño delay para evitar que el evento de click (navegación) cierre el modal automáticamente
    setTimeout(() => {
      setIsTableModalOpen(true);
    }, 100);
    return true;
  };

  const handleCreateOrderWithTable = async (tableId: string | null) => {
    setIsTableModalOpen(false);
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.rpc("create_extra_order" as any, {
        p_branch_id: activeBranchId,
        p_created_by: user.id,
        p_table_id: tableId,
      } as any);

      if (error) throw error;

      const orderId = String(data);
      seedExtraOrderCache(qc, orderId, { branchId: activeBranchId, createdAt: now });

      navigate(`/ordenes?order=${orderId}&origin=extra`, { replace: true });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["extra-orders", activeBranchId, shiftGateQuery.data?.shiftId ?? "_", user.id] });
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(orderId),
        queryFn: () => fetchOrderDetail(orderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
      return true;
    } catch (err: any) {
      toast.error(err?.message || "Error al abrir orden Extra");
      return false;
    } finally {
      setCreating(false);
    }
  };



  if (extraOrdersQuery.isError) {
    return (
      <motion.div className="p-4">
        <div className="rounded-[24px] border border-teal-200 bg-white/80 p-5 text-center text-sm text-muted-foreground shadow-sm">
          <p className="font-semibold text-foreground">No se pudieron cargar las ordenes Extra</p>
          <p className="mt-2">
            {extraOrdersQuery.error instanceof Error ? extraOrdersQuery.error.message : "Intenta nuevamente."}
          </p>
          <Button type="button" variant="outline" className="mt-4 rounded-2xl" onClick={() => extraOrdersQuery.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        </div>
      </motion.div>
    );
  }

  if (extraOrdersQuery.isLoading && !extraOrdersQuery.data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }



  return (
    <div className="pb-8">
      <section className="px-2.5 pb-2 pt-2 sm:px-4 sm:pt-2">
        {!canOperateExtra && (
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
              <h1 className="font-display text-lg font-bold text-foreground sm:text-xl">Extra</h1>
            </div>
            <div className="scrollbar-none -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 text-[11px] font-medium whitespace-nowrap">
              <span className="flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-teal-800 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-teal-500" />
                {homeOrders.length} activas
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-2.5 sm:px-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {homeOrders.map((order, index) => {
            const orderRef = getExtraReference(order, index);
            const totalLabel = `$${Number(order.total ?? 0).toFixed(2)}`;
            const statusLabel = extraOrderStatusBadgeLabel(order.status);
            const canClose = extraOrderCanCloseFromHome(order.status);
            const isClosing = closingOrderId === order.id;

            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: (index + 1) * 0.03 }}
                className="relative min-h-[142px] sm:min-h-[188px]"
              >
                {canClose && canOperateExtra ? (
                  <button
                    type="button"
                    aria-label="Cerrar orden Extra"
                    disabled={isClosing}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCloseOrder(order.id);
                    }}
                    className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60 sm:right-3 sm:top-3 sm:h-9 sm:w-9"
                  >
                    {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="absolute right-2 top-2 z-10 inline-flex min-h-[2.45rem] min-w-[2.45rem] items-center justify-center rounded-full border border-teal-300 bg-teal-100 px-2 text-[1.15rem] font-black leading-none text-teal-700 shadow-sm sm:right-3 sm:top-3 sm:min-h-[2.9rem] sm:min-w-[2.9rem] sm:text-[1.45rem] dark:border-teal-500/40 dark:bg-teal-950/80 dark:text-teal-300">
                    {order.table_name_snapshot ? (order.table_name_snapshot.replace(/[^\d]/g, '') || order.table_name_snapshot.substring(0, 3).toUpperCase()) : (index + 1)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleOpenOrder(order.id)}
                  onMouseEnter={() => warmExtraOrder(order.id)}
                  onTouchStart={() => warmExtraOrder(order.id)}
                  className="relative flex h-full min-h-[142px] w-full flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 border-teal-400/40 bg-gradient-to-br from-teal-50 via-white to-cyan-100 p-2.5 pb-11 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95 sm:min-h-[188px] sm:gap-3 sm:rounded-[28px] sm:p-5 sm:pb-12 dark:border-teal-500/30 dark:from-teal-950/20 dark:via-card dark:to-cyan-950/20"
                >
                {statusLabel ? (
                  <span className="absolute left-2 top-2 max-w-[calc(100%-3.5rem)] truncate rounded-full border border-teal-200 bg-white/90 px-2 py-0.5 text-[9px] font-semibold text-teal-800 shadow-sm sm:left-3 sm:top-3 sm:text-[10px]">
                    {statusLabel}
                  </span>
                ) : null}
                <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border-2 border-teal-200 bg-gradient-to-br from-teal-600 via-cyan-500 to-teal-400 text-white shadow-[0_18px_38px_-24px_rgba(13,148,136,0.82)] sm:h-16 sm:w-16 sm:rounded-[22px] dark:border-teal-800">
                  <PackagePlus className="h-8 w-8" />
                </div>
                <div className="flex w-full max-w-[calc(100%-1rem)] items-center justify-center gap-1 px-1 text-[10px] font-bold leading-tight text-teal-700 sm:text-xs dark:text-teal-400">
                  <PackagePlus className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-all text-center">{orderRef}</span>
                </div>
                <div className="absolute bottom-2 left-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-teal-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm sm:bottom-3 sm:left-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                  {order.item_count} item{order.item_count !== 1 ? "s" : ""}
                </div>
                <div className="absolute bottom-2 right-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-teal-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm sm:bottom-3 sm:right-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                  {totalLabel}
                </div>
                </button>
              </motion.div>
            );
          })}

          <motion.button
            key="new-extra-order"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: (homeOrders.length + 1) * 0.03 }}
            onClick={() => void handleCreateOrder()}
            disabled={creating || !canOperateExtra}
            className={cn(
              "relative flex min-h-[142px] flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-teal-400/35 bg-gradient-to-br from-teal-50 via-white to-cyan-100 p-2.5 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95 sm:min-h-[188px] sm:gap-3 sm:rounded-[28px] sm:p-5",
              canOperateExtra && "hover:border-teal-500/55 hover:bg-teal-500/5",
              (!canOperateExtra || creating) && "cursor-not-allowed opacity-70",
            )}
          >
            {creating ? (
              <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border-2 border-teal-200 bg-gradient-to-br from-teal-600 via-cyan-500 to-teal-400 text-white shadow-[0_18px_38px_-24px_rgba(13,148,136,0.82)] sm:h-16 sm:w-16 sm:rounded-[22px]">
                  <Plus className="h-8 w-8" />
                </div>
                <div className="text-[10px] font-semibold text-teal-700 sm:text-xs">Nueva orden</div>
              </>
            )}
          </motion.button>
        </div>
      </div>

      <ExtraTableSelectorModal
        open={isTableModalOpen}
        onOpenChange={setIsTableModalOpen}
        onSelectTable={handleCreateOrderWithTable}
        isCreating={creating}
      />
    </div>
  );
};

export default Extra;
