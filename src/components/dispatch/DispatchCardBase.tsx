import { useEffect, useMemo, useState } from "react";
import type { DispatchOrder, DispatchOrderItem } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Clock, Check, Minus, Plus, ShoppingBag, Truck, UtensilsCrossed, Eye } from "lucide-react";
import { getOrderKind, getOrderOriginLabel } from "@/lib/orderPresentation";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";

interface DispatchCardBaseProps {
  order: DispatchOrder;
  onMarkOrderReady: (order: DispatchOrder) => void;
  onMarkItemReady: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  onDispatchItem: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  isMarkingOrderReady?: boolean;
  isMarkingReady?: boolean;
  isDispatching?: boolean;
  showEyeIcon?: boolean;
  onEyeClick?: () => void;
  readOnly?: boolean;
  expanded?: boolean;
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

function QuantityStepper({
  value,
  min,
  max,
  disabled,
  onChange,
  compact = false,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  compact?: boolean;
}) {
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setDraftValue(String(value));
      return;
    }

    const normalized = Math.max(min, Math.min(max, Math.floor(parsed)));
    setDraftValue(String(normalized));
    if (normalized !== value) {
      onChange(normalized);
    }
  };

  const handleDraftChange = (rawValue: string) => {
    if (rawValue === "") {
      setDraftValue("");
      return;
    }

    const sanitized = rawValue.replace(/[^\d]/g, "");
    if (!sanitized) {
      setDraftValue(String(min));
      return;
    }

    const parsed = Math.floor(Number(sanitized));
    const normalized = Math.max(min, Math.min(max, parsed));
    setDraftValue(String(normalized));
  };

  return (
    <div className={cn("flex items-center rounded-xl border border-border bg-background/90", compact ? "h-8" : "h-10")}>
      <button
        type="button"
        className={cn(
          "inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
          compact ? "w-6" : "w-9",
        )}
        onClick={() => canDecrease && onChange(value - 1)}
        disabled={!canDecrease}
        aria-label="Disminuir cantidad"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draftValue}
        disabled={disabled}
        onChange={(event) => handleDraftChange(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "dispatch-qty-input bg-transparent text-center font-mono text-sm font-semibold text-foreground outline-none",
          compact ? "w-8 px-0" : "w-10 px-1",
        )}
      />
      <button
        type="button"
        className={cn(
          "inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
          compact ? "w-6" : "w-9",
        )}
        onClick={() => canIncrease && onChange(value + 1)}
        disabled={!canIncrease}
        aria-label="Aumentar cantidad"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function DispatchCardBase({
  order,
  onMarkOrderReady,
  onMarkItemReady,
  onDispatchItem,
  isMarkingOrderReady = false,
  isMarkingReady = false,
  isDispatching = false,
  showEyeIcon = false,
  onEyeClick,
  readOnly = false,
  expanded = false,
}: DispatchCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.updated_at;
  const { elapsed } = useElapsed(since);
  const orderKind = getOrderKind({ orderType: order.order_type, isSpecial: order.is_special, isTrayOrder: order.is_tray_order });
  const isTakeout = orderKind === "takeout";
  const isSpecial = orderKind === "special";
  const isTray = orderKind === "tray";
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});

  useEffect(() => {
    setQtyByItem((current) => {
      const next: Record<string, number> = {};
      for (const item of order.items) {
        if (item.quantity_dispatchable <= 0) continue;
        const currentValue = current[item.id];
        if (typeof currentValue === "number" && Number.isFinite(currentValue)) {
          next[item.id] = Math.max(1, Math.min(item.quantity_dispatchable, currentValue));
        } else {
          next[item.id] = Math.max(1, item.quantity_dispatchable);
        }
      }
      return next;
    });
  }, [order.items]);

  const shouldShowTimer = order.status === "SENT_TO_KITCHEN" || order.status === "READY";
  const isWarning = shouldShowTimer && elapsed > 10 * 60;
  const isUrgent = shouldShowTimer && elapsed > 15 * 60;

  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = shouldShowTimer ? formatElapsedHHMMSS(elapsed) : formatEventTimeWithLabel(eventTime, order.status);

  const label = getOrderOriginLabel({
    orderType: order.order_type,
    tableName: order.table_name,
    splitCode: order.split_code,
    isSpecial: order.is_special,
    isTrayOrder: order.is_tray_order,
  });
  const canMarkAnyReady = order.pending_prepare_count > 0;
  const canDispatchAny = order.dispatchable_count > 0;
  const previewableItems = useMemo(
    () =>
      order.items.filter(
        (item) =>
          item.quantity_pending_prepare > 0
          || item.quantity_ready_available > 0,
      ),
    [order.items],
  );
  const dispatchedCount = order.items.reduce((sum, item) => sum + item.quantity_dispatched, 0);

  const summaryParts: string[] = [];
  if (order.pending_prepare_count > 0) summaryParts.push(`${order.pending_prepare_count} pendientes`);
  if (order.ready_available_count > 0) summaryParts.push(`${order.ready_available_count} listos`);
  if (dispatchedCount > 0) summaryParts.push(`${dispatchedCount} despachados`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join(" - ") : "Sin acciones pendientes";

  return (
    <div
      className={cn(
        "flex w-full min-w-0 justify-self-stretch flex-col overflow-hidden rounded-2xl border-2 transition-colors",
        expanded ? "min-h-[36rem]" : "",
        isTray ? "bg-gradient-to-br from-amber-50 via-white to-yellow-50" : isSpecial ? "bg-gradient-to-br from-orange-50 via-white to-amber-50" : isTakeout ? "bg-gradient-to-br from-emerald-50 via-white to-lime-50" : "bg-gradient-to-br from-sky-50 via-white to-cyan-50",
        isUrgent
          ? "border-destructive/60 shadow-lg shadow-destructive/10"
          : isWarning
            ? "border-warning/50 shadow-md shadow-warning/10"
            : canDispatchAny
              ? "border-green-500/50 shadow-md shadow-green-500/10"
              : canMarkAnyReady
                ? "border-blue-500/40 shadow-md shadow-blue-500/10"
                : "border-border",
      )}
    >
      <div className={cn("flex items-center justify-between border-b border-border px-3 py-3 sm:px-4", isTray ? "bg-amber-100/70" : isSpecial ? "bg-orange-100/55" : isTakeout ? "bg-emerald-100/55" : "bg-sky-100/55")}>
        <div className="flex min-w-0 items-center gap-2">
          {isTray ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-amber-700" />
          ) : isTakeout ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : isSpecial ? (
            <Truck className="h-4 w-4 shrink-0 text-orange-700" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-sky-700" />
          )}
          <span className="truncate font-display text-sm font-bold">{label}</span>
          <span className="shrink-0 font-display text-xs text-muted-foreground">{order.order_code ?? String(order.order_number)}</span>
          {order.is_tray_order && (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
              BANDEJA
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!readOnly ? (
            <Button
              type="button"
              variant="info"
              size="sm"
              className="h-8 gap-1.5 rounded-xl px-3"
              disabled={isMarkingOrderReady || isMarkingReady || isDispatching}
              onClick={() => onMarkOrderReady(order)}
            >
              <Check className="h-3.5 w-3.5" />
              Listo
            </Button>
          ) : null}
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

      <div className={cn("border-b border-border text-muted-foreground", expanded ? "px-5 py-3 text-sm" : "px-3 py-2 text-xs sm:px-4")}>{summaryText}</div>

      <div className={cn("space-y-2 overflow-y-auto", expanded ? "max-h-[28rem] px-5 py-4 pr-4" : "max-h-[19rem] px-3 py-3 pr-2 sm:px-4 sm:pr-3")}>
        {previewableItems.map((item) => {
          const selectedQty = Math.max(1, Math.min(item.quantity_dispatchable || 1, qtyByItem[item.id] ?? 1));
          const canDispatch = item.quantity_dispatchable > 0;
          const remainingToDispatch = item.quantity_dispatchable;
          const dispatchedQuantity = item.quantity_dispatched;

          return (
            <div key={item.id} className={cn("rounded-xl border border-border bg-white/70", expanded ? "px-4 py-3 text-base" : "px-3 py-2.5 text-sm sm:px-3.5")}>
              <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                    {item.quantity_ordered}X
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("break-words whitespace-normal font-medium leading-tight text-foreground", expanded ? "text-[15px]" : "text-sm md:text-[15px]")}>
                      {item.description_snapshot}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-1">
                        {item.modifiers
                          .filter((mod) => String(mod.description ?? "").trim().length > 0)
                          .map((mod, idx) => (
                            <p
                              key={idx}
                              className={cn(
                                "break-words whitespace-normal font-semibold text-red-700",
                                expanded ? "text-sm" : "text-xs md:text-[13px]",
                              )}
                            >
                              - {mod.description}
                            </p>
                          ))}
                      </div>
                    ) : null}
                    {item.item_note ? (
                      <p className={cn("break-words whitespace-normal text-muted-foreground", expanded ? "text-sm" : "text-xs md:text-[13px]")}>
                        Nota: {item.item_note}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {item.tray_item_type ? (
                        <TrayItemChip type={item.tray_item_type as TrayItemType} size="xs" />
                      ) : null}
                      {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                        <span className="text-[11px] font-semibold text-orange-600">
                          + ${Number(item.tray_container_cost ?? 0).toFixed(2)} tarrina
                        </span>
                      ) : null}
                    </div>
                    <div className={cn("mt-1 flex flex-nowrap gap-x-2 overflow-hidden text-muted-foreground", expanded ? "text-sm" : "text-[11px] md:text-[13px]")}>
                      <span className="shrink-0">Env: {item.quantity_ordered}</span>
                      <span className="shrink-0">Desp: {dispatchedQuantity}</span>
                      <span className="shrink-0">Falt: {remainingToDispatch}</span>
                      <span className="shrink-0">Canc: {item.quantity_cancelled}</span>
                    </div>
                  </div>
                </div>

                {!readOnly && canDispatch ? (
                  <div className="flex shrink-0 items-center gap-2 md:justify-end">
                    <QuantityStepper
                      value={selectedQty}
                      min={1}
                      max={Math.max(1, item.quantity_dispatchable)}
                      disabled={isMarkingReady || isDispatching}
                      onChange={(next) => {
                        setQtyByItem((current) => ({ ...current, [item.id]: next }));
                      }}
                      compact={!expanded}
                    />

                    {canDispatch && (
                      <Button
                        type="button"
                        variant="success"
                        size={expanded ? "default" : "sm"}
                        className="min-w-[6.5rem] gap-1.5 px-3 md:min-w-[7rem]"
                        disabled={isDispatching || isMarkingReady}
                        onClick={() => {
                          const remainingQty = Math.max(0, item.quantity_dispatchable - selectedQty);
                          setQtyByItem((current) => ({
                            ...current,
                            [item.id]: Math.max(1, remainingQty),
                          }));
                          onDispatchItem(order, item, selectedQty);
                        }}
                      >
                        <Truck className="h-3.5 w-3.5" />
                        Despachar
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {readOnly ? (
        <div className={cn("border-t border-border bg-muted/30 text-center text-muted-foreground", expanded ? "mt-auto px-5 py-4 text-sm" : "px-4 py-3 text-xs")}>
          Modo consulta: no puedes ejecutar acciones de despacho.
        </div>
      ) : null}
    </div>
  );
}

export default DispatchCardBase;
