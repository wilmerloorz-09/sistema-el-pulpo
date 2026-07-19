import { useEffect, useState } from "react";
import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import { useDispatchAccess, type DispatchView } from "@/hooks/useDispatchAccess";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { Loader2, ConciergeBell, AlertCircle, ShoppingBag, UtensilsCrossed, CreditCard, Truck } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBranch } from "@/contexts/BranchContext";

function resolveInitialView(availableViews: DispatchView[], storageKey: string): DispatchView | null {
  if (availableViews.length === 0) return null;

  const saved = localStorage.getItem(storageKey);
  const normalizedSaved = saved === "EXPRESS" ? "TAKEOUT" : saved;
  if (
    (normalizedSaved === "ALL" || normalizedSaved === "TABLE" || normalizedSaved === "SPECIAL" || normalizedSaved === "TAKEOUT")
    && availableViews.includes(normalizedSaved as DispatchView)
  ) {
    return normalizedSaved as DispatchView;
  }

  if (availableViews.includes("ALL")) return "ALL";
  return availableViews.includes("TABLE") ? "TABLE" : availableViews[0];
}

function getViewIcon(view: DispatchView) {
  if (view === "ALL") return Truck;
  if (view === "TABLE") return UtensilsCrossed;
  if (view === "SPECIAL") return CreditCard;
  return ShoppingBag;
}

const Servir = () => {
  const { activeBranchId } = useBranch();
  const { availableViews, showTabs, hasAccess, isLoading: accessLoading, getViewLabel, canOperateView } = useDispatchAccess();
  const [activeView, setActiveView] = useState<DispatchView | null>(null);
  const storageKey = `servir:last-view:${activeBranchId ?? "global"}`;

  useEffect(() => {
    const nextView = resolveInitialView(availableViews, storageKey);
    setActiveView((current) => {
      if (current && availableViews.includes(current)) return current;
      return nextView;
    });
  }, [availableViews, storageKey]);

  useEffect(() => {
    if (activeView) {
      localStorage.setItem(storageKey, activeView);
    }
  }, [activeView, storageKey]);

  const resolvedView = activeView && availableViews.includes(activeView) ? activeView : resolveInitialView(availableViews, storageKey);
  const scope = resolvedView ?? "TABLE";
  const { orders, counts, isLoading, isError, markItemReady, sendOrderReadyAlert, dispatchItem, dispatchOrder } =
    useDispatchOrders(scope, { module: "servir" });
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);

  const readOnly = !accessLoading && hasAccess && Boolean(resolvedView) && !canOperateView(scope);
  const canShowMain = !accessLoading && hasAccess && Boolean(resolvedView);
  const pendingLabel = accessLoading ? "…" : `${orders.length}`;

  return (
    <>
      <div className="mx-auto max-w-7xl px-2 py-4 sm:px-4 md:px-5 md:py-6 lg:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
              <ConciergeBell className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Servir</h1>
              <p className="text-sm font-medium text-slate-500">
                {pendingLabel} órdenes pendientes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canShowMain && !showTabs && (
              <span className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                Vista: {getViewLabel(scope)}
              </span>
            )}
            {readOnly && (
              <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-700 shadow-sm">
                <AlertCircle className="h-3.5 w-3.5" />
                Solo consulta
              </span>
            )}
          </div>
        </div>

        {accessLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAccess || !resolvedView ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <AlertCircle className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-display text-lg font-bold text-foreground">Servir no disponible</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              No tienes una vista valida de servir para la configuracion actual de la jornada.
            </p>
          </div>
        ) : (
          <>
            {showTabs && (
              <div className="scrollbar-none mb-6 overflow-x-auto pb-2">
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={scope}
                  onValueChange={(value) => {
                    if (!value) return;
                    setActiveView(value as DispatchView);
                  }}
                  className="inline-flex min-w-max flex-nowrap justify-start gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm"
                >
                  {availableViews.map((view) => {
                    const Icon = getViewIcon(view);
                    const count = counts[view as keyof typeof counts] || 0;

                    return (
                      <ToggleGroupItem
                        key={view}
                        value={view}
                        className="relative h-9 shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm sm:h-10 sm:px-4 sm:text-sm"
                        aria-label={getViewLabel(view)}
                      >
                        <span className="flex items-center gap-1 whitespace-nowrap sm:gap-2">
                          <Icon className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" />
                          <span className="text-left leading-tight">
                            {getViewLabel(view)}
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
            )}

            {isError && orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <AlertCircle className="mb-3 h-12 w-12 text-destructive/40" />
                <p className="font-display text-lg font-bold text-foreground">Error al cargar ordenes</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No se pudieron cargar las ordenes para servir. Intenta recargar la pagina.
                </p>
              </div>
            ) : isLoading && orders.length === 0 ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <ConciergeBell className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {scope === "ALL"
                    ? "Las ordenes listas para servir apareceran aqui"
                    : `Las ordenes de ${getViewLabel(scope).toLowerCase()} listas para servir apareceran aqui`}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 pb-12">
                {orders.map((order, index) => (
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
                      readOnly={readOnly}
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

export default Servir;
