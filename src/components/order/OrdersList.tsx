import { useEffect, useState } from "react";
import { useOrdersByStatus, OrderSummary } from "@/hooks/useOrdersByStatus";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useCancellation } from "@/hooks/useCancellation";
import { canManage } from "@/lib/permissions";
import OrderListRow from "./OrderListRow";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ClipboardList, Clock, Truck, Ban, CircleDollarSign, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOrderRef } from "@/lib/orderPresentation";

type TabType = "sent" | "draft" | "dispatched" | "pendingCancellation" | "cancelled" | "paid";

interface TabInfo {
  key: TabType;
  label: string;
  status: string | null;
  showCancel: boolean;
  helperText: string;
  icon: React.ReactNode;
}

const tabs: TabInfo[] = [
  {
    key: "draft",
    label: "Borrador",
    status: "DRAFT",
    showCancel: true,
    helperText: "Aqui ves las ordenes que aun no han sido enviadas.",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    key: "sent",
    label: "En Caja",
    status: "SENT_TO_KITCHEN",
    showCancel: true,
    helperText: "Aqui ves las ordenes que ya fueron enviadas y estan pendientes de cobro en Caja.",
    icon: <Clock className="h-4 w-4" />,
  },
  {
    key: "paid",
    label: "Pagada",
    status: "PAID",
    showCancel: false,
    helperText: "Aqui ves las ordenes ya cerradas para cobro.",
    icon: <CircleDollarSign className="h-4 w-4" />,
  },
  {
    key: "dispatched",
    label: "Despachada",
    status: "KITCHEN_DISPATCHED",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades de mesa que ya fueron despachadas, aunque la linea original haya sido mayor.",
    icon: <Truck className="h-4 w-4" />,
  },
  {
    key: "cancelled",
    label: "Anulaciones",
    status: "CANCELLED",
    showCancel: false,
    helperText:
      "Ordenes con anulaciones ya aplicadas: totales o solo algunas cantidades (caja, despacho, politicas de anulacion, etc.). El nombre que ves suele ser quien abrio la orden, no quien aplico la anulacion.",
    icon: <Ban className="h-4 w-4" />,
  },
];

interface OrdersListProps {
  onCancelOrder?: (order: OrderSummary) => void;
  readOnly?: boolean;
  onOpenMergeSplitTool?: () => void;
}

