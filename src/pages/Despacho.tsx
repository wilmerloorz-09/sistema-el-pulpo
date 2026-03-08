import { useDispatchOrders } from "@/hooks/useDispatchOrders";
import { useMeseroOrderReadyNotification, OrderReadyNotificationBanner } from "@/hooks/useMeseroOrderReadyNotification";
import DispatchCard from "@/components/dispatch/DispatchCard";
import { Loader2, Truck, AlertCircle } from "lucide-react";
import { useState } from "react";

const Despacho = () => {
  console.log("🚚 Despacho: Component rendering");
  const { orders, isLoading, isError, markReady, markDispatched } = useDispatchOrders();
  const [notification, setNotification] = useState(null);

  console.log("🔍 Despacho: State", { 
    ordersCount: orders.length, 
    isLoading, 
    isError, 
    orders: orders.map(o => ({ id: o.id, status: o.status, order_code: o.order_code }))
  });

  // Listen for order ready notifications
  useMeseroOrderReadyNotification((_notification: any) => {
    setNotification(_notification);
  });

  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [markingDispatchedId, setMarkingDispatchedId] = useState<string | null>(null);

  const handleMarkReady = (orderId: string) => {
    setMarkingReadyId(orderId);
    markReady.mutate(orderId, {
      onSettled: () => setMarkingReadyId(null),
    });
  };

  const handleMarkDispatched = (orderId: string) => {
    setMarkingDispatchedId(orderId);
    markDispatched.mutate(orderId, {
      onSettled: () => setMarkingDispatchedId(null),
    });
  };

  if (isLoading) {
    console.log("⏳ Despacho: Showing loading spinner");
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    console.log("❌ Despacho: Showing error state");
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive/40 mb-3" />
        <p className="font-display text-lg font-bold text-foreground">Error al cargar órdenes</p>
        <p className="text-sm text-muted-foreground mt-1">
          No se pudieron cargar las órdenes para despacho. Intenta recargar la página.
        </p>
        <p className="text-xs text-muted-foreground mt-3 max-w-md">
          Si el problema persiste, revisa la consola del navegador (F12) para ver detalles del error.
        </p>
      </div>
    );
  }

  if (orders.length === 0) {
    console.log("📭 Despacho: No orders to show");
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <Truck className="h-12 w-12 text-muted-foreground/40 mb-3" />
        <p className="font-display text-lg font-bold text-foreground">Sin órdenes pendientes</p>
        <p className="text-sm text-muted-foreground mt-1">Las órdenes listas para despachar aparecerán aquí</p>
      </div>
    );
  }

  console.log("✅ Despacho: About to render orders list");

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold text-foreground">Despacho</h1>
        <span className="text-xs text-muted-foreground">({orders.length} pendientes)</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {orders.map((order, index) => {
          console.log(`🔍 Despacho: Rendering DispatchCard ${index + 1}/${orders.length}`, {
            id: order.id,
            order_code: order.order_code,
            status: order.status,
            items_count: order.items?.length || 0
          });
          return (
            <DispatchCard
              key={order.id}
              order={order}
              onMarkReady={handleMarkReady}
              onMarkDispatched={handleMarkDispatched}
              isMarkingReady={markingReadyId === order.id}
              isMarkingDispatched={markingDispatchedId === order.id}
            />
          );
        })}
      </div>

      <OrderReadyNotificationBanner notification={notification} duration={0} />
    </div>
  );
};

export default Despacho;
