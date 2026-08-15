import { useState } from "react";
import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import type { DispatchView } from "@/hooks/useDispatchAccess";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { AlertCircle, Loader2, Package, ShoppingBag } from "lucide-react";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

const PACKING_SCOPE: DispatchView = "TAKEOUT";

const Empaquetador = () => {
  const shiftGateQuery = useBranchShiftGate();
  const { orders, isLoading, isError, markItemReady, sendOrderReadyAlert, dispatchItem, dispatchOrder } =
    useDispatchOrders(PACKING_SCOPE, { module: "packing" });
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);

  const hasAccess = Boolean(shiftGateQuery.data?.isSupervisor) || Boolean(shiftGateQuery.data?.canPackOrders);
  const accessLoading = shiftGateQuery.isLoading && !shiftGateQuery.data;
  const pendingLabel = accessLoading || isLoading ? "..." : `${orders.length}`;

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
          <span className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
            Platos y otras categorias
          </span>
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
        ) : isError && orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <AlertCircle className="mb-3 h-12 w-12 text-destructive/40" />
            <p className="font-display text-lg font-bold text-foreground">Error al cargar ordenes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No se pudieron cargar las ordenes para empaquetar. Intenta recargar la pagina.
            </p>
          </div>
        ) : isLoading && orders.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <ShoppingBag className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Las ordenes Para llevar y Express listas para empaquetar apareceran aqui.
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
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default Empaquetador;
