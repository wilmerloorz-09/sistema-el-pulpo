import { useState, useEffect } from "react";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Loader2, UtensilsCrossed, ShoppingBag, Eye } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import type { OrderStatus } from "@/types/cancellation";

interface DispatchCardBaseProps {
  order: DispatchOrder;
  onMarkReady: (orderId: string) => void;
  onMarkDispatched: (orderId: string) => void;
  isMarkingReady: boolean;
  isMarkingDispatched: boolean;
  showEyeIcon?: boolean;
  onEyeClick?: () => void;
}

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
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  
  switch (status) {
    case "READY":
      return `Listo a las ${time}`;
    case "KITCHEN_DISPATCHED":
      return `Despachado a las ${time}`;
    case "PAID":
      return `Pagado a las ${time}`;
    case "CANCELLED":
      return `Cancelado a las ${time}`;
    default:
      return time;
  }
}

export function DispatchCardBase({
  order,
  onMarkReady,
  onMarkDispatched,
  isMarkingReady,
  isMarkingDispatched,
  showEyeIcon = false,
  onEyeClick,
}: DispatchCardBaseProps) {
  console.log("🔍 DispatchCard: Rendering with order:", order);
  
  if (!order) {
    console.error("❌ DispatchCard: Order is null/undefined");
    return (
      <div className="p-4 text-center text-red-500">
        Error: Orden no disponible
      </div>
    );
  }

  try {
    const since = order.sent_to_kitchen_at || order.updated_at;
    console.log("🔍 DispatchCard: Time calculation - since:", since);
    
    if (!since) {
      console.error("❌ DispatchCard: No valid time found for order", order.id);
    }
    
    const { elapsed } = useElapsed(since);
    const shouldShowTimer = order.status === "SENT_TO_KITCHEN" || order.status === "READY";
    const isWarning = shouldShowTimer && elapsed > 10 * 60;
    const isUrgent = shouldShowTimer && elapsed > 15 * 60;

    const eventTime =
      order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
    const timeDisplay = shouldShowTimer
      ? formatElapsedHHMMSS(elapsed)
      : formatEventTimeWithLabel(eventTime, order.status);

    console.log("🔍 DispatchCard: Time display calculated:", { shouldShowTimer, elapsed, timeDisplay });

    const label = order.split_code ?? order.table_name ?? "Para llevar";
    const isReady = order.status === "READY";
    const isSent = order.status === "SENT_TO_KITCHEN";

    console.log("🔍 DispatchCard: About to render JSX");
    
    return (
      <div
        className={cn(
          "flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors",
          isUrgent
            ? "border-destructive/60 shadow-lg shadow-destructive/10"
            : isWarning
              ? "border-warning/50 shadow-md shadow-warning/10"
              : isReady
                ? "border-green-500/50 shadow-md shadow-green-500/10"
                : "border-border"
        )}
      >
        {/* Header: [Icono] [Mesa/Para llevar] [#Número] [Reloj/Hora] — igual que OrderCard */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            {order.order_type === "TAKEOUT" ? (
              <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <UtensilsCrossed className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-display text-sm font-bold truncate">{label}</span>
            <span className="font-display text-xs text-muted-foreground shrink-0">
              {order.order_code ?? order.order_number}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-mono font-semibold shrink-0",
                isUrgent ? "text-destructive" : isWarning ? "text-amber-600" : "text-muted-foreground"
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

        {/* Status Badge */}
        {isReady && (
          <div className="px-4 pt-3 pb-0">
            <Badge className="bg-green-600 text-white w-full justify-center text-center">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Listo para despachar
            </Badge>
          </div>
        )}

        {/* Items (solo ítems no DRAFT) */}
        <div className="flex-1 px-4 py-3 space-y-2">
          {(() => {
            const visibleItems = order.items.filter((item) => item.status !== "DRAFT");
            console.log(`🔍 DispatchCard [${order.order_code}]: Items received: ${order.items.length}, visible after filter: ${visibleItems.length}`);
            console.log(`🔍 DispatchCard [${order.order_code}]: All items with data:`, order.items.map((i: any) => ({
              id: i.id,
              description: i.description_snapshot?.substring(0, 20),
              status: i.status,
              quantity: i.quantity,
              total: i.total,
              totalType: typeof i.total
            })));
            return visibleItems.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 bg-muted-50">
                      {item.quantity}x
                    </Badge>
                    <p className="font-medium text-foreground truncate">{item.description_snapshot}</p>
                    {item.total && (
                      <span className="font-semibold text-primary ml-auto">
                        ${item.total ? item.total.toFixed(2) : '0.00'}
                      </span>
                    )}
                  </div>
                  {item.modifiers.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                      {item.modifiers.map((mod, idx) => (
                        <p key={idx} className="text-muted-foreground">
                          • {mod.description}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Total */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center justify-between font-semibold">
            <span className="text-muted-foreground">Total</span>
            <span className="text-primary text-lg">
              ${order.items?.reduce((sum, item) => sum + (item.total || 0), 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border bg-muted/30 space-y-2">
          {isSent && (
            <Button
              onClick={() => onMarkReady(order.id)}
              disabled={isMarkingReady || isMarkingDispatched}
              className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              size="sm"
            >
              {isMarkingReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Listo para despachar
            </Button>
          )}

          {isReady && (
            <Button
              onClick={() => {
                console.log("🔘 DispatchCard: Mark dispatched clicked for order:", order.id);
                console.log("🔘 DispatchCard: Order details:", {
                  id: order.id,
                  order_code: order.order_code,
                  status: order.status,
                  items_count: order.items?.length || 0,
                });
                onMarkDispatched(order.id);
              }}
              disabled={isMarkingReady || isMarkingDispatched}
              className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
              size="sm"
            >
              {isMarkingDispatched ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Marcar como despachado
            </Button>
          )}
        </div>
      </div>
    );
  } catch (error) {
    console.error("💥 DispatchCard: Render error:", error);
    return (
      <div className="p-4 text-center text-red-500">
        Error al renderizar orden: {error instanceof Error ? error.message : "Error desconocido"}
      </div>
    );
  }
}

export default DispatchCardBase;
