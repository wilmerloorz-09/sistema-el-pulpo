import { useState } from "react";
import { DispatchCardBase } from "./DispatchCardBase";
import DispatchOrderDrawer from "./DispatchOrderDrawer";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";

interface DispatchCardProps {
  order: DispatchOrder;
  onMarkReady: (orderId: string) => void;
  onMarkDispatched: (orderId: string) => void;
  isMarkingReady: boolean;
  isMarkingDispatched: boolean;
  readOnly?: boolean;
}

export default function DispatchCard({
  order,
  onMarkReady,
  onMarkDispatched,
  isMarkingReady,
  isMarkingDispatched,
  readOnly = false,
}: DispatchCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <DispatchCardBase
        order={order}
        onMarkReady={onMarkReady}
        onMarkDispatched={onMarkDispatched}
        isMarkingReady={isMarkingReady}
        isMarkingDispatched={isMarkingDispatched}
        showEyeIcon={true}
        onEyeClick={() => setIsDrawerOpen(true)}
        readOnly={readOnly}
      />

      <DispatchOrderDrawer
        order={order}
        onMarkReady={onMarkReady}
        onMarkDispatched={onMarkDispatched}
        isMarkingReady={isMarkingReady}
        isMarkingDispatched={isMarkingDispatched}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        readOnly={readOnly}
      />
    </>
  );
}
