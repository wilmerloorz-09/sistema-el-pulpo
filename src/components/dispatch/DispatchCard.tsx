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
}

export default function DispatchCard({
  order,
  onMarkReady,
  onMarkDispatched,
  isMarkingReady,
  isMarkingDispatched,
}: DispatchCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  
  const handleEyeClick = () => {
    console.log("🔍 DispatchCard: Eye icon clicked for order:", order.id);
    setIsDrawerOpen(true);
  };

  return (
    <>
      <DispatchCardBase
        order={order}
        onMarkReady={onMarkReady}
        onMarkDispatched={onMarkDispatched}
        isMarkingReady={isMarkingReady}
        isMarkingDispatched={isMarkingDispatched}
        showEyeIcon={true}
        onEyeClick={handleEyeClick}
      />
      
      <DispatchOrderDrawer
        order={order}
        onMarkReady={onMarkReady}
        onMarkDispatched={onMarkDispatched}
        isMarkingReady={isMarkingReady}
        isMarkingDispatched={isMarkingDispatched}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
      />
    </>
  );
}
