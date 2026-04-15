import { useEffect, useState } from "react";
import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import { useDispatchAccess, type DispatchView } from "@/hooks/useDispatchAccess";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { Loader2, Truck, AlertCircle, ShoppingBag, UtensilsCrossed, CreditCard } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBranch } from "@/contexts/BranchContext";

function resolveInitialView(availableViews: DispatchView[], storageKey: string): DispatchView | null {
  if (availableViews.length === 0) return null;

  const saved = localStorage.getItem(storageKey);
  if ((saved === "ALL" || saved === "TABLE" || saved === "SPECIAL" || saved === "TAKEOUT") && availableViews.includes(saved as DispatchView)) {
    return saved;
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

const Despacho = () => {
  const { activeBranchId } = useBranch();
  const { availableViews, showTabs, hasAccess, isLoading: accessLoading, getViewLabel, canOperateView } = useDispatchAccess();
  const [activeView, setActiveView] = useState<DispatchView | null>(null);
  const storageKey = `dispatch:last-view:${activeBranchId ?? "global"}`;

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
    const { orders, counts, isLoading, isError, markItemReady, sendOrderReadyAlert, dispatchItem } = useDispatchOrders(scope);

  if (accessLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess || !resolvedView) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <AlertCircle className="mb-3 h-12 w-12 text-muted-foreground/40" />
        <p className="font-display text-lg font-bold text-foreground">Despacho no disponible</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          No tienes una vista valida de despacho para la configuracion actual de la jornada.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <AlertCircle className="mb-3 h-12 w-12 text-destructive/40" />
        <p className="font-display text-lg font-bold text-foreground">Error al cargar ordenes</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No se pudieron cargar las ordenes para despacho. Intenta recargar la pagina.
        </p>
      </div>
    );
  }

  const readOnly = !canOperateView(scope);

  return (
    <>
      <div className="px-2 py-3 sm:px-4 md:px-5 md:py-4 lg:px-6">
        <div className="surface-glow mb-4 px-3 py-3 sm:px-5 sm:py-4">
          <div className="relative flex flex-wrap items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
              <Truck className="h-5 w-5" />
            </div>
            <h1 className="font-display text-lg font-bold text-foreground">Despacho</h1>
            <span className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-xs text-muted-foreground shadow-sm">({orders.length} pendientes)</span>
            {!showTabs && (
              <span className="rounded-full border border-border bg-white/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                Vista: {getViewLabel(scope)}
              </span>
            )}
            {readOnly && (
              <span className="rounded-full border border-border bg-white/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                Solo consulta
              </span>
            )}
          </div>
        </div>

        {showTabs && (
          <div className="scrollbar-none mb-4 overflow-x-auto">
            <ToggleGroup
              type="single"
              size="sm"
              value={scope}
              onValueChange={(value) => {
                if (!value) return;
                setActiveView(value as DispatchView);
              }}
              className="inline-flex min-w-max flex-nowrap justify-start gap-0.5 rounded-2xl border border-border bg-muted/50 p-1 shadow-sm"
            >
              {availableViews.map((view) => {
                const Icon = getViewIcon(view);
                const count = counts[view as keyof typeof counts] || 0;
                
                return (
                  <ToggleGroupItem
                    key={view}
                    value={view}
                    className="relative h-8 shrink-0 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-all hover:bg-background/70 hover:text-foreground data-[state=on]:border data-[state=on]:border-primary/20 data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm sm:h-10 sm:px-4 sm:py-2.5 sm:text-sm"
                    aria-label={getViewLabel(view)}
                  >
                    <span className="flex items-center gap-1 whitespace-nowrap sm:gap-2">
                      <Icon className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" />
                      <span className="text-left leading-tight">
                        {getViewLabel(view)}
                      </span>
                      {count > 0 && (
                        <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white shadow-[0_0_10px_rgba(249,115,22,0.4)] animate-in zoom-in duration-300 sm:h-5 sm:min-w-[20px] sm:px-1.5 sm:text-[10px]">
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

        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <Truck className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {scope === "ALL"
                ? "Las ordenes listas para despachar apareceran aqui"
                : `Las ordenes de ${getViewLabel(scope).toLowerCase()} listas para despachar apareceran aqui`}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_55px_-42px_rgba(15,23,42,0.34)]">
            <div className="divide-y divide-slate-200">
              {orders.map((order, index) => (
                <DispatchCard
                  key={order.card_id}
                  order={order}
                  index={index}
                  onMarkOrderReady={(currentOrder) => {
                    sendOrderReadyAlert.mutate({
                      orderId: currentOrder.id,
                    });
                  }}
                  onMarkItemReady={(_, item, qty) => {
                    markItemReady.mutate({ orderId: order.id, itemId: item.id, qty });
                  }}
                  onDispatchItem={(_, item, qty) => {
                    dispatchItem.mutate({ orderId: order.id, itemId: item.id, qty });
                  }}
                  isMarkingOrderReady={sendOrderReadyAlert.isPending}
                  isMarkingReady={markItemReady.isPending}
                  isDispatching={dispatchItem.isPending}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Despacho;

