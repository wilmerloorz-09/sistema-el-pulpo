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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Loader2, ClipboardList, Clock, Truck, Ban, CircleDollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
    key: "sent",
    label: "Enviadas",
    status: "SENT_TO_KITCHEN",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades que siguen pendientes por preparar.",
    icon: <Clock className="h-4 w-4" />,
  },
  {
    key: "draft",
    label: "Borradores",
    status: "DRAFT",
    showCancel: true,
    helperText: "Aqui ves las ordenes que aun no han sido enviadas a cocina.",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    key: "dispatched",
    label: "Despachadas",
    status: "KITCHEN_DISPATCHED",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades de mesa que ya fueron despachadas, aunque la linea original haya sido mayor.",
    icon: <Truck className="h-4 w-4" />,
  },
  {
    key: "pendingCancellation",
    label: "Pendiente de anulacion",
    status: "PENDING_CANCELLATION",
    showCancel: true,
    helperText: "Aqui ves las ordenes cuya anulacion fue solicitada y aun esperan autorizacion.",
    icon: <Ban className="h-4 w-4" />,
  },
  {
    key: "cancelled",
    label: "Canceladas",
    status: "CANCELLED",
    showCancel: false,
    helperText: "Aqui ves las cantidades anuladas y tambien las ordenes para llevar ya despachadas.",
    icon: <Ban className="h-4 w-4" />,
  },
  {
    key: "paid",
    label: "Pagadas",
    status: "PAID",
    showCancel: false,
    helperText: "Aqui ves las ordenes ya cerradas para cobro.",
    icon: <CircleDollarSign className="h-4 w-4" />,
  },
];

interface OrdersListProps {
  onCancelOrder?: (order: OrderSummary) => void;
  readOnly?: boolean;
}

export default function OrdersList({ onCancelOrder, readOnly = false }: OrdersListProps) {
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

    const invalidateOrders = () => {
      qc.invalidateQueries({ queryKey: ["orders", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    };

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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_ready_events",
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_dispatch_events",
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_dispatch_events",
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_cancellations",
        },
        invalidateOrders,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_item_cancellations",
        },
        invalidateOrders,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeBranchId, qc]);

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

  return (
    <div className="w-full">
      <div className="surface-glow mb-5 px-3 py-3">
        <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
              <ClipboardList className="h-5 w-5" />
            </div>
            <h2 className="font-display text-xl font-black text-foreground">Todas las ordenes</h2>
            <span className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-xs text-muted-foreground shadow-sm">
              {totalOrders} total
            </span>
            {readOnly && (
              <span className="rounded-full border border-border bg-white/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                Solo consulta
              </span>
            )}
          </div>

          <div className="flex-1">
            <div className="md:hidden">
              <Select value={activeTab} onValueChange={(value) => setActiveTab(value as TabType)}>
                <SelectTrigger className="h-12 rounded-[22px] border-orange-200 bg-white/92 px-4 shadow-[0_18px_45px_-36px_rgba(249,115,22,0.5)]">
                  <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                    <span className="shrink-0 text-primary">{currentTab.icon}</span>
                    <span className="truncate text-sm font-semibold text-foreground">{currentTab.label}</span>
                    {getTabCount(currentTab.key) > 0 && (
                      <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {getTabCount(currentTab.key)}
                      </span>
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {tabs.map((tab) => {
                    const count = getTabCount(tab.key);

                    return (
                      <SelectItem key={tab.key} value={tab.key}>
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="truncate">{tab.label}</span>
                          {count > 0 && (
                            <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-primary">
                              {count}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden grid-cols-2 gap-2 rounded-[24px] border border-orange-200 bg-white/75 p-2 shadow-[0_18px_45px_-36px_rgba(249,115,22,0.5)] md:grid md:grid-cols-3 lg:grid-cols-6">
              {tabs.map((tab) => {
                const count = getTabCount(tab.key);
                const isActive = activeTab === tab.key;

                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all",
                      isActive
                        ? "bg-gradient-to-r from-orange-500 to-orange-400 text-white shadow-[0_16px_30px_-22px_rgba(249,115,22,0.95)]"
                        : "border border-transparent bg-white/70 text-muted-foreground hover:border-orange-200 hover:bg-orange-50 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {tab.icon}
                      <span>{tab.label}</span>
                    </div>
                    {count > 0 && (
                      <Badge variant={isActive ? "secondary" : "outline"} className={cn("h-6 px-2 text-xs", isActive ? "border-white/30 bg-white/20 text-white" : "border-orange-200 bg-white text-primary")}>
                        {count}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
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
            <p className="font-display text-lg font-bold text-foreground">No hay ordenes {currentTab.label.toLowerCase()}</p>
            <p className="mt-1 text-sm text-muted-foreground">Cuando existan movimientos en esta etapa, apareceran aqui.</p>
          </div>
        ) : (
          <div className="col-span-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_55px_-42px_rgba(15,23,42,0.34)]">
            <div className="divide-y divide-slate-200">
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
                  showCancelButton={currentTab.showCancel && !readOnly}
                  showRejectButton={activeTab === "pendingCancellation" && canAuthorizeCancel && !readOnly}
                  readOnly={readOnly}
                  canAuthorizeCancel={canAuthorizeCancel}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!approvalTarget} onOpenChange={(open) => !open && setApprovalTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Autorizar anulacion</AlertDialogTitle>
            <AlertDialogDescription>
              {approvalTarget
                ? `Vas a autorizar la solicitud de anulacion de ${approvalTarget.order_code ?? `#${approvalTarget.order_number}`}.`
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
