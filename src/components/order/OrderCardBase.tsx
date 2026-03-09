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
}

export function OrderCardBase({
  order,
  onCancel,
  showCancelButton = true,
  showEyeIcon = false,
  onEyeClick,
}: OrderCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.created_at;
  const { elapsed } = useElapsed(since);

  const isSentToKitchen = order.status === "SENT_TO_KITCHEN";
  const isWarning = isSentToKitchen && elapsed > 10 * 60;

  const eventTime =
    order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = isSentToKitchen
    ? formatElapsedHHMMSS(elapsed)
    : formatEventTimeWithLabel(eventTime);

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors",
        isWarning ? "border-warning/50 shadow-md shadow-warning/10" : "border-border"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-display text-sm font-bold truncate">
            {order.split_code ?? order.table_name ?? "Para llevar"}
          </span>
          <span className="font-display text-xs text-muted-foreground shrink-0">
            {order.order_code ?? `#${order.order_number}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-mono font-semibold shrink-0",
              isWarning ? "text-amber-600" : "text-muted-foreground"
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

      <div className="flex-1 px-4 py-3 space-y-2">
        {order.items?.filter((item) => item.status !== "DRAFT").map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <Badge className="text-[10px] font-medium bg-primary/10 text-primary border-primary/20">
                {item.quantity || 1}x
              </Badge>
              <p className="text-sm font-medium text-foreground truncate">
                {item.description_snapshot || "Item sin nombre"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-semibold text-primary text-sm ml-auto">
                ${item.total ? item.total.toFixed(2) : "0.00"}
              </span>
            </div>
          </div>
        )) || []}
      </div>

      <div className="flex items-center justify-between text-sm mt-2 px-4 py-3 border-t border-border">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Package className="h-4 w-4" />
          <span>{order.item_count || 0} item{(order.item_count || 0) !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1 font-semibold text-primary">
          <DollarSign className="h-4 w-4" />
          <span>{(order.total || 0).toFixed(2)}</span>
        </div>
      </div>

      {showCancelButton && order.status !== "PAID" && onCancel && (
        <div className="px-4 py-3 border-t border-border">
          <Button
            onClick={() => onCancel(order)}
            variant="destructive"
            className="w-full h-10 rounded-xl font-display font-semibold"
          >
            Cancelar pedido
          </Button>
        </div>
      )}
    </div>
  );
}

export default OrderCardBase;
