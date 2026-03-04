import { useKitchenOrders } from "@/hooks/useKitchenOrders";
import KitchenCard from "@/components/kitchen/KitchenCard";
import { Loader2, ChefHat } from "lucide-react";
import { useState } from "react";

const Cocina = () => {
  const { orders, isLoading, dispatchItem, dispatchAll } = useKitchenOrders();
  const [dispatchingItemId, setDispatchingItemId] = useState<string | null>(null);
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);

  const handleDispatchItem = (itemId: string, orderId: string) => {
    setDispatchingItemId(itemId);
    dispatchItem.mutate({ itemId, orderId }, {
      onSettled: () => setDispatchingItemId(null),
    });
  };

  const handleDispatchAll = (orderId: string) => {
    setDispatchingOrderId(orderId);
    dispatchAll.mutate(orderId, {
      onSettled: () => setDispatchingOrderId(null),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <ChefHat className="h-12 w-12 text-muted-foreground/40 mb-3" />
        <p className="font-display text-lg font-bold text-foreground">Sin órdenes pendientes</p>
        <p className="text-sm text-muted-foreground mt-1">Las órdenes enviadas a cocina aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <ChefHat className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold text-foreground">Cocina</h1>
        <span className="text-xs text-muted-foreground">({orders.length} pendientes)</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {orders.map((order) => (
          <KitchenCard
            key={order.id}
            order={order}
            onDispatchItem={handleDispatchItem}
            onDispatchAll={handleDispatchAll}
            dispatchingItemId={dispatchingItemId}
            dispatchingAll={dispatchingOrderId === order.id}
          />
        ))}
      </div>
    </div>
  );
};

export default Cocina;
