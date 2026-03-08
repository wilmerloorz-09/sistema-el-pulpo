import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, UtensilsCrossed, ShoppingBag, Package, DollarSign, Check, X } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

// Types - usar DispatchOrderItem para consistencia
interface OrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  status: string;
  total?: number;
  modifiers?: Array<{
    description: string;
  }>;
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
  order: Order | null;
  onClose?: () => void;
  onCancel?: (order: Order) => void;
  onMarkReady?: (orderId: string) => void;
  onMarkDispatched?: (orderId: string) => void;
  showCancelButton?: boolean;
  moduleType?: 'orders' | 'dispatch';
}

export default function OrderDetailPanel({ 
  order, 
  onClose,
  onCancel,
  onMarkReady,
  onMarkDispatched,
  showCancelButton = true,
  moduleType = 'orders'
}: OrderDetailPanelProps) {
  console.log("🔍 OrderDetailPanel: Rendering with order:", order?.order_code);
  
  if (!order) {
    console.log("🔍 OrderDetailPanel: No order, returning null");
    return null;
  }

  const label = order.table_name ?? "Para llevar";

  // Timer logic - IGUAL que OrderCard pero para todos los estados
  const since = order.sent_to_kitchen_at || order.created_at;
  const [elapsed, setElapsed] = useState(() => {
    if (!since) return 0;
    return Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  });

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (since) {
        setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  // Timer logic para diferentes estados
  const shouldShowTimer = order.status === "SENT_TO_KITCHEN"; // Solo mostrar timer para enviadas
  const isWarning = shouldShowTimer && elapsed > 10 * 60;
  const isUrgent = shouldShowTimer && elapsed > 15 * 60;
  
  // Formato de tiempo según estado
  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = shouldShowTimer
    ? formatElapsedHHMMSS(elapsed)
    : eventTime ? new Date(eventTime).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "--:--";

  // Función para traducir estados - IGUAL que OrderCard
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

  // VERSIÓN ULTRA SIMPLE sin hooks complejos
  return (
    <div className="flex flex-col h-full">
      {/* Header - SIMPLE */}
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
              isUrgent ? "text-destructive" : isWarning ? "text-amber-600" : "text-muted-foreground"
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

      {/* Status Badge - Listo para despachar */}
      {order.status === "READY" && (
        <div className="px-4 pt-3 pb-0">
          <Badge className="bg-green-600 text-white w-full justify-center text-center">
            ✓ Listo para despachar
          </Badge>
        </div>
      )}

      {/* Items list - SIMPLE */}
      <div className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
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
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-semibold text-primary text-sm ml-auto">
                ${item.total ? item.total.toFixed(2) : '0.00'}
              </span>
            </div>
          </div>
        )) || []}

        <div className="flex items-center justify-between text-sm mt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span>{(order.item_count || 0)} ítem{(order.item_count || 0) !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-primary">
            <DollarSign className="h-4 w-4" />
            <span>${order.items?.reduce((sum, item) => sum + (item.total || 0), 0).toFixed(2)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <Badge variant="outline" className="text-xs">
            {getStatusText(order.status)}
          </Badge>
        </div>
      </div>

      {/* Actions - Botones según módulo */}
      <div className="px-4 py-3 border-t border-border bg-muted/30 space-y-2">
        {moduleType === 'dispatch' ? (
          // Botones de Despacho
          order.status === "READY" ? (
            <button
              onClick={() => onMarkDispatched && onMarkDispatched(order.id)}
              className="w-full h-12 rounded-xl font-display font-semibold bg-green-600 hover:bg-green-700 text-white gap-2 flex items-center justify-center"
            >
              ✓ Despachar
            </button>
          ) : (
            <button
              onClick={() => onMarkReady && onMarkReady(order.id)}
              className="w-full h-12 rounded-xl font-display font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-2 flex items-center justify-center"
            >
              ✓ Listo para despachar
            </button>
          )
        ) : (
          // Botones de Órdenes
          showCancelButton && order.status !== "PAID" && onCancel && (
            <button
              onClick={() => onCancel(order)}
              className="w-full h-10 rounded-xl font-display font-semibold bg-red-600 text-white"
            >
              Cancelar pedido
            </button>
          )
        )}
      </div>
    </div>
  );
}
