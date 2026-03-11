import { useEffect, useState } from "react";
import { useDispatchOrders, type DispatchOrder } from "@/hooks/useDispatchOrders";
import { useDispatchAccess, type DispatchView } from "@/hooks/useDispatchAccess";
import { useMeseroOrderReadyNotification, OrderReadyNotificationBanner } from "@/hooks/useMeseroOrderReadyNotification";
import DispatchCard from "@/components/dispatch/DispatchCard";
import OperationDialog from "@/components/order/OperationDialog";
import { Loader2, Truck, AlertCircle } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBranch } from "@/contexts/BranchContext";

function resolveInitialView(availableViews: DispatchView[], storageKey: string): DispatchView | null {
  if (availableViews.length === 0) return null;

  const saved = localStorage.getItem(storageKey);
  if ((saved === "TABLE" || saved === "TAKEOUT") && availableViews.includes(saved)) {
    return saved;
  }

  return availableViews.includes("TABLE") ? "TABLE" : availableViews[0];
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
        <div className="mb-4 flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h1 className="font-display text-lg font-bold text-foreground">Despacho</h1>
          <span className="text-xs text-muted-foreground">({orders.length} pendientes)</span>
          {!showTabs && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Vista: {getViewLabel(scope)}
            </span>
          )}
          {readOnly && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Solo consulta
            </span>
          )}
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
              className="rounded-xl border border-border bg-muted/40 p-1"
            >
              {availableViews.map((view) => (
                <ToggleGroupItem
                  key={view}
                  value={view}
                  className="rounded-lg px-4 py-2 text-sm font-medium data-[state=on]:bg-background data-[state=on]:text-foreground"
                  aria-label={getViewLabel(view)}
                >
                  {getViewLabel(view)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <Truck className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Las ordenes de {getViewLabel(scope).toLowerCase()} listas para despachar apareceran aqui
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

