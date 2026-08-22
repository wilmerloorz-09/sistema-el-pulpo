import { useEffect, useMemo, useState } from "react";
import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import type { DispatchView } from "@/hooks/useDispatchAccess";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { AlertCircle, Loader2, Package, RefreshCw, ShoppingBag, Zap } from "lucide-react";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";

const PACKING_SCOPE: DispatchView = "TAKEOUT";
type PackingView = "ALL" | "TAKEOUT" | "EXPRESS";

const PACKING_VIEWS: PackingView[] = ["ALL", "TAKEOUT", "EXPRESS"];

const PACKING_VIEW_LABELS: Record<PackingView, string> = {
  ALL: "Todas",
  TAKEOUT: "Para llevar",
  EXPRESS: "Express",
};

function resolveInitialPackingView(storageKey: string): PackingView {
  const saved = localStorage.getItem(storageKey);
  if (saved === "ALL" || saved === "TAKEOUT" || saved === "EXPRESS") return saved;
  return "ALL";
}

function getPackingViewIcon(view: PackingView) {
  if (view === "ALL") return Package;
  if (view === "EXPRESS") return Zap;
  return ShoppingBag;
}

const Empaquetador = () => {
  const { activeBranchId } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const { orders, isLoading, isError, isFetchingOrders, refetchOrders, markItemReady, sendOrderReadyAlert, dispatchItem, dispatchOrder } =
    useDispatchOrders(PACKING_SCOPE, { module: "packing" });
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);
  const storageKey = `packing:last-view:${activeBranchId ?? "global"}`;
  const [activeView, setActiveView] = useState<PackingView>(() => resolveInitialPackingView(storageKey));

  useEffect(() => {
    setActiveView(resolveInitialPackingView(storageKey));
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, activeView);
  }, [activeView, storageKey]);

  const counts = useMemo(() => ({
    ALL: orders.length,
    TAKEOUT: orders.filter((order) => order.order_type === "TAKEOUT").length,
    EXPRESS: orders.filter((order) => order.order_type === "EXPRESS").length,
  }), [orders]);

  const visibleOrders = useMemo(() => {
    if (activeView === "ALL") return orders;
    return orders.filter((order) => order.order_type === activeView);
  }, [activeView, orders]);

  const hasAccess = Boolean(shiftGateQuery.data?.isSupervisor) || Boolean(shiftGateQuery.data?.canPackOrders);
  const accessLoading = shiftGateQuery.isLoading && !shiftGateQuery.data;
  const pendingLabel = accessLoading || isLoading ? "..." : `${visibleOrders.length}`;

  return (
    <>
      <div className="mx-auto max-w-7xl px-2 py-4 sm:px-4 md:px-5 md:py-6 lg:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Empaquetador</h1>
              <p className="text-sm font-medium text-slate-500">
                {pendingLabel} ordenes Para llevar / Express pendientes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasAccess && !accessLoading && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isFetchingOrders) return;
                  void refetchOrders();
                }}
                disabled={isFetchingOrders}
                className="h-8 shrink-0 rounded-full border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {isFetchingOrders ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Actualizar
              </Button>
            )}
            <span className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
              Platos y otras categorias
            </span>
          </div>
        </div>

        {accessLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAccess ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <AlertCircle className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-display text-lg font-bold text-foreground">Empaquetador no disponible</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              No tienes habilitado el permiso de empaquetador para la jornada actual.
            </p>
          </div>
        ) : (
          <>
            <div className="scrollbar-none mb-6 overflow-x-auto pb-2">
              <ToggleGroup
                type="single"
                size="sm"
                value={activeView}
                onValueChange={(value) => {
                  if (!value) return;
                  setActiveView(value as PackingView);
                }}
                className="inline-flex min-w-max flex-nowrap justify-start gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm"
              >
                {PACKING_VIEWS.map((view) => {
                  const Icon = getPackingViewIcon(view);
                  const count = counts[view];

                  return (
                    <ToggleGroupItem
                      key={view}
                      value={view}
                      className="relative h-9 shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm sm:h-10 sm:px-4 sm:text-sm"
                      aria-label={PACKING_VIEW_LABELS[view]}
                    >
                      <span className="flex items-center gap-1 whitespace-nowrap sm:gap-2">
                        <Icon className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" />
                        <span className="text-left leading-tight">
                          {PACKING_VIEW_LABELS[view]}
                        </span>
                        {count > 0 && (
                          <span className="ml-1.5 flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-slate-800 px-1 text-[10px] font-bold text-white sm:h-5 sm:min-w-[20px] sm:px-1.5">
                            {count}
                          </span>
                        )}
                      </span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>

            {isError && visibleOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <AlertCircle className="mb-3 h-12 w-12 text-destructive/40" />
                <p className="font-display text-lg font-bold text-foreground">Error al cargar ordenes</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No se pudieron cargar las ordenes para empaquetar. Intenta recargar la pagina.
                </p>
              </div>
            ) : isLoading && visibleOrders.length === 0 ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : visibleOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <ShoppingBag className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeView === "ALL"
                    ? "Las ordenes Para llevar y Express listas para empaquetar apareceran aqui."
                    : `Las ordenes ${PACKING_VIEW_LABELS[activeView]} listas para empaquetar apareceran aqui.`}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 pb-12">
                {visibleOrders.map((order, index) => (
                  <DispatchCard
                    key={order.card_id}
                    order={order}
                    index={index}
                    onMarkOrderReady={(currentOrder) => {
                      if (currentOrder.order_type === "TAKEOUT" || currentOrder.is_special) {
                        dispatchOrder.mutate({ orderId: currentOrder.id });
                        return;
                      }

                      sendOrderReadyAlert.mutate({ orderId: currentOrder.id });
                    }}
                    onMarkItemReady={(_, item, qty) => {
                      markItemReady.mutate({ orderId: order.id, itemId: item.id, qty });
                    }}
                    onDispatchItem={(_, item, qty) => {
                      dispatchItem.mutate({ orderId: order.id, item, qty });
                    }}
                    onDispatchAll={(currentOrder) => {
                      setDispatchingOrderId(currentOrder.id);
                      dispatchOrder.mutate(
                        { orderId: currentOrder.id },
                        { onSettled: () => setDispatchingOrderId(null) },
                      );
                    }}
                    isMarkingOrderReady={
                      (sendOrderReadyAlert.isPending && sendOrderReadyAlert.variables?.orderId === order.id) ||
                      (dispatchOrder.isPending && dispatchOrder.variables?.orderId === order.id && dispatchingOrderId !== order.id)
                    }
                    isMarkingReady={markItemReady.isPending && markItemReady.variables?.orderId === order.id}
                    isDispatching={dispatchItem.isPending && dispatchItem.variables?.orderId === order.id}
                    isDispatchingOrder={dispatchOrder.isPending && dispatchingOrderId === order.id}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default Empaquetador;
