import { useEffect, useState } from "react";
import type { DispatchOrder } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, UtensilsCrossed, ShoppingBag, Eye, Truck } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

interface DispatchCardBaseProps {
  order: DispatchOrder;
  onOpenReadyDialog: (order: DispatchOrder) => void;
  onOpenDispatchDialog: (order: DispatchOrder) => void;
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

function StageChip({ label, quantity, tone }: { label: string; quantity: number; tone: "pending" | "ready" | "dispatched" }) {
  const toneClass =
    tone === "pending"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "ready"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-green-200 bg-green-50 text-green-700";

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", toneClass)}>
      {label} {quantity}
    </span>
  );
}

export function DispatchCardBase({
  order,
  onOpenReadyDialog,
  onOpenDispatchDialog,
  showEyeIcon = false,
  onEyeClick,
  readOnly = false,
}: DispatchCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.updated_at;
  const { elapsed } = useElapsed(since);
  const isTakeout = order.order_type === "TAKEOUT";

  const shouldShowTimer = order.status === "SENT_TO_KITCHEN" || order.status === "READY";
  const isWarning = shouldShowTimer && elapsed > 10 * 60;
  const isUrgent = shouldShowTimer && elapsed > 15 * 60;

  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = shouldShowTimer ? formatElapsedHHMMSS(elapsed) : formatEventTimeWithLabel(eventTime, order.status);

  const label = order.split_code ?? order.table_name ?? "Para llevar";
  const canMarkReady = order.pending_prepare_count > 0;
  const canDispatch = order.ready_available_count > 0;
  const previewableItems = order.items.filter(
    (item) => item.quantity_pending_prepare > 0 || item.quantity_ready_available > 0 || item.quantity_dispatched > 0,
  );
  const previewItems = previewableItems.slice(0, 3);
  const hiddenCount = Math.max(0, previewableItems.length - previewItems.length);
  const dispatchedCount = order.items.reduce((sum, item) => sum + item.quantity_dispatched, 0);

  const summaryParts: string[] = [];
  if (order.pending_prepare_count > 0) summaryParts.push(`${order.pending_prepare_count} pendientes`);
  if (order.ready_available_count > 0) summaryParts.push(`${order.ready_available_count} listos`);
  if (dispatchedCount > 0) summaryParts.push(`${dispatchedCount} despachados`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join(" - ") : "Sin acciones pendientes";

  return (
    <div
      className={cn(
        "flex self-start flex-col overflow-hidden rounded-2xl border-2 transition-colors",
        isTakeout ? "bg-gradient-to-br from-emerald-50 via-white to-lime-50" : "bg-gradient-to-br from-sky-50 via-white to-cyan-50",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
            : canDispatch
              ? "border-green-500/50 shadow-md shadow-green-500/10"
              : "border-border",
      )}
    >
      <div className={cn("flex items-center justify-between border-b border-border px-4 py-3", isTakeout ? "bg-emerald-100/55" : "bg-sky-100/55")}>
        <div className="flex min-w-0 items-center gap-2">
          {order.order_type === "TAKEOUT" ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-sky-700" />
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

      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{summaryText}</div>

      <div className="space-y-2 px-4 py-3">
        {previewItems.map((item) => (
          <div key={item.id} className="rounded-xl border border-border px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                  <p className="truncate font-medium text-foreground">{item.description_snapshot}</p>
                </div>
                {item.modifiers.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1 pl-[18px]">
                    {item.modifiers.filter((mod) => String(mod.description ?? "").trim().length > 0).map((mod, idx) => (
                      <p
                        key={idx}
                        className="w-fit rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                      >
                        - {mod.description}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px]">
                  {item.quantity_pending_prepare > 0 ? (
                    <StageChip label="Pend" quantity={item.quantity_pending_prepare} tone="pending" />
                  ) : null}
                  {item.quantity_ready_available > 0 ? (
                    <StageChip label="Listo" quantity={item.quantity_ready_available} tone="ready" />
                  ) : null}
                  {item.quantity_dispatched > 0 ? (
                    <StageChip label="Desp" quantity={item.quantity_dispatched} tone="dispatched" />
                  ) : null}
                </div>
              </div>
              <span className="rounded-md bg-primary/12 px-2.5 py-1 text-sm font-bold text-primary">
                x{item.quantity_ordered}
              </span>
            </div>
          </div>
        ))}

        {hiddenCount > 0 && (
          <div className="rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            +{hiddenCount} item{hiddenCount !== 1 ? "s" : ""} mas
          </div>
        )}
      </div>

      {(canMarkReady || canDispatch || readOnly) && (
        <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
          {readOnly ? <div className="text-center text-xs text-muted-foreground">Modo consulta: no puedes ejecutar acciones de despacho.</div> : null}

          {!readOnly && canMarkReady && (
            <Button onClick={() => onOpenReadyDialog(order)} className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700" size="sm">
              <CheckCircle2 className="h-4 w-4" />
              Marcar listo
            </Button>
          )}

          {!readOnly && canDispatch && (
            <Button onClick={() => onOpenDispatchDialog(order)} className="w-full gap-2 bg-green-600 text-white hover:bg-green-700" size="sm">
              <Truck className="h-4 w-4" />
              Despachar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default DispatchCardBase;
