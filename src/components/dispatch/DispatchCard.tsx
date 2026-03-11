import { useState } from "react";
import { DispatchCardBase } from "./DispatchCardBase";
import DispatchOrderDrawer from "./DispatchOrderDrawer";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";

interface DispatchCardProps {
  order: DispatchOrder;
  onOpenReadyDialog: (order: DispatchOrder) => void;
  onOpenDispatchDialog: (order: DispatchOrder) => void;
  readOnly?: boolean;
}

export default function DispatchCard({
  order,
  onOpenReadyDialog,
  onOpenDispatchDialog,
  readOnly = false,
}: DispatchCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <DispatchCardBase
        order={order}
        onOpenReadyDialog={onOpenReadyDialog}
        onOpenDispatchDialog={onOpenDispatchDialog}
        showEyeIcon={true}
        onEyeClick={() => setIsDrawerOpen(true)}
        readOnly={readOnly}
      />

      <DispatchOrderDrawer
        order={order}
        onOpenReadyDialog={onOpenReadyDialog}
        onOpenDispatchDialog={onOpenDispatchDialog}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        readOnly={readOnly}
      />
    </>
  );
}
