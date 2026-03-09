import { useState } from "react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ShoppingBag, UtensilsCrossed } from "lucide-react";
import PaymentDialog from "./PaymentDialog";

interface Props {
  orders: PayableOrder[];
  paymentMethods: { id: string; name: string }[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => void;
  paying: boolean;
}

export default function PayableOrdersList({ orders, paymentMethods, shiftDenoms, onPay, paying }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<PayableOrder | null>(null);

  if (orders.length === 0) {
    return (
      <div className="text-center py-10">
        <CreditCard className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm font-medium text-muted-foreground">Sin ordenes por cobrar</p>
      </div>
    );
  }

  const pendingUnits = (order: PayableOrder) =>
    order.items.reduce((sum, item) => sum + item.quantity_pending, 0);

  const paidUnits = (order: PayableOrder) =>
    order.items.reduce((sum, item) => sum + item.quantity_paid, 0);

  return (
    <>
      <div className="space-y-2">
        {orders.map((order) => {
          const label = order.order_type === "TAKEOUT" ? "Para llevar" : order.split_code ?? order.table_name ?? "Mesa";
          const pending = pendingUnits(order);
          const paid = paidUnits(order);
          const pendingTotal = order.items.reduce((sum, item) => sum + item.pending_total, 0);

          return (
            <button
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              className="w-full flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {order.order_type === "TAKEOUT" ? (
                  <ShoppingBag className="h-4 w-4 text-primary" />
                ) : (
                  <UtensilsCrossed className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {order.order_code ?? `#${order.order_number}`}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pending} unidad(es) pendiente(s)
                  {paid > 0 && ` · ${paid} unidad(es) pagada(s)`}
                </p>
              </div>
              <span className="font-display text-base font-bold text-foreground">${pendingTotal.toFixed(2)}</span>
            </button>
          );
        })}
      </div>

      <PaymentDialog
        order={selectedOrder}
        paymentMethods={paymentMethods}
        shiftDenoms={shiftDenoms}
        onPay={(params) => {
          onPay(params);
          setSelectedOrder(null);
        }}
        paying={paying}
        onClose={() => setSelectedOrder(null)}
      />
    </>
  );
}
