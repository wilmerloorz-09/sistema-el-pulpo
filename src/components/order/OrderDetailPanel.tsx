import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { Clock, UtensilsCrossed, ShoppingBag, Package, DollarSign, X, Ban } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

interface OrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  status: string;
  total?: number;
  modifiers?: Array<{ description: string }>;
  item_note?: string | null;
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

interface OrderDetailPanelProps {
  order: Order | OrderSummary | null;
  onClose?: () => void;
  onCancel?: (order: Order | OrderSummary) => void;
  onMarkReady?: (orderId: string) => void;
  onMarkDispatched?: (orderId: string) => void;
  showCancelButton?: boolean;
  moduleType?: "orders" | "dispatch";
  readOnly?: boolean;
}

export default function OrderDetailPanel({
  order,
  onClose,
  onCancel,
  onMarkReady,
  onMarkDispatched,
  showCancelButton = true,
  moduleType = "orders",
  readOnly = false,
}: OrderDetailPanelProps) {
  if (!order) return null;

  const label = order.table_name ?? "Para llevar";
  const since = order.sent_to_kitchen_at || order.created_at;
  const [elapsed, setElapsed] = useState(() => {
    if (!since) return 0;
    return Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (since) {
        setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  const shouldShowTimer = order.status === "SENT_TO_KITCHEN";
  const isWarning = shouldShowTimer && elapsed > 10 * 60;
  const isUrgent = shouldShowTimer && elapsed > 15 * 60;
  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = shouldShowTimer
    ? formatElapsedHHMMSS(elapsed)
    : eventTime
      ? new Date(eventTime).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
      : "--:--";

  const canDispatch = !readOnly && moduleType === "dispatch";
  const canCancel = !readOnly && moduleType === "orders" && showCancelButton && order.status !== "PAID" && !!onCancel;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex items-center gap-2">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-fit shrink-0 font-display text-sm font-bold">{label}</span>
          <span className="shrink-0 font-display text-xs text-muted-foreground">
            {order.order_code ?? String(order.order_number ?? "")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs font-mono font-semibold",
              isUrgent ? "text-destructive" : isWarning ? "text-amber-600" : "text-muted-foreground",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            {timeDisplay}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-border bg-muted/10 px-4 py-2 text-xs text-muted-foreground">
        Las cantidades mostradas aqui corresponden solo a la etapa operativa de esta pestana.
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-4 py-2">
        {order.items?.filter((item) => item.status !== "DRAFT").map((item) => (
          <div key={item.id} className="flex items-start gap-2 rounded-xl bg-background px-2 py-2">
            <Badge className="min-w-[2.9rem] shrink-0 justify-center rounded-lg border-orange-300 bg-gradient-to-r from-orange-500 to-orange-400 px-2 py-1.5 text-sm font-black leading-none text-white shadow-[0_12px_22px_-18px_rgba(249,115,22,0.95)]">
              {item.quantity || 1}x
            </Badge>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{item.description_snapshot || "Item sin nombre"}</p>
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="mt-0.5 flex flex-col text-xs text-red-600">
                  {item.modifiers.filter((modifier) => String(modifier.description ?? "").trim().length > 0).map((modifier) => (
                    <span key={modifier.description}>- {modifier.description}</span>
                  ))}
                </div>
              )}
              {item.item_note && (
                <p className="mt-0.5 text-xs italic text-muted-foreground">Nota: {item.item_note}</p>
              )}
            </div>
            <span className="ml-auto shrink-0 text-sm font-semibold text-primary">
              ${item.total ? item.total.toFixed(2) : "0.00"}
            </span>
          </div>
        )) || []}

        <div className="mt-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span>{order.item_count || 0} item{(order.item_count || 0) !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-primary">
            <DollarSign className="h-4 w-4" />
            <span>${(order.total || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
        {readOnly && (
          <div className="rounded-xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            Modo consulta: sin acciones operativas disponibles.
          </div>
        )}

        {canDispatch && (
          order.status === "READY" ? (
            <Button
              onClick={() => onMarkDispatched && onMarkDispatched(order.id)}
              variant="success"
              className="h-12 w-full rounded-xl font-display font-semibold"
            >
              Despachar
            </Button>
          ) : (
            <Button
              onClick={() => onMarkReady && onMarkReady(order.id)}
              variant="info"
              className="h-12 w-full rounded-xl font-display font-semibold"
            >
              Listo para despachar
            </Button>
          )
        )}

        {canCancel && (
          <Button
            onClick={() => onCancel?.(order)}
            variant="destructive"
            className="h-10 w-full rounded-xl font-display font-semibold gap-2"
          >
            <Ban className="h-4 w-4" />
            Cancelar pedido
          </Button>
        )}
      </div>
    </div>
  );
}