export default function OrdersList({ onCancelOrder, readOnly = false, onOpenMergeSplitTool }: OrdersListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("sent");
  const [approvalTarget, setApprovalTarget] = useState<OrderSummary | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const { user } = useAuth();
  const { activeBranchId, isGlobalAdmin, permissions } = useBranch();
  const qc = useQueryClient();
  const shiftGateQuery = useBranchShiftGate();
  const { rejectCancellationRequestMutation, approveCancellationRequestMutation } = useCancellation();
  const canAuthorizeCancel =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || Boolean(shiftGateQuery.data?.canAuthorizeOrderCancel)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  useEffect(() => {
    if (!activeBranchId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidateOrders = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["orders", activeBranchId] });
        qc.invalidateQueries({ queryKey: ["order"] });
        qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      }, 250);
    };

    // Solo tablas publicadas en supabase_realtime.
    const channel = supabase
      .channel(`orders-live-sync:${activeBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `branch_id=eq.${activeBranchId}`,
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_items",
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_ready_events",
        },
        invalidateOrders,
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [activeBranchId, qc]);

  /** Todas las pestañas cargan en paralelo: bombillas correctas y cambio de pestaña instantaneo con caché. */
  const sentOrders = useOrdersByStatus("SENT_TO_KITCHEN");
  const draftOrders = useOrdersByStatus("DRAFT");
  const dispatchedOrders = useOrdersByStatus("KITCHEN_DISPATCHED");
  const pendingCancellationOrders = useOrdersByStatus("PENDING_CANCELLATION");
  const cancelledOrders = useOrdersByStatus("CANCELLED");
  const paidOrders = useOrdersByStatus("PAID");

  const getOrdersForTab = (tab: TabType) => {
    switch (tab) {
      case "sent":
        return sentOrders;
      case "draft":
        return draftOrders;
      case "dispatched":
        return dispatchedOrders;
      case "pendingCancellation":
        return pendingCancellationOrders;
      case "cancelled":
        return cancelledOrders;
      case "paid":
        return paidOrders;
    }
  };

  const getTabCount = (tab: TabType) => {
    const orders = getOrdersForTab(tab);
    return orders.data?.length || 0;
  };

  if (!activeBranchId) {
    return <div className="py-8 text-center text-muted-foreground">Selecciona una sucursal para ver las ordenes</div>;
  }

  const currentOrders = getOrdersForTab(activeTab);
  const currentTab = tabs.find((tab) => tab.key === activeTab)!;
  const totalOrders = tabs.reduce((sum, tab) => sum + getTabCount(tab.key), 0);
  const anyTabStillLoading = tabs.some((tab) => {
    const q = getOrdersForTab(tab.key);
    return q.isLoading;
  });

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">Todas las ordenes</h2>
            <p className="text-sm font-medium text-slate-500">
              {getTabCount(activeTab)} en {currentTab.label}
              {anyTabStillLoading ? " · …" : ""} · {totalOrders} total
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readOnly && (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-700 shadow-sm">
              Solo consulta
            </span>
          )}
          {!readOnly && onOpenMergeSplitTool && (
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 gap-1.5 rounded-2xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
              onClick={onOpenMergeSplitTool}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Mover Items/Mesa
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 flex items-start px-3 sm:px-5">
        <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto pb-2">
          <div className="inline-flex min-w-max flex-nowrap justify-start gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm">
            {tabs.map((tab) => {
              const q = getOrdersForTab(tab.key);
              const count = q.data?.length || 0;
              const isActive = activeTab === tab.key;
              const showBadgeSpinner = q.isLoading;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "relative h-9 shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 sm:h-10 sm:px-4 sm:text-sm",
                    isActive && "bg-white text-slate-900 shadow-sm",
                  )}
                  aria-label={tab.label}
                >
                  <span className="flex items-center gap-1 whitespace-nowrap sm:gap-2">
                    <span className="shrink-0 [&_svg]:h-3 [&_svg]:w-3 sm:[&_svg]:h-4 sm:[&_svg]:w-4">{tab.icon}</span>
                    <span className="text-left leading-tight">{tab.label}</span>
                    {showBadgeSpinner ? (
                      <span className="flex h-4 min-w-[18px] shrink-0 items-center justify-center sm:h-5 sm:min-w-[22px]">
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground sm:h-3.5 sm:w-3.5" aria-hidden />
                      </span>
                    ) : count > 0 ? (
                      <span className="ml-1.5 flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-slate-800 px-1 text-[10px] font-bold text-white sm:h-5 sm:min-w-[20px] sm:px-1.5">
                        {count}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid auto-rows-max grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {currentOrders.isLoading ? (
          <div className="col-span-full flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !currentOrders.data || currentOrders.data.length === 0 ? (
          <div className="col-span-full rounded-[28px] border border-dashed border-orange-200 bg-white/70 px-6 py-16 text-center shadow-[0_16px_36px_-34px_rgba(249,115,22,0.4)]">
            <ClipboardList className="mx-auto mb-3 h-12 w-12 text-orange-300" />
            <p className="font-display text-lg font-bold text-foreground">No hay ordenes para mostrar en {currentTab.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">Cuando existan movimientos en esta etapa, apareceran aqui.</p>
          </div>
        ) : (
          <div className="col-span-full flex flex-col gap-4 pb-12 px-3 sm:px-5">
            {currentOrders.data.map((order, index) => (
              <OrderListRow
                key={order.id}
                order={order}
                index={index}
                isExpanded={expandedOrderId === order.id}
                onToggleExpand={() => setExpandedOrderId((current) => current === order.id ? null : order.id)}
                onCancel={activeTab === "pendingCancellation" ? undefined : onCancelOrder}
                onApproveCancellation={activeTab === "pendingCancellation" ? (selectedOrder) => setApprovalTarget(selectedOrder) : undefined}
                onRejectCancel={activeTab === "pendingCancellation" ? (selectedOrder) => rejectCancellationRequestMutation.mutate({ orderId: selectedOrder.id }) : undefined}
                showCancelButton={false}
                showRejectButton={activeTab === "pendingCancellation" && canAuthorizeCancel && !readOnly}
                readOnly={readOnly}
                canAuthorizeCancel={canAuthorizeCancel}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!approvalTarget} onOpenChange={(open) => !open && setApprovalTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Autorizar anulacion</AlertDialogTitle>
            <AlertDialogDescription>
              {approvalTarget
                ? `Vas a autorizar la solicitud de anulacion de ${getOrderRef(approvalTarget.order_code, approvalTarget.order_number)}.`
                : "Confirma si deseas autorizar esta solicitud de anulacion."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveCancellationRequestMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={approveCancellationRequestMutation.isPending || !approvalTarget || !user?.id}
              onClick={(event) => {
                event.preventDefault();
                if (!approvalTarget || !user?.id) return;
                approveCancellationRequestMutation.mutate(
                  { orderId: approvalTarget.id, userId: user.id },
                  {
                    onSuccess: () => setApprovalTarget(null),
                  },
                );
              }}
            >
              {approveCancellationRequestMutation.isPending ? "Autorizando..." : "Confirmar autorizacion"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
