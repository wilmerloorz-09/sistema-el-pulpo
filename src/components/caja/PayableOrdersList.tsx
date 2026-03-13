import { useState } from "react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import PaymentDialog from "./PaymentDialog";

interface Props {
  orders: PayableOrder[];
  paymentMethods: { id: string; name: string }[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => void;
  paying: boolean;
  readOnly?: boolean;
}

export default function PayableOrdersList({
  orders,
  paymentMethods,
  shiftDenoms,
  onPay,
  paying,
  readOnly = false,
}: Props) {
  const [selectedOrder, setSelectedOrder] = useState<PayableOrder | null>(null);

  if (orders.length === 0) {
    return (
      <div className="py-10 text-center">
        <CreditCard className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Sin ordenes por cobrar</p>
      </div>
    );
  }

  const pendingUnits = (order: PayableOrder) => order.items.reduce((sum, item) => sum + item.quantity_pending, 0);
  const paidUnits = (order: PayableOrder) => order.items.reduce((sum, item) => sum + item.quantity_paid, 0);
  const totalPendingAmount = orders.reduce(
    (sum, order) => sum + order.items.reduce((orderSum, item) => orderSum + item.pending_total, 0),
    0,
  );
  const totalPendingUnits = orders.reduce((sum, order) => sum + pendingUnits(order), 0);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        {readOnly && (
          <div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            Modo consulta: puedes revisar las ordenes pendientes, pero no cobrar.
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Ordenes por cobrar</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{orders.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unidades pendientes</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{totalPendingUnits}</p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total pendiente</p>
          <p className="mt-1 font-display text-2xl font-bold text-primary">${totalPendingAmount.toFixed(2)}</p>
        </div>
      </div>

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
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition-colors",
                readOnly ? "hover:bg-card" : "hover:bg-muted/50",
              )}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                {order.order_type === "TAKEOUT" ? (
                  <ShoppingBag className="h-4 w-4 text-primary" />
                ) : (
                  <UtensilsCrossed className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {order.order_code ?? `#${order.order_number}`}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {pending} pendiente{pending === 1 ? "" : "s"}
                  </Badge>
                  {readOnly && (
                    <Badge variant="outline" className="text-[10px]">
                      Consulta
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pending} unidad(es) pendiente(s)
                  {paid > 0 && ` - ${paid} unidad(es) pagada(s)`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Por cobrar</p>
                <span className="font-display text-lg font-bold text-foreground">${pendingTotal.toFixed(2)}</span>
              </div>
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
        readOnly={readOnly}
      />
    </>
  );
}
