import { useState } from "react";
import { DispatchCardBase } from "./DispatchCardBase";
import type { DispatchOrder, DispatchOrderItem } from "@/hooks/useDispatchOrders";

interface DispatchCardProps {
  order: DispatchOrder;
  index: number;
  onMarkOrderReady: (order: DispatchOrder) => void;
  onMarkItemReady: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  onDispatchItem: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  onDispatchAll: (order: DispatchOrder) => void;
  isMarkingOrderReady?: boolean;
  isMarkingReady?: boolean;
  isDispatching?: boolean;
  isDispatchingOrder?: boolean;
  readOnly?: boolean;
}

export default function DispatchCard({
  order,
  index,
  onMarkOrderReady,
  onMarkItemReady,
  onDispatchItem,
  onDispatchAll,
  isMarkingOrderReady = false,
  isMarkingReady = false,
  isDispatching = false,
  isDispatchingOrder = false,
  readOnly = false,
}: DispatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <DispatchCardBase
      order={order}
      index={index}
      isExpanded={isExpanded}
      onToggleExpand={() => setIsExpanded((prev) => !prev)}
      onMarkOrderReady={onMarkOrderReady}
      onMarkItemReady={onMarkItemReady}
      onDispatchItem={onDispatchItem}
      onDispatchAll={onDispatchAll}
      isMarkingOrderReady={isMarkingOrderReady}
      isMarkingReady={isMarkingReady}
      isDispatching={isDispatching}
      isDispatchingOrder={isDispatchingOrder}
      readOnly={readOnly}
    />
  );
}
