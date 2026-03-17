import { useEffect, useState } from "react";
import { useDispatchOrders, type DispatchOrder } from "@/hooks/useDispatchOrders";
import { useDispatchAccess, type DispatchView } from "@/hooks/useDispatchAccess";
import { useMeseroOrderReadyNotification, OrderReadyNotificationBanner } from "@/hooks/useMeseroOrderReadyNotification";
import DispatchCard from "@/components/dispatch/DispatchCard";
import OperationDialog from "@/components/order/OperationDialog";
import { Loader2, Truck, AlertCircle, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBranch } from "@/contexts/BranchContext";

function resolveInitialView(availableViews: DispatchView[], storageKey: string): DispatchView | null {
  if (availableViews.length === 0) return null;

  const saved = localStorage.getItem(storageKey);
  if ((saved === "ALL" || saved === "TABLE" || saved === "TAKEOUT") && availableViews.includes(saved as DispatchView)) {
    return saved;
  }

  if (availableViews.includes("ALL")) return "ALL";
  return availableViews.includes("TABLE") ? "TABLE" : availableViews[0];
}

function getViewIcon(view: DispatchView) {
  if (view === "ALL") return Truck;
  return view === "TABLE" ? UtensilsCrossed : ShoppingBag;
}

const Despacho = () => {
  const { activeBranchId } = useBranch();
  const { availableViews, showTabs, hasAccess, isLoading: accessLoading, getViewLabel, canOperateView } = useDispatchAccess();
  const [notification, setNotification] = useState(null);
  const [readyOrder, setReadyOrder] = useState<DispatchOrder | null>(null);
  const [dispatchOrder, setDispatchOrder] = useState<DispatchOrder | null>(null);
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
  const { orders, isLoading, isError, applyReadyOperation, applyDispatchOperation } = useDispatchOrders(scope);

  useMeseroOrderReadyNotification((_notification: any) => {
    setNotification(_notification);
  });

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
      <div className="p-4">
        <div className="surface-glow mb-4 px-5 py-4">
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
          <div className="mb-4 flex justify-start">
            <ToggleGroup
              type="single"
              value={scope}
              onValueChange={(value) => {
                if (!value) return;
                setActiveView(value as DispatchView);
              }}
              className="rounded-2xl border border-border bg-muted/50 p-1.5 shadow-sm"
            >
              {availableViews.map((view) => (
                (() => {
                  const Icon = getViewIcon(view);
                  return (
                    <ToggleGroupItem
                      key={view}
                      value={view}
                      className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:bg-background/70 hover:text-foreground data-[state=on]:border data-[state=on]:border-primary/20 data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm"
                      aria-label={getViewLabel(view)}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{getViewLabel(view)}</span>
                      </span>
                    </ToggleGroupItem>
                  );
                })()
              ))}
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
          <div className="grid auto-rows-max grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {orders.map((order) => (
              <DispatchCard
                key={order.card_id}
                order={order}
                onOpenReadyDialog={setReadyOrder}
                onOpenDispatchDialog={setDispatchOrder}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}

        <OrderReadyNotificationBanner notification={notification} duration={0} />
      </div>

      <OperationDialog
        open={!!readyOrder}
        onOpenChange={(open) => !open && setReadyOrder(null)}
        order={readyOrder}
        mode="ready"
        processing={applyReadyOperation.isPending}
        onConfirm={(payload) => {
          applyReadyOperation.mutate(payload, {
            onSuccess: () => setReadyOrder(null),
          });
        }}
      />

      <OperationDialog
        open={!!dispatchOrder}
        onOpenChange={(open) => !open && setDispatchOrder(null)}
        order={dispatchOrder}
        mode="dispatch"
        processing={applyDispatchOperation.isPending}
        onConfirm={(payload) => {
          applyDispatchOperation.mutate(payload, {
            onSuccess: () => setDispatchOrder(null),
          });
        }}
      />
    </>
  );
};

export default Despacho;

