import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DispatchCardBase from "./DispatchCardBase";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";

interface DispatchOrderDrawerProps {
  order: DispatchOrder;
  onMarkReady: (orderId: string) => void;
  onMarkDispatched: (orderId: string) => void;
  isMarkingReady: boolean;
  isMarkingDispatched: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

export default function DispatchOrderDrawer({
  order,
  onMarkReady,
  onMarkDispatched,
  isMarkingReady,
  isMarkingDispatched,
  open,
  onOpenChange,
  readOnly = false,
}: DispatchOrderDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {order?.order_code ?? `#${order?.order_number}`}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <DispatchCardBase
            order={order}
            onMarkReady={onMarkReady}
            onMarkDispatched={onMarkDispatched}
            isMarkingReady={isMarkingReady}
            isMarkingDispatched={isMarkingDispatched}
            showEyeIcon={false}
            readOnly={readOnly}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
