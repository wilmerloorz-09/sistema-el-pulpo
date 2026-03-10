import { useState, useEffect } from "react";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, UtensilsCrossed, ShoppingBag, DollarSign, Package, Eye } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

function useElapsed(since: string | null | undefined) {
  const [elapsed, setElapsed] = useState(() => {
    if (!since) return 0;
    return Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  });

  useEffect(() => {
    if (!since) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  return { elapsed };
}

function formatEventTimeWithLabel(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

interface OrderCardBaseProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
  showEyeIcon?: boolean;
  onEyeClick?: () => void;
  readOnly?: boolean;
}

export function OrderCardBase({
  order,
  onCancel,
  showCancelButton = true,
  showEyeIcon = false,
  onEyeClick,
  readOnly = false,
}: OrderCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.created_at;
  const { elapsed } = useElapsed(since);

  const isSentToKitchen = order.status === "SENT_TO_KITCHEN";
  const isWarning = isSentToKitchen && elapsed > 10 * 60;

  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = isSentToKitchen ? formatElapsedHHMMSS(elapsed) : formatEventTimeWithLabel(eventTime);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border-2 bg-card transition-colors",
        isWarning ? "border-warning/50 shadow-md shadow-warning/10" : "border-border",
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex items-center gap-2">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-display text-sm font-bold">
            {order.split_code ?? order.table_name ?? "Para llevar"}
          </span>
          <span className="shrink-0 font-display text-xs text-muted-foreground">
            {order.order_code ?? `#${order.order_number}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs font-mono font-semibold",
              isWarning ? "text-amber-600" : "text-muted-foreground",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            {timeDisplay}
          </div>
          {showEyeIcon && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Ver detalles"
              onClick={onEyeClick}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 px-4 py-3">
        {order.items?.filter((item) => item.status !== "DRAFT").map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Badge className="border-primary/20 bg-primary/10 text-[10px] font-medium text-primary">
                {item.quantity || 1}x
              </Badge>
              <p className="truncate text-sm font-medium text-foreground">
                {item.description_snapshot || "Item sin nombre"}
              </p>
            </div>
            <span className="ml-auto shrink-0 text-sm font-semibold text-primary">
              ${item.total ? item.total.toFixed(2) : "0.00"}
            </span>
          </div>
        )) || []}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border px-4 py-3 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Package className="h-4 w-4" />
          <span>{order.item_count || 0} item{(order.item_count || 0) !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1 font-semibold text-primary">
          <DollarSign className="h-4 w-4" />
          <span>{(order.total || 0).toFixed(2)}</span>
        </div>
      </div>

      {readOnly && (
        <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          Modo consulta
        </div>
      )}

      {!readOnly && showCancelButton && order.status !== "PAID" && onCancel && (
        <div className="border-t border-border px-4 py-3">
          <Button
            onClick={() => onCancel(order)}
            variant="destructive"
            className="h-10 w-full rounded-xl font-display font-semibold"
          >
            Cancelar pedido
          </Button>
        </div>
      )}
    </div>
  );
}

export default OrderCardBase;
