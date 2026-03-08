import { useState, useEffect } from "react";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, UtensilsCrossed, ShoppingBag, DollarSign, Package, Check, Eye } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ItemCancelButton } from "./ItemCancelButton";
import OrderDetailDrawer from "./OrderDetailDrawer";

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

interface OrderCardProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
}

export function OrderCard({ order, onCancel, showCancelButton = true }: OrderCardProps) {
  console.log("🔍 OrderCard: Rendering with order:", order);
  
  if (!order) {
    console.error("❌ OrderCard: Order is null/undefined");
    return (
      <div className="p-4 text-center text-red-500">
        Error: Orden no disponible
      </div>
    );
  }

  try {
    const since = order.sent_to_kitchen_at || order.created_at;
    console.log("🔍 OrderCard: Time calculation - since:", since);
    
    if (!since) {
      console.error("❌ OrderCard: No valid time found for order", order.id);
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

    console.log("🔍 OrderCard: Time display calculated:", { isSentToKitchen, elapsed, timeDisplay });

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

    const label = order.table_name ?? "Para llevar";

    console.log("🔍 OrderCard: About to render JSX");
    
    return (
      <div className="flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors border-border">
        {/* Header: [Icono] [Mesa/Para llevar] [#Número] [Reloj/Hora] — igual que DispatchCard */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            {order.order_type === "TAKEOUT" ? (
              <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <UtensilsCrossed className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-display text-sm font-bold min-w-fit shrink-0">{label}</span>
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
            <OrderDetailDrawer 
              order={order}
              onCancel={onCancel}
              showCancelButton={showCancelButton}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                title="Ver detalles"
                onClick={() => console.log("🔘 OrderCard: Eye button clicked for order:", order.order_code)}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </OrderDetailDrawer>
          </div>
        </div>

        {/* Items list */}
        <div className="flex-1 px-4 py-2 space-y-1">
          {order.items?.filter((item) => item.status !== "DRAFT").map((item) => (
            <div
              key={item?.id || Math.random()}
              className="flex items-center gap-2 rounded-xl px-2 py-2 bg-background"
            >
              <div className="flex items-center justify-center shrink-0 h-7 w-7 rounded-lg border-2 border-muted-foreground/30 bg-muted-foreground/10">
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
              </div>

              <span className="text-sm font-bold w-6 text-right shrink-0">
                {item?.quantity || 0}×
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {item?.description_snapshot || "Ítem sin nombre"}
                  </p>
                  {item?.status === "DRAFT" && (
                    <Badge className="text-[10px] font-medium" variant="secondary">
                      Pendiente
                    </Badge>
                  )}
                </div>
                {item?.modifiers?.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.modifiers?.map((m) => m?.description || "").join(", ")}
                  </p>
                )}
              </div>

              {user && item?.id && (
                <ItemCancelButton
                  itemId={item.id}
                  orderId={order?.id || ""}
                  status={item.status as any}
                  quantity={item.quantity || 0}
                  description={item.description_snapshot || ""}
                  total={item.total || 0}
                  userId={user.id}
                />
              )}
            </div>
          )) || []}

          <div className="flex items-center justify-between text-sm mt-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Package className="h-4 w-4" />
              <span>{(order.item_count || 0)} ítem{(order.item_count || 0) !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1 font-semibold text-primary">
              <DollarSign className="h-4 w-4" />
              <span>{(order.total || 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <Badge variant="outline" className="text-xs">
              {getStatusText(order.status)}
            </Badge>
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
    console.error("💥 OrderCard: Render error:", error);
    return (
      <div className="p-4 text-center text-red-500">
        Error al renderizar orden: {error instanceof Error ? error.message : "Error desconocido"}
      </div>
    );
  }
}