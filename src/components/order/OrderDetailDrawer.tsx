import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrderDetailPanel from "./OrderDetailPanel";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderDetailDrawerProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function OrderDetailDrawer({
  order,
  onCancel,
  open,
  onOpenChange,
}: OrderDetailDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {order?.order_code ?? `#${order?.order_number}`}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <OrderDetailPanel
            order={order}
            onCancel={onCancel}
            showCancelButton={true}
            moduleType="orders"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
