import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, RefreshCw, PackagePlus, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { canOperate } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  compareSiblingOrderTabs,
  fetchExtraSiblingOrders,
  fetchOrderDetail,
  getOrderQueryKey,
  type SiblingOrder,
} from "@/hooks/useOrder";
import {
  FREQUENT_PRODUCT_CONTEXTS,
  fetchFrequentProducts,
  getFrequentProductsQueryKey,
} from "@/hooks/useFrequentProducts";

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

const getExtraReference = (order: SiblingOrder, fallbackIndex: number) =>
  order.order_code ?? (order.order_number ? `#${order.order_number}` : `Orden ${fallbackIndex + 1}`);

const Extra = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const [creating, setCreating] = useState(false);
  const [autoLaunchFailed, setAutoLaunchFailed] = useState(false);
  const autoLaunchAttemptedRef = useRef(false);

  const canOperateExtra =
    canOperate(permissions, "mesas")
    || canOperate(permissions, "ordenes")
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.canAccessOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  const extraOrdersQuery = useQuery({
    queryKey: ["extra-orders", activeBranchId ?? null, shiftGateQuery.data?.shiftId ?? "_"],
    queryFn: () => fetchExtraSiblingOrders(activeBranchId!),
    enabled: !!activeBranchId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
    gcTime: 2 * 60_000,
  });

  const orders = (extraOrdersQuery.data ?? []).filter((order) => {
    const status = String(order.status ?? "");
    if (["KITCHEN_DISPATCHED", "PAID", "CANCELLED"].includes(status)) return false;
    return status !== "DRAFT" || Number(order.item_count ?? 0) > 0;
  });

  useEffect(() => {
    if (!activeBranchId) return;
    for (const item of FREQUENT_PRODUCT_CONTEXTS) {
      void qc.prefetchQuery({
        queryKey: getFrequentProductsQueryKey(activeBranchId, item.value),
        queryFn: () => fetchFrequentProducts(activeBranchId, item.value),
        staleTime: 30_000,
      });
    }
  }, [activeBranchId, qc]);

  useEffect(() => {
    for (const order of orders) {
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(order.id),
        queryFn: () => fetchOrderDetail(order.id),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
    }
  }, [orders, qc]);

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

  const handleCreateOrder = useCallback(async () => {
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

    setCreating(true);
    setAutoLaunchFailed(false);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.rpc("create_extra_order" as any, {
        p_branch_id: activeBranchId,
        p_created_by: user.id,
      } as any);

      if (error) throw error;

      const orderId = String(data);
      seedExtraOrderCache(qc, orderId, { branchId: activeBranchId, createdAt: now });

      qc.setQueryData(
        ["extra-orders", activeBranchId, shiftGateQuery.data?.shiftId ?? "_"],
        [
          ...orders,
          {
            id: orderId,
            order_number: null,
            order_code: null,
            split_code: null,
            table_order_position: orders.length + 1,
            item_count: 0,
            created_at: now,
          },
        ].sort(compareSiblingOrderTabs),
      );

      navigate(`/ordenes?order=${orderId}&origin=extra`, { replace: true });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["extra-orders", activeBranchId] });
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(orderId),
        queryFn: () => fetchOrderDetail(orderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
      return true;
    } catch (err: any) {
      setAutoLaunchFailed(true);
      toast.error(err?.message || "Error al abrir orden Extra");
      return false;
    } finally {
      setCreating(false);
    }
  }, [
    activeBranchId,
    canOperateExtra,
    creating,
    navigate,
    orders,
    qc,
    shiftGateQuery.data?.shiftId,
    user,
  ]);

  useEffect(() => {
    if (!canOperateExtra || !user || !activeBranchId) return;
    if (extraOrdersQuery.isLoading) return; // Must wait for query to check for drafts
    if (autoLaunchAttemptedRef.current) return;

    autoLaunchAttemptedRef.current = true;

    // Fast path: Reuse an existing empty draft if available
    const emptyDraft = (extraOrdersQuery.data ?? []).find(
      (o) => o.status === "DRAFT" && Number(o.item_count ?? 0) === 0
    );

    if (emptyDraft) {
      warmExtraOrder(emptyDraft.id);
      navigate(`/ordenes?order=${emptyDraft.id}&origin=extra`, { replace: true });
    } else {
      void handleCreateOrder();
    }
  }, [
    activeBranchId,
    canOperateExtra,
    extraOrdersQuery.data,
    extraOrdersQuery.isLoading,
    handleCreateOrder,
    navigate,
    user,
  ]);

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

  if (canOperateExtra && (creating || !autoLaunchFailed)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        <p className="text-sm text-muted-foreground">Abriendo orden Extra...</p>
      </div>
    );
  }

  if (canOperateExtra && autoLaunchFailed) {
    return (
      <motion.div className="p-4">
        <div className="rounded-[24px] border border-teal-200 bg-white/80 p-5 text-center text-sm text-muted-foreground shadow-sm">
          <p className="font-semibold text-foreground">No se pudo abrir la orden Extra</p>
          <p className="mt-2">Revisa el turno y tus permisos, luego intenta de nuevo.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 rounded-2xl"
            disabled={creating}
            onClick={() => {
              autoLaunchAttemptedRef.current = false;
              void handleCreateOrder();
            }}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reintentar
          </Button>
        </div>
      </motion.div>
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
                {orders.length} activas
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-2.5 sm:px-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {orders.map((order, index) => {
            const orderRef = getExtraReference(order, index);
            const totalLabel = `$${Number(order.total ?? 0).toFixed(2)}`;

            return (
              <motion.button
                key={order.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: (index + 1) * 0.03 }}
                onClick={() => handleOpenOrder(order.id)}
                onMouseEnter={() => warmExtraOrder(order.id)}
                onTouchStart={() => warmExtraOrder(order.id)}
                className="relative flex min-h-[142px] flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 border-teal-400/40 bg-gradient-to-br from-teal-50 via-white to-cyan-100 p-2.5 pb-11 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95 sm:min-h-[188px] sm:gap-3 sm:rounded-[28px] sm:p-5 sm:pb-12 dark:border-teal-500/30 dark:from-teal-950/20 dark:via-card dark:to-cyan-950/20"
              >
                <span className="absolute right-2 top-2 inline-flex min-h-[2.45rem] min-w-[2.45rem] items-center justify-center rounded-full border border-teal-300 bg-teal-100 px-2 text-[1.15rem] font-black leading-none text-teal-700 shadow-sm sm:right-3 sm:top-3 sm:min-h-[2.9rem] sm:min-w-[2.9rem] sm:text-[1.45rem] dark:border-teal-500/40 dark:bg-teal-950/80 dark:text-teal-300">
                  {index + 1}
                </span>
                <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border-2 border-teal-200 bg-gradient-to-br from-teal-600 via-cyan-500 to-teal-400 text-white shadow-[0_18px_38px_-24px_rgba(13,148,136,0.82)] sm:h-16 sm:w-16 sm:rounded-[22px] dark:border-teal-800">
                  <PackagePlus className="h-8 w-8" />
                </div>
                <div className="flex w-full max-w-[calc(100%-1rem)] items-center justify-center gap-1 px-1 text-[10px] font-bold leading-tight text-teal-700 sm:text-xs dark:text-teal-400">
                  <PackagePlus className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-all text-center">{orderRef}</span>
                </div>
                {order.created_by_name && (
                  <div className="max-w-[85%] rounded-full border border-teal-200 bg-white/85 px-2 py-1 text-[9px] font-semibold text-teal-700 shadow-sm sm:text-[10px] dark:border-teal-500/30 dark:bg-card/85 dark:text-teal-300">
                    <span className="flex min-w-0 items-center gap-1">
                      <UserRound className="h-3 w-3 shrink-0" />
                      <span className="truncate">{order.created_by_name}</span>
                    </span>
                  </div>
                )}
                <div className="absolute bottom-2 left-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-teal-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm sm:bottom-3 sm:left-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                  {order.item_count} item{order.item_count !== 1 ? "s" : ""}
                </div>
                <div className="absolute bottom-2 right-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-teal-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm sm:bottom-3 sm:right-3 sm:max-w-none sm:px-3.5 sm:py-2 sm:text-sm">
                  {totalLabel}
                </div>
              </motion.button>
            );
          })}

        </div>
      </div>
    </div>
  );
};

export default Extra;
