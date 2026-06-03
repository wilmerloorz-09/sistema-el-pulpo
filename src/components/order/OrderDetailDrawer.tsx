import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getOrderRef } from "@/lib/orderPresentation";
import OrderDetailPanel from "./OrderDetailPanel";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderDetailDrawerProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  onApproveCancellation?: (order: OrderSummary) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

export default function OrderDetailDrawer({
  order,
  onCancel,
  onApproveCancellation,
  open,
  onOpenChange,
  readOnly = false,
}: OrderDetailDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {getOrderRef(order?.order_code, order?.order_number)}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <OrderDetailPanel
            order={order}
            onCancel={onCancel}
            onApproveCancellation={onApproveCancellation}
            showCancelButton={!readOnly}
            moduleType="orders"
            readOnly={readOnly}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
