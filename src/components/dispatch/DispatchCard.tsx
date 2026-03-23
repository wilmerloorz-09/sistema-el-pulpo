import { useState } from "react";
import { DispatchCardBase } from "./DispatchCardBase";
import DispatchOrderDrawer from "./DispatchOrderDrawer";
import type { DispatchOrder, DispatchOrderItem } from "@/hooks/useDispatchOrders";

interface DispatchCardProps {
  order: DispatchOrder;
  onMarkOrderReady: (order: DispatchOrder) => void;
  onMarkItemReady: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  onDispatchItem: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  isMarkingOrderReady?: boolean;
  isMarkingReady?: boolean;
  isDispatching?: boolean;
  readOnly?: boolean;
}

export default function DispatchCard({
  order,
  onMarkOrderReady,
  onMarkItemReady,
  onDispatchItem,
  isMarkingOrderReady = false,
  isMarkingReady = false,
  isDispatching = false,
  readOnly = false,
}: DispatchCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <DispatchCardBase
        order={order}
        onMarkOrderReady={onMarkOrderReady}
        onMarkItemReady={onMarkItemReady}
        onDispatchItem={onDispatchItem}
        isMarkingOrderReady={isMarkingOrderReady}
        isMarkingReady={isMarkingReady}
        isDispatching={isDispatching}
        showEyeIcon={true}
        onEyeClick={() => setIsDrawerOpen(true)}
        readOnly={readOnly}
      />

      <DispatchOrderDrawer
        order={order}
        onMarkOrderReady={onMarkOrderReady}
        onMarkItemReady={onMarkItemReady}
        onDispatchItem={onDispatchItem}
        isMarkingOrderReady={isMarkingOrderReady}
        isMarkingReady={isMarkingReady}
        isDispatching={isDispatching}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        readOnly={readOnly}
      />
    </>
  );
}
