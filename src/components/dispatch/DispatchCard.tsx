import { useState, useEffect } from "react";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Loader2, UtensilsCrossed, ShoppingBag } from "lucide-react";
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
  order: DispatchOrder;
  onMarkReady: (orderId: string) => void;
  onMarkDispatched: (orderId: string) => void;
  isMarkingReady: boolean;
  isMarkingDispatched: boolean;
}

export default function DispatchCard({
  order,
  onMarkReady,
  onMarkDispatched,
  isMarkingReady,
  isMarkingDispatched,
}: Props) {
  const { mins, secs, elapsed } = useElapsed(order.updated_at);
  const isUrgent = elapsed > 15 * 60;
  const isWarning = elapsed > 8 * 60;

  const label = order.split_code ?? order.table_name ?? "Para llevar";
  const isReady = order.status === "READY";
  const isSent = order.status === "SENT_TO_KITCHEN";

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
            {order.order_code ?? `#${order.order_number}`}
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

      {/* Status Badge */}
      {isReady && (
        <div className="px-4 pt-3 pb-0">
          <Badge className="bg-green-600 text-white w-full justify-center text-center">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Listo para despachar
          </Badge>
        </div>
      )}

      {/* Items */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{item.description_snapshot}</p>
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
            <Badge variant="outline" className="shrink-0 bg-muted/50">
              x{item.quantity}
            </Badge>
          </div>
        ))}
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
            onClick={() => onMarkDispatched(order.id)}
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
}
