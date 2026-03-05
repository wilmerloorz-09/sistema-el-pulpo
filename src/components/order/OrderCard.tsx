import { useState, useEffect } from "react";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, UtensilsCrossed, ShoppingBag, DollarSign, Package, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ItemCancelButton } from "./ItemCancelButton";

function useElapsed(since: string) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(since).getTime()) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return { mins, secs };
}

interface OrderCardProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
}

export function OrderCard({ order, onCancel, showCancelButton = true }: OrderCardProps) {
  const { mins, secs } = useElapsed(order.created_at);
  const { user } = useAuth();

  const getStatusText = (status: string) => {
    switch (status) {
      case "SENT_TO_KITCHEN":
        return "Enviada";
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

  const label = order.table_id ? `Mesa ${order.table_id}` : "Para llevar";

  return (
    <div className="flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-display text-sm font-bold truncate">{label}</span>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            #{order.order_number}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-xs font-mono font-semibold shrink-0 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {mins}:{secs.toString().padStart(2, "0")}
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 px-4 py-2 space-y-1">
        {order.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-xl px-2 py-2 bg-background"
          >
            <div className="flex items-center justify-center shrink-0 h-7 w-7 rounded-lg border-2 border-muted-foreground/30 bg-muted-foreground/10">
              <Check className="h-3.5 w-3.5 text-muted-foreground" />
            </div>

            <span className="text-sm font-bold w-6 text-right shrink-0">
              {item.quantity}×
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {item.description_snapshot}
              </p>
              {item.modifiers.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.modifiers.map((m) => m.description).join(", ")}
                </p>
              )}
            </div>

            {user && (
              <ItemCancelButton
                itemId={item.id}
                orderId={order.id}
                status={item.status as any}
                quantity={item.quantity}
                description={item.description_snapshot}
                total={item.total}
                userId={user.id}
              />
            )}
          </div>
        ))}

        <div className="flex items-center justify-between text-sm mt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span>{order.item_count} ítem{order.item_count !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-primary">
            <DollarSign className="h-4 w-4" />
            <span>{order.total.toFixed(2)}</span>
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
}