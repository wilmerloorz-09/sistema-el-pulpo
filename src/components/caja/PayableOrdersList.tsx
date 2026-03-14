import { useState } from "react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
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
          <div className="rounded-2xl border border-border bg-white/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            Modo consulta: puedes revisar las ordenes pendientes, pero no cobrar.
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          <MetricCard title="Ordenes por cobrar" value={String(orders.length)} description="Cuentas pendientes de caja" icon={<CreditCard className="h-5 w-5" />} tone="sky" className="min-h-[132px]" />
          <MetricCard title="Unidades pendientes" value={String(totalPendingUnits)} description="Items aun no cobrados" icon={<UtensilsCrossed className="h-5 w-5" />} tone="violet" className="min-h-[132px]" />
          <MetricCard title="Total pendiente" value={`$${totalPendingAmount.toFixed(2)}`} description="Monto total por cobrar" icon={<ShoppingBag className="h-5 w-5" />} tone="emerald" className="min-h-[132px]" />
        </div>

        <div className="min-h-[430px] rounded-[28px] border border-orange-200 bg-white/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <div className="grid auto-rows-max grid-cols-1 items-start gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => {
            const label = order.order_type === "TAKEOUT" ? "Para llevar" : order.split_code ?? order.table_name ?? "Mesa";
            const pending = pendingUnits(order);
            const paid = paidUnits(order);
            const pendingTotal = order.items.reduce((sum, item) => sum + item.pending_total, 0);
            const isTakeout = order.order_type === "TAKEOUT";

            return (
              <button
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className={cn(
                  "relative h-auto self-start overflow-hidden flex w-full items-start gap-3 rounded-[24px] border p-3 text-left shadow-[0_18px_45px_-36px_rgba(249,115,22,0.75)] transition-all",
                  readOnly
                    ? isTakeout
                      ? "border-fuchsia-400 bg-gradient-to-r from-fuchsia-50 via-rose-50 to-white"
                      : "border-sky-200 bg-gradient-to-r from-white via-sky-50/70 to-white"
                    : isTakeout
                      ? "border-fuchsia-500 bg-gradient-to-r from-fuchsia-100 via-rose-50 to-white hover:border-fuchsia-600 hover:shadow-[0_24px_50px_-34px_rgba(217,70,239,0.55)]"
                      : "border-sky-300 bg-gradient-to-r from-white via-sky-50/85 to-white hover:border-sky-400 hover:shadow-[0_24px_50px_-34px_rgba(14,165,233,0.45)]",
                )}
              >
                <div className={cn("pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl", isTakeout ? "bg-fuchsia-300/45" : "bg-sky-200/35")} />
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-white/95 shadow-sm", isTakeout ? "border-fuchsia-400 ring-2 ring-fuchsia-100" : "border-sky-200")}>
                  {order.order_type === "TAKEOUT" ? (
                    <ShoppingBag className="h-4 w-4 text-fuchsia-700" />
                  ) : (
                    <UtensilsCrossed className="h-4 w-4 text-sky-700" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-foreground">{label}</span>
                    <Badge variant="secondary" className="rounded-full bg-white/90 text-[10px] shadow-sm">
                      {order.order_code ?? `#${order.order_number}`}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px]",
                        isTakeout
                          ? "border-fuchsia-400 bg-fuchsia-100 text-fuchsia-800"
                          : "border-sky-200 bg-sky-50 text-sky-700",
                      )}
                    >
                      {pending} pendiente{pending === 1 ? "" : "s"}
                    </Badge>
                    {readOnly && (
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        Consulta
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    {pending} unidad(es) pendiente(s)
                    {paid > 0 && ` - ${paid} unidad(es) pagada(s)`}
                  </p>
                </div>
                <div className={cn("ml-auto rounded-2xl border bg-white/95 px-3 py-2 text-right shadow-sm", isTakeout ? "border-fuchsia-400 ring-2 ring-fuchsia-100" : "border-sky-200")}>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Por cobrar</p>
                  <span className={cn("font-display text-lg font-black", isTakeout ? "text-fuchsia-800" : "text-foreground")}>${pendingTotal.toFixed(2)}</span>
                </div>
              </button>
            );
          })}
          </div>
        </div>
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
