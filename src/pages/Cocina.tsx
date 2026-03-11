import { useKitchenOrders, type KitchenOrder } from "@/hooks/useKitchenOrders";
import KitchenCard from "@/components/kitchen/KitchenCard";
import OperationDialog from "@/components/order/OperationDialog";
import { Loader2, ChefHat } from "lucide-react";
import { useState } from "react";

const Cocina = () => {
  const { orders, isLoading, applyReadyOperation } = useKitchenOrders();
  const [selectedOrder, setSelectedOrder] = useState<KitchenOrder | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <ChefHat className="mb-3 h-12 w-12 text-muted-foreground/40" />
        <p className="font-display text-lg font-bold text-foreground">Sin ordenes pendientes</p>
        <p className="mt-1 text-sm text-muted-foreground">Las ordenes enviadas a cocina apareceran aqui</p>
      </div>
    );
  }

  return (
    <>
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-primary" />
          <h1 className="font-display text-lg font-bold text-foreground">Cocina</h1>
          <span className="text-xs text-muted-foreground">({orders.length} pendientes)</span>
        </div>
        <div className="grid auto-rows-max grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {orders.map((order) => (
            <KitchenCard key={order.card_id} order={order} onOpenReadyDialog={setSelectedOrder} />
          ))}
        </div>
      </div>

      <OperationDialog
        open={!!selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        order={selectedOrder}
        mode="ready"
        processing={applyReadyOperation.isPending}
        onConfirm={(payload) => {
          applyReadyOperation.mutate(payload, {
            onSuccess: () => setSelectedOrder(null),
          });
        }}
      />
    </>
  );
};

export default Cocina;

