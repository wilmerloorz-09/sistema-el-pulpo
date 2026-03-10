import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrderDetailPanel from "./OrderDetailPanel";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderDetailDrawerProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

export default function OrderDetailDrawer({
  order,
  onCancel,
  open,
  onOpenChange,
  readOnly = false,
}: OrderDetailDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {order?.order_code ?? `#${order?.order_number}`}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <OrderDetailPanel
            order={order}
            onCancel={onCancel}
            showCancelButton={!readOnly}
            moduleType="orders"
            readOnly={readOnly}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
