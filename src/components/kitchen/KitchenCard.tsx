import { useState, useEffect } from "react";
import type { KitchenOrder } from "@/hooks/useKitchenOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, CheckCircle2, Clock, UtensilsCrossed, ShoppingBag, Loader2 } from "lucide-react";
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
  onDispatchItem: (itemId: string, orderId: string) => void;
  onDispatchAll: (orderId: string) => void;
  dispatchingItemId: string | null;
  dispatchingAll: boolean;
}

export default function KitchenCard({ order, onDispatchItem, onDispatchAll, dispatchingItemId, dispatchingAll }: Props) {
  const { mins, secs, elapsed } = useElapsed(order.sent_at);
  const isUrgent = elapsed > 15 * 60;
  const isWarning = elapsed > 8 * 60;

  const label = order.split_code ?? order.table_name ?? "Para llevar";
  const pendingCount = order.items.filter((i) => !i.dispatched_at).length;
  const allDispatched = pendingCount === 0;

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
            isUrgent ? "text-destructive" : isWarning ? "text-warning" : "text-muted-foreground"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {mins}:{secs.toString().padStart(2, "0")}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 px-3 py-2 space-y-1">
        {order.items.map((item) => {
          const isDispatched = !!item.dispatched_at;
          const isDispatching = dispatchingItemId === item.id;

          return (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-2 rounded-xl px-2 py-2 transition-colors",
                isDispatched ? "bg-accent/10 opacity-60" : "bg-background"
              )}
            >
              <button
                onClick={() => !isDispatched && onDispatchItem(item.id, order.id)}
                disabled={isDispatched || isDispatching || dispatchingAll}
                className={cn(
                  "flex items-center justify-center shrink-0 h-7 w-7 rounded-lg border-2 transition-all",
                  isDispatched
                    ? "bg-accent border-accent text-accent-foreground"
                    : "border-muted-foreground/30 hover:border-primary hover:bg-primary/10 active:scale-90"
                )}
              >
                {isDispatching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isDispatched ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
              </button>

              <span className={cn("text-sm font-bold w-6 text-right shrink-0", isDispatched ? "text-muted-foreground" : "text-primary")}>
                {item.quantity}×
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", isDispatched ? "line-through text-muted-foreground" : "text-foreground")}>
                  {item.description_snapshot}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.modifiers.map((m) => m.description).join(", ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action */}
      {!allDispatched && (
        <div className="px-4 py-3 border-t border-border">
          <Button
            onClick={() => onDispatchAll(order.id)}
            disabled={dispatchingAll}
            className="w-full h-11 rounded-xl font-display font-semibold gap-2"
          >
            {dispatchingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Despachar todo ({pendingCount})
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
