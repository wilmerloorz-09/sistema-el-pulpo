import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DispatchCardBase from "./DispatchCardBase";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";

interface DispatchOrderDrawerProps {
  order: DispatchOrder;
  onOpenReadyDialog: (order: DispatchOrder) => void;
  onOpenDispatchDialog: (order: DispatchOrder) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

export default function DispatchOrderDrawer({
  order,
  onOpenReadyDialog,
  onOpenDispatchDialog,
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
            onOpenReadyDialog={onOpenReadyDialog}
            onOpenDispatchDialog={onOpenDispatchDialog}
            showEyeIcon={false}
            readOnly={readOnly}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
