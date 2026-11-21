import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Package, RefreshCw, ShoppingBag, Zap } from "lucide-react";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDispatchOrders, type DispatchOrder } from "@/hooks/useDispatchOrders";
import type { DispatchView } from "@/hooks/useDispatchAccess";
import { cn } from "@/lib/utils";

const PACKING_SCOPE: DispatchView = "ALL";
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

type Props = {
  branchId: string;
  selectedOrderId: string | null;
  onSelectOrder: (order: DispatchOrder) => void;
};

/** Cola de Empaquetador adaptada a la primera columna de Extra Empaquetador. */
export default function ExtraEmpaquetadorPackingPanel({
  branchId,
  selectedOrderId,
  onSelectOrder,
}: Props) {
  const {
    orders,
    isLoading,
    isError,
    isFetchingOrders,
    refetchOrders,
    markItemReady,
    sendOrderReadyAlert,
    dispatchItem,
    dispatchOrder,
  } = useDispatchOrders(PACKING_SCOPE, { module: "packing" });

  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);
  const storageKey = `extra-packing:last-view:${branchId}`;
  const [activeView, setActiveView] = useState<PackingView>(() => resolveInitialPackingView(storageKey));

  useEffect(() => {
    setActiveView(resolveInitialPackingView(storageKey));
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, activeView);
  }, [activeView, storageKey]);

  const counts = useMemo(
    () => ({
      ALL: orders.length,
      TAKEOUT: orders.filter(
        (order) => order.order_type === "TAKEOUT" || order.is_table_envase_packing,
      ).length,
      EXPRESS: orders.filter((order) => order.order_type === "EXPRESS").length,
    }),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    if (activeView === "ALL") return orders;
    if (activeView === "TAKEOUT") {
      return orders.filter(
        (order) => order.order_type === "TAKEOUT" || order.is_table_envase_packing,
      );
    }
    return orders.filter((order) => order.order_type === activeView);
  }, [activeView, orders]);

  const pendingLabel = isLoading ? "..." : `${visibleOrders.length}`;

  return (
    <section className="extra-panel extra-packing-panel" aria-label="Empaquetador">
      <div className="extra-packing-head">
        <div className="extra-packing-title">
          <span className="extra-packing-title-icon" aria-hidden>
            <Package size={18} />
          </span>
          <div>
            <strong>Empaquetador</strong>
            <small>
              {pendingLabel} {visibleOrders.length === 1 ? "orden" : "órdenes"} Para llevar / Express /
              Con envase mesa
            </small>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (isFetchingOrders) return;
            void refetchOrders();
          }}
          disabled={isFetchingOrders}
          className="h-8 shrink-0 rounded-full border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          {isFetchingOrders ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="extra-packing-filters">
        <ToggleGroup
          type="single"
          size="sm"
          value={activeView}
          onValueChange={(value) => {
            if (!value) return;
            setActiveView(value as PackingView);
          }}
          className="inline-flex min-w-max flex-nowrap justify-start gap-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-1 shadow-sm"
        >
          {PACKING_VIEWS.map((view) => {
            const Icon = getPackingViewIcon(view);
            const count = counts[view];
            return (
              <ToggleGroupItem
                key={view}
                value={view}
                className="relative h-8 shrink-0 rounded-xl px-2 py-1 text-[11px] font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm"
                aria-label={PACKING_VIEW_LABELS[view]}
              >
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="leading-tight">{PACKING_VIEW_LABELS[view]}</span>
                  {count > 0 ? (
                    <span className="ml-0.5 flex h-4 min-w-[14px] shrink-0 items-center justify-center rounded-full bg-slate-800 px-1 text-[9px] font-bold text-white">
                      {count}
                    </span>
                  ) : null}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <div className="extra-packing-list">
        {isError && visibleOrders.length === 0 ? (
          <div className="extra-packing-empty">
            <AlertCircle className="mb-2 h-10 w-10 text-destructive/40" />
            <p className="font-display text-sm font-bold text-foreground">Error al cargar órdenes</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No se pudieron cargar las órdenes para empaquetar.
            </p>
          </div>
        ) : isLoading && visibleOrders.length === 0 ? (
          <div className="extra-packing-empty">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="extra-packing-empty">
            <ShoppingBag className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="font-display text-sm font-bold text-foreground">Sin ordenes pendientes</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeView === "ALL"
                ? "Las ordenes Para llevar y Express listas para empaquetar apareceran aqui."
                : `Las ordenes ${PACKING_VIEW_LABELS[activeView]} listas para empaquetar apareceran aqui.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleOrders.map((order, index) => {
              const selected = order.id === selectedOrderId;
              return (
                <div
                  key={order.card_id}
                  className={cn("extra-packing-card", selected && "is-selected")}
                  onClick={() => onSelectOrder(order)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectOrder(order);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                >
                  <DispatchCard
                    order={order}
                    index={index}
                    variant="simple"
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
                      (sendOrderReadyAlert.isPending
                        && sendOrderReadyAlert.variables?.orderId === order.id)
                      || (dispatchOrder.isPending
                        && dispatchOrder.variables?.orderId === order.id
                        && dispatchingOrderId !== order.id)
                    }
                    isMarkingReady={
                      markItemReady.isPending && markItemReady.variables?.orderId === order.id
                    }
                    isDispatching={
                      dispatchItem.isPending && dispatchItem.variables?.orderId === order.id
                    }
                    isDispatchingOrder={
                      dispatchOrder.isPending && dispatchingOrderId === order.id
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
