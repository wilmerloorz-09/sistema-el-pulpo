import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DispatchCardBase } from "../dispatch/DispatchCardBase";
import OrderDetailPanel from "./OrderDetailPanel";

// Types - EXACTAMENTE iguales que OrderDetailPanel
interface OrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  status: string;
  total: number;
  paid_at?: string;
  modifiers?: Array<{
    description: string;
  }>;
}

interface Order {
  id: string;
  order_code: string;
  order_number?: number;
  order_type: "DINE_IN" | "TAKEOUT" | "TABLE";
  status: string;
  table_name?: string;
  split_code?: string;
  created_at: string;
  updated_at: string;
  sent_to_kitchen_at?: string;
  ready_at?: string;
  dispatched_at?: string;
  paid_at?: string;
  cancelled_at?: string;
  items: OrderItem[];
  total?: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  payment_method?: string;
  cancelled_by?: string;
  cancellation_reason?: string;
  item_count?: number;
}

interface OrderDetailDrawerProps {
  order: Order;
  children: React.ReactNode;
  onCancel?: (order: Order) => void;
  onMarkReady?: (orderId: string) => void;
  onMarkDispatched?: (orderId: string) => void;
  showCancelButton?: boolean;
  moduleType?: 'orders' | 'dispatch';
}

export default function OrderDetailDrawer({ 
  order, 
  children, 
  onCancel,
  onMarkReady,
  onMarkDispatched,
  showCancelButton = true,
  moduleType = 'orders'
}: OrderDetailDrawerProps) {
  const [open, setOpen] = useState(false);
  
  console.log("🔍 OrderDetailDrawer: Rendering with order:", order?.order_code);
  console.log("🔍 OrderDetailDrawer: Using simple Dialog (no media query)");

  const handleOpenChange = (newOpen: boolean) => {
    console.log("🔍 OrderDetailDrawer: Dialog open change:", newOpen);
    setOpen(newOpen);
  };

  const handleTriggerClick = () => {
    console.log("🔍 OrderDetailDrawer: Trigger clicked");
    setOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div onClick={handleTriggerClick}>
        {children}
      </div>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            isMarkingReady={false}
            isMarkingDispatched={false}
            showEyeIcon={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
