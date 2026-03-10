import { useEffect, useState } from "react";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Loader2, UtensilsCrossed, ShoppingBag, Eye } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

interface DispatchCardBaseProps {
  order: DispatchOrder;
  onMarkReady: (orderId: string) => void;
  onMarkDispatched: (orderId: string) => void;
  isMarkingReady: boolean;
  isMarkingDispatched: boolean;
  showEyeIcon?: boolean;
  onEyeClick?: () => void;
  readOnly?: boolean;
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
  if (!iso) return "-";
  const time = new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

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
  readOnly = false,
}: DispatchCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.updated_at;
  const { elapsed } = useElapsed(since);

  const shouldShowTimer = order.status === "SENT_TO_KITCHEN" || order.status === "READY";
  const isWarning = shouldShowTimer && elapsed > 10 * 60;
  const isUrgent = shouldShowTimer && elapsed > 15 * 60;

  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = shouldShowTimer ? formatElapsedHHMMSS(elapsed) : formatEventTimeWithLabel(eventTime, order.status);

  const label = order.split_code ?? order.table_name ?? "Para llevar";
  const isReady = order.status === "READY";
  const isSent = order.status === "SENT_TO_KITCHEN";
  const showActions = !readOnly && (isSent || isReady);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border-2 bg-card transition-colors",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
            : isReady
              ? "border-green-500/50 shadow-md shadow-green-500/10"
              : "border-border",
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-display text-sm font-bold">{label}</span>
          <span className="shrink-0 font-display text-xs text-muted-foreground">{order.order_code ?? String(order.order_number)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 font-mono text-xs font-semibold",
              isUrgent ? "text-destructive" : isWarning ? "text-amber-600" : "text-muted-foreground",
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

      {isReady && (
        <div className="px-4 pb-0 pt-3">
          <Badge className="w-full justify-center bg-green-600 text-center text-white">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Listo para despachar
          </Badge>
        </div>
      )}

      <div className="flex-1 space-y-2 px-4 py-3">
        {order.items
          .filter((item) => item.status !== "DRAFT")
          .map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="w-9 shrink-0 justify-center bg-muted-50">
                    {item.quantity}x
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{item.description_snapshot}</p>
                    {item.modifiers.length > 0 && (
                      <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                        {item.modifiers.filter((mod) => String(mod.description ?? "").trim().length > 0).map((mod, idx) => (
                          <p key={idx} className="text-muted-foreground">
                            - {mod.description}
                          </p>
                        ))}
                      </div>
                    )}
                    {item.item_note && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">Nota: {item.item_note}</p>
                    )}
                  </div>
                  <span className="ml-auto font-semibold text-primary">${item.total ? item.total.toFixed(2) : "0.00"}</span>
                </div>
              </div>
            </div>
          ))}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between font-semibold">
          <span className="text-muted-foreground">Total</span>
          <span className="text-lg text-primary">${order.items?.reduce((sum, item) => sum + (item.total || 0), 0).toFixed(2)}</span>
        </div>
      </div>

      {(showActions || readOnly) && (
        <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
          {readOnly ? (
            <div className="text-center text-xs text-muted-foreground">Modo consulta: no puedes ejecutar acciones de despacho.</div>
          ) : null}

          {showActions && isSent && (
            <Button
              onClick={() => onMarkReady(order.id)}
              disabled={isMarkingReady || isMarkingDispatched}
              className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700"
              size="sm"
            >
              {isMarkingReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Listo para despachar
            </Button>
          )}

          {showActions && isReady && (
            <Button
              onClick={() => onMarkDispatched(order.id)}
              disabled={isMarkingReady || isMarkingDispatched}
              className="w-full gap-2 bg-green-600 text-white hover:bg-green-700"
              size="sm"
            >
              {isMarkingDispatched ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Marcar como despachado
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default DispatchCardBase;


