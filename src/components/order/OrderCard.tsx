import { useState } from "react";
import OrderCardBase from "./OrderCardBase";
import OrderDetailDrawer from "./OrderDetailDrawer";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

interface OrderCardProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  onApproveCancellation?: (order: OrderSummary) => void;
  onRejectCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
  showRejectButton?: boolean;
  readOnly?: boolean;
  canAuthorizeCancel?: boolean;
}

export default function OrderCard({
  order,
  onCancel,
  onApproveCancellation,
  onRejectCancel,
  showCancelButton = true,
  showRejectButton = false,
  readOnly = false,
  canAuthorizeCancel = true,
}: OrderCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <OrderCardBase
        order={order}
        onCancel={onCancel}
        onApproveCancellation={onApproveCancellation}
        onRejectCancel={onRejectCancel}
        showCancelButton={showCancelButton}
        showRejectButton={showRejectButton}
        showEyeIcon={true}
        onEyeClick={() => setIsDrawerOpen(true)}
        readOnly={readOnly}
        canAuthorizeCancel={canAuthorizeCancel}
      />

      <OrderDetailDrawer
        order={order}
        onCancel={onCancel}
        onApproveCancellation={onApproveCancellation}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        readOnly={readOnly}
      />
    </>
  );
}
