import { useState, useEffect } from "react";
import type { KitchenOrder } from "@/hooks/useKitchenOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, UtensilsCrossed, ShoppingBag } from "lucide-react";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

function useElapsed(since: string) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(since).getTime()) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  return { elapsed };
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

interface Props {
  order: KitchenOrder;
  onOpenReadyDialog: (order: KitchenOrder) => void;
}

export default function KitchenCard({ order, onOpenReadyDialog }: Props) {
  const { elapsed } = useElapsed(order.sent_at);
  const isTakeout = order.order_type === "TAKEOUT";
  const isUrgent = elapsed > 15 * 60;
  const isWarning = elapsed > 8 * 60;
  const label = order.split_code ?? order.table_name ?? "Para llevar";
  const pendingCount = order.items.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
  const readyCount = order.items.reduce((sum, item) => sum + item.quantity_ready_available, 0);
  const dispatchedCount = order.items.reduce((sum, item) => sum + item.quantity_dispatched, 0);
  const previewableItems = order.items.filter(
    (item) => item.quantity_pending_prepare > 0 || item.quantity_ready_available > 0 || item.quantity_dispatched > 0,
  );
  const previewItems = previewableItems.slice(0, 3);
  const hiddenCount = Math.max(0, previewableItems.length - previewItems.length);

  const summaryParts = [] as string[];
  if (pendingCount > 0) summaryParts.push(`${pendingCount} pendientes`);
  if (readyCount > 0) summaryParts.push(`${readyCount} listos`);
  if (dispatchedCount > 0) summaryParts.push(`${dispatchedCount} despachados`);

  return (
    <div
      className={cn(
        "flex self-start flex-col overflow-hidden rounded-2xl border-2 transition-colors",
        isTakeout ? "bg-gradient-to-br from-emerald-50 via-white to-lime-50" : "bg-gradient-to-br from-sky-50 via-white to-cyan-50",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
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
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {order.order_code ?? String(order.order_number)}
          </Badge>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs font-mono font-semibold",
            isUrgent ? "text-destructive" : isWarning ? "text-warning" : "text-muted-foreground",
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {formatElapsedHHMMSS(elapsed)}
        </div>
      </div>

      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {summaryParts.join(" - ") || "Sin pendientes por preparar"}
      </div>

      <div className="space-y-2 px-4 py-3">
        {previewItems.map((item) => (
          <div key={item.id} className="rounded-xl border border-border px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                  <p className="truncate text-sm font-medium text-foreground">{item.description_snapshot}</p>
                </div>
                {item.modifiers.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1 pl-[18px]">
                    {item.modifiers.filter((modifier) => String(modifier.description ?? "").trim().length > 0).map((modifier) => (
                      <span
                        key={modifier.description}
                        className="w-fit rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                      >
                        - {modifier.description}
                      </span>
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

      <div className="border-t border-border px-4 py-3">
        <Button onClick={() => onOpenReadyDialog(order)} variant="info" className="h-11 w-full gap-2 rounded-xl font-display font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          Marcar listo
        </Button>
      </div>
    </div>
  );
}
