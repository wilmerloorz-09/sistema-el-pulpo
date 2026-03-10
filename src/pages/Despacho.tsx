import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import { useMeseroOrderReadyNotification, OrderReadyNotificationBanner } from "@/hooks/useMeseroOrderReadyNotification";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { Loader2, Truck, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";

const Despacho = () => {
  const { permissions } = useBranch();
  const { orders, isLoading, isError, markReady, markDispatched } = useDispatchOrders();
  const [notification, setNotification] = useState(null);

  const canOperateDispatch =
    canOperate(permissions, "despacho_total") ||
    canOperate(permissions, "despacho_mesa") ||
    canOperate(permissions, "despacho_para_llevar");

  useMeseroOrderReadyNotification((_notification: any) => {
    setNotification(_notification);
  });

  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [markingDispatchedId, setMarkingDispatchedId] = useState<string | null>(null);

  const handleMarkReady = (orderId: string) => {
    if (!canOperateDispatch) return;
    setMarkingReadyId(orderId);
    markReady.mutate(orderId, {
      onSettled: () => setMarkingReadyId(null),
    });
  };

  const handleMarkDispatched = (orderId: string) => {
    if (!canOperateDispatch) return;
    setMarkingDispatchedId(orderId);
    markDispatched.mutate(orderId, {
      onSettled: () => setMarkingDispatchedId(null),
    });
  };

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

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <Truck className="mb-3 h-12 w-12 text-muted-foreground/40" />
        <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
        <p className="mt-1 text-sm text-muted-foreground">Las ordenes listas para despachar apareceran aqui</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <Truck className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold text-foreground">Despacho</h1>
        <span className="text-xs text-muted-foreground">({orders.length} pendientes)</span>
        {!canOperateDispatch && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Solo consulta
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {orders.map((order) => (
          <DispatchCard
            key={order.id}
            order={order}
            onMarkReady={handleMarkReady}
            onMarkDispatched={handleMarkDispatched}
            isMarkingReady={markingReadyId === order.id}
            isMarkingDispatched={markingDispatchedId === order.id}
            readOnly={!canOperateDispatch}
          />
        ))}
      </div>

      <OrderReadyNotificationBanner notification={notification} duration={0} />
    </div>
  );
};

export default Despacho;
