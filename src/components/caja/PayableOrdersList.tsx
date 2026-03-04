import { useState } from "react";
import type { PayableOrder } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Loader2, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  orders: PayableOrder[];
  paymentMethods: { id: string; name: string }[];
  onPay: (params: { orderId: string; methodId: string; amount: number }) => void;
  paying: boolean;
}

export default function PayableOrdersList({ orders, paymentMethods, onPay, paying }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<PayableOrder | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>("");

  const handlePay = () => {
    if (!selectedOrder || !selectedMethod) return;
    onPay({
      orderId: selectedOrder.id,
      methodId: selectedMethod,
      amount: selectedOrder.total,
    });
    setSelectedOrder(null);
    setSelectedMethod("");
  };

  if (orders.length === 0) {
    return (
      <div className="text-center py-10">
        <CreditCard className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm font-medium text-muted-foreground">Sin órdenes por cobrar</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {orders.map((order) => {
          const label = order.split_code ?? order.table_name ?? "Para llevar";
          return (
            <button
              key={order.id}
              onClick={() => { setSelectedOrder(order); setSelectedMethod(""); }}
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
                  <Badge variant="secondary" className="text-[10px]">#{order.order_number}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {order.items.length} items
                </p>
              </div>
              <span className="font-display text-base font-bold text-foreground">
                ${order.total.toFixed(2)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Payment Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              Cobrar #{selectedOrder?.order_number}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              {/* Order summary */}
              <div className="rounded-xl border border-border p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {selectedOrder.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {item.quantity}× {item.description_snapshot}
                    </span>
                    <span className="font-medium text-foreground">${item.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-primary/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total a cobrar</p>
                <p className="font-display text-2xl font-bold text-primary">
                  ${selectedOrder.total.toFixed(2)}
                </p>
              </div>

              {/* Payment method selection */}
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Método de pago</p>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMethod(m.id)}
                      className={cn(
                        "rounded-xl border-2 p-3 text-sm font-medium transition-all",
                        selectedMethod === m.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground/50"
                      )}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={handlePay}
                disabled={!selectedMethod || paying}
                className="w-full h-12 rounded-xl font-display text-base font-semibold gap-2"
              >
                {paying ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <CreditCard className="h-5 w-5" />
                    Cobrar ${selectedOrder.total.toFixed(2)}
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
