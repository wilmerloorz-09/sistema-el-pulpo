import { useState } from "react";
import OrderCardBase from "./OrderCardBase";
import OrderDetailDrawer from "./OrderDetailDrawer";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderCardProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
  readOnly?: boolean;
}

export default function OrderCard({
  order,
  onCancel,
  showCancelButton = true,
  readOnly = false,
}: OrderCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <OrderCardBase
        order={order}
        onCancel={onCancel}
        showCancelButton={showCancelButton}
        showEyeIcon={true}
        onEyeClick={() => setIsDrawerOpen(true)}
        readOnly={readOnly}
      />

      <OrderDetailDrawer
        order={order}
        onCancel={onCancel}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        readOnly={readOnly}
      />
    </>
  );
}
