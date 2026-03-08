import { useState } from "react";
import OrderCardBase from "./OrderCardBase";
import OrderDetailDrawer from "./OrderDetailDrawer";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderCardProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
}

export default function OrderCard({
  order,
  onCancel,
  showCancelButton = true,
}: OrderCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  
  const handleEyeClick = () => {
    console.log("🔍 OrderCard: Eye icon clicked for order:", order.id);
    setIsDrawerOpen(true);
  };

  return (
    <>
      <OrderCardBase
        order={order}
        onCancel={onCancel}
        showCancelButton={showCancelButton}
        showEyeIcon={true}
        onEyeClick={handleEyeClick}
      />
      
      <OrderDetailDrawer
        order={order}
        onCancel={onCancel}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
      />
    </>
  );
}
