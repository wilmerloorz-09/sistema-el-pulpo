import { useState, useEffect } from "react";
import type { KitchenOrder } from "@/hooks/useKitchenOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, UtensilsCrossed, ShoppingBag, Lock, UserRound } from "lucide-react";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";

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
  const orderKind = getOrderKind({ orderType: order.order_type, isSpecial: order.is_special, isTrayOrder: order.is_tray_order });
  const isTakeout = orderKind === "takeout";
  const isSpecial = orderKind === "special";
  const isTray = orderKind === "tray";
  const isUrgent = elapsed > 15 * 60;
  const isWarning = elapsed > 8 * 60;
  const label = getOrderOriginLabel({
    orderType: order.order_type,
    tableName: order.table_name,
    splitCode: order.split_code,
    isSpecial: order.is_special,
    isTrayOrder: order.is_tray_order,
  });
  const pendingCount = order.items.reduce((sum, item) => sum + item.quantity_pending_prepare, 0);
  const readyCount = order.items.reduce((sum, item) => sum + item.quantity_ready_available, 0);
  const dispatchedCount = order.items.reduce((sum, item) => sum + item.quantity_dispatched, 0);
  const previewableItems = order.items.filter(
    (item) => item.quantity_pending_prepare > 0 || item.quantity_ready_available > 0 || item.quantity_dispatched > 0,
  );

  const summaryParts = [] as string[];
  if (pendingCount > 0) summaryParts.push(`${pendingCount} pendientes`);
  if (readyCount > 0) summaryParts.push(`${readyCount} listos`);
  if (dispatchedCount > 0) summaryParts.push(`${dispatchedCount} despachados`);

  return (
    <div
      className={cn(
        "flex self-start flex-col overflow-hidden rounded-2xl border-2 transition-colors",
        isTray ? "bg-gradient-to-br from-amber-50 via-white to-yellow-50" : isSpecial ? "bg-gradient-to-br from-orange-50 via-white to-amber-50" : isTakeout ? "bg-gradient-to-br from-emerald-50 via-white to-lime-50" : "bg-gradient-to-br from-sky-50 via-white to-cyan-50",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
            : "border-border",
      )}
    >
      <div className={cn("flex items-center justify-between border-b border-border px-4 py-3", isTray ? "bg-amber-100/70" : isSpecial ? "bg-orange-100/55" : isTakeout ? "bg-emerald-100/55" : "bg-sky-100/55")}>
        <div className="flex min-w-0 items-center gap-2">
          {isTray ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-amber-700" />
          ) : isTakeout ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : isSpecial ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-700" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-sky-700" />
          )}
          <span className="truncate font-display text-sm font-bold">{label}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {getOrderRef(order.order_code, order.order_number)}
          </Badge>
          {order.is_tray_order && (
            <Badge className="shrink-0 border-amber-200 bg-amber-100 text-[10px] font-bold text-amber-800 hover:bg-amber-100">
              BANDEJA
            </Badge>
          )}
          {order.locked_for_editing && (
            <Badge variant="destructive" className="shrink-0 text-[10px] gap-1 px-1.5 flex items-center">
              <Lock className="h-3 w-3" />
              <span>Editando</span>
            </Badge>
          )}
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
        <div>{summaryParts.join(" - ") || "Sin pendientes por preparar"}</div>
        {order.created_by_name && (
          <div className="mt-1 flex items-center gap-1.5 font-semibold">
            <UserRound className="h-3.5 w-3.5" />
            <span className="truncate">{order.created_by_name}</span>
          </div>
        )}
      </div>

      <div className="max-h-[19rem] space-y-2 overflow-y-auto px-4 py-3 pr-3">
        {previewableItems.map((item) => {
          const isBulkItem = item.tray_item_type === "C";
          const trimmedItemNote = String(item.item_note ?? "").trim();
          const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");

          return (
          <div key={item.id} className="rounded-xl border border-border px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                  <p className="truncate text-sm font-medium text-foreground">{item.description_snapshot}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-[18px]">
                  {item.tray_item_type ? (
                    <TrayItemChip type={item.tray_item_type as TrayItemType} size="xs" />
                  ) : null}
                  {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                    <span className="text-[11px] font-semibold text-orange-600">
                      + ${Number(item.tray_container_cost ?? 0).toFixed(2)} tarrina
                    </span>
                  ) : null}
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
                {trimmedItemNote ? (
                  <p className={cn(
                    "mt-1 break-words whitespace-normal pl-[18px]",
                    isDeliveryInstruction
                      ? "text-sm font-semibold text-orange-700"
                      : "text-xs text-muted-foreground",
                  )}>
                    {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
                  </p>
                ) : null}
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
              {!isBulkItem ? (
                <span className="rounded-md bg-primary/12 px-2.5 py-1 text-sm font-bold text-primary">
                  x{item.quantity_ordered}
                </span>
              ) : null}
            </div>
          </div>
        )})}
      </div>

      <div className="border-t border-border px-4 py-3">
        <Button 
          onClick={() => onOpenReadyDialog(order)} 
          variant="info" 
          className="h-11 w-full gap-2 rounded-xl font-display font-semibold"
          disabled={order.locked_for_editing}
        >
          {order.locked_for_editing ? <Lock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {order.locked_for_editing ? "Deshabilitado (Editando)" : "Marcar listo"}
        </Button>
      </div>
    </div>
  );
}
