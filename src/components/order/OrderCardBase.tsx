import { useState, useEffect } from "react";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, UtensilsCrossed, ShoppingBag, DollarSign, Package, Check, Eye } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ItemCancelButton } from "./ItemCancelButton";

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

function formatEventTimeWithLabel(iso: string | null | undefined, status: string): string {
  if (!iso) return "--";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  
  switch (status) {
    case "READY":
      return time;
    case "KITCHEN_DISPATCHED":
      return time;
    case "PAID":
      return time;
    case "CANCELLED":
      return time;
    default:
      return time;
  }
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
  console.log("🔍 OrderCardBase: Rendering with order:", order);
  
  if (!order) {
    console.error("❌ OrderCardBase: Order is null/undefined");
    return (
      <div className="p-4 text-center text-red-500">
        Error: Orden no disponible
      </div>
    );
  }

  try {
    const since = order.sent_to_kitchen_at || order.created_at;
    console.log("🔍 OrderCardBase: Time calculation - since:", since);
    
    if (!since) {
      console.error("❌ OrderCardBase: No valid time found for order", order.id);
    }
    
    const { elapsed } = useElapsed(since);
    const { user } = useAuth();

    const isSentToKitchen = order.status === "SENT_TO_KITCHEN";
    const isWarning = isSentToKitchen && elapsed > 10 * 60;

    const eventTime =
      order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
    const timeDisplay = isSentToKitchen
      ? formatElapsedHHMMSS(elapsed)
      : formatEventTimeWithLabel(eventTime, order.status);

    console.log("🔍 OrderCardBase: Time display calculated:", { isSentToKitchen, elapsed, timeDisplay });

    const getStatusText = (status: string) => {
      switch (status) {
        case "SENT_TO_KITCHEN":
          return "Enviada";
        case "READY":
          return "Lista para despachar";
        case "KITCHEN_DISPATCHED":
          return "Despachada";
        case "CANCELLED":
          return "Cancelada";
        case "PAID":
          return "Pagada";
        default:
          return status;
      }
    };

    return (
      <div
        className={cn(
          "flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors",
          isWarning ? "border-warning/50 shadow-md shadow-warning/10" : "border-border"
        )}
      >
        {/* Header */}
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

        {/* Items Summary */}
        <div className="flex-1 px-4 py-3 space-y-2">
          {order.items?.filter((item) => item.status !== "DRAFT").map((item) => (
            <div key={item?.id || Math.random()} className="flex items-start justify-between gap-2 text-sm">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <Badge className="text-[10px] font-medium bg-primary/10 text-primary border-primary/20">
                  {item?.quantity || 1}x
                </Badge>
                <p className="text-sm font-medium text-foreground truncate">
                  {item?.description_snapshot || "Ítem sin nombre"}
                </p>
                {item?.status === "DRAFT" && (
                  <Badge className="text-[10px] font-medium" variant="secondary">
                    Pendiente
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.total && (
                  <span className="font-semibold text-primary text-sm ml-auto">
                    ${item.total ? item.total.toFixed(2) : '0.00'}
                  </span>
                )}
              </div>
            </div>
          )) || []}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-sm mt-2 px-4 py-3 border-t border-border">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span>{(order.item_count || 0)} ítem{(order.item_count || 0) !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-primary">
            <DollarSign className="h-4 w-4" />
            <span>{(order.total || 0).toFixed(2)}</span>
          </div>
        </div>

        {/* Action */}
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
  } catch (error) {
    console.error("💥 OrderCardBase: Render error:", error);
    return (
      <div className="p-4 text-center text-red-500">
        Error al renderizar orden: {error instanceof Error ? error.message : "Error desconocido"}
      </div>
    );
  }
}

export default OrderCardBase;
