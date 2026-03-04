import { useState, useEffect } from "react";
import type { KitchenOrder } from "@/hooks/useKitchenOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, UtensilsCrossed, ShoppingBag, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return { mins, secs, elapsed };
}

interface Props {
  order: KitchenOrder;
  onDispatch: (id: string) => void;
  dispatching: boolean;
}

export default function KitchenCard({ order, onDispatch, dispatching }: Props) {
  const { mins, secs, elapsed } = useElapsed(order.sent_at);
  const isUrgent = elapsed > 15 * 60; // > 15 min
  const isWarning = elapsed > 8 * 60; // > 8 min

  const label = order.split_code
    ? order.split_code
    : order.table_name
      ? order.table_name
      : "Para llevar";

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border-2 bg-card overflow-hidden transition-colors",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
            : "border-border"
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
          <span className="font-display text-sm font-bold truncate">{label}</span>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            #{order.order_number}
          </Badge>
        </div>
        <div
          className={cn(
            "flex items-center gap-1 text-xs font-mono font-semibold shrink-0",
            isUrgent
              ? "text-destructive"
              : isWarning
                ? "text-warning"
                : "text-muted-foreground"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {mins}:{secs.toString().padStart(2, "0")}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="flex gap-2">
            <span className="text-sm font-bold text-primary w-6 text-right shrink-0">
              {item.quantity}×
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{item.description_snapshot}</p>
              {item.modifiers.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.modifiers.map((m) => m.description).join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="px-4 py-3 border-t border-border">
        <Button
          onClick={() => onDispatch(order.id)}
          disabled={dispatching}
          className="w-full h-11 rounded-xl font-display font-semibold gap-2"
        >
          {dispatching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Despachar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
