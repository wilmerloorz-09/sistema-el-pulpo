import { useEffect, useMemo, useState } from "react";
import type { DispatchOrder, DispatchOrderItem } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Clock, Check, Minus, Plus, ShoppingBag, Truck, UtensilsCrossed, ChevronDown, ChevronUp, CreditCard } from "lucide-react";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";

function getDispatchOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

interface DispatchCardBaseProps {
  order: DispatchOrder;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onMarkOrderReady: (order: DispatchOrder) => void;
  onMarkItemReady: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  onDispatchItem: (order: DispatchOrder, item: DispatchOrderItem, qty: number) => void;
  isMarkingOrderReady?: boolean;
  isMarkingReady?: boolean;
  isDispatching?: boolean;
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
  index,
  isExpanded,
  onToggleExpand,
  onMarkOrderReady,
  onMarkItemReady,
  onDispatchItem,
  isMarkingOrderReady = false,
  isMarkingReady = false,
  isDispatching = false,
  readOnly = false,
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

  const label = getDispatchOrderOriginLabel({
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
          || item.quantity_ready_available > 0
          || item.quantity_dispatched > 0,
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
    <div className={index % 2 === 0 ? "bg-white" : "bg-slate-100/80"}>
      <div
        onClick={onToggleExpand}
        className="group grid cursor-pointer gap-3 px-5 py-3.5 transition-colors hover:bg-slate-100/50 sm:grid-cols-[auto_minmax(140px,1.1fr)_minmax(180px,1fr)_minmax(110px,0.7fr)_minmax(180px,1fr)_auto] sm:items-center sm:px-8"
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800"
          aria-label={isExpanded ? "Ocultar detalle" : "Mostrar detalle"}
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              {isTray ? (
                <ShoppingBag className="h-4 w-4" />
              ) : isTakeout ? (
                <ShoppingBag className="h-4 w-4" />
              ) : isSpecial ? (
                <CreditCard className="h-4 w-4" />
              ) : (
                <UtensilsCrossed className="h-4 w-4" />
              )}
            </span>
            <p className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-950">
              {label}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-bold tracking-[0.08em] text-slate-700">
            {getOrderRef(order.order_code, order.order_number)}
          </p>
        </div>

        <div className="sm:text-right">
          <p className="text-sm font-semibold text-slate-950">
            {summaryText}
          </p>
        </div>

        <div className="sm:text-right">
          <div className={cn(
            "inline-flex items-center gap-1.5 font-mono text-sm font-semibold",
            isUrgent ? "text-destructive" : isWarning ? "text-amber-600" : "text-slate-500"
          )}>
            <Clock className="h-4 w-4 shrink-0" />
            {timeDisplay}
          </div>
        </div>

        <div className="sm:justify-self-end">
          {!readOnly ? (
            <Button
              type="button"
              variant="info"
              size="sm"
              disabled={isMarkingOrderReady || isMarkingReady || isDispatching}
              onClick={(e) => {
                e.stopPropagation();
                onMarkOrderReady(order);
              }}
              className="h-9 min-w-[6.5rem] gap-1.5 rounded-full px-4 text-sm font-semibold"
            >
              <Check className="h-4 w-4 shrink-0" />
              Listo
            </Button>
          ) : (
            <span className="px-4 text-xs text-muted-foreground">Solo consulta</span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 px-4 py-4 sm:px-8">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50">
            <div className="divide-y divide-slate-100">
        {previewableItems.map((item) => {
          const isBulkItem = item.tray_item_type === "C";
          const trimmedItemNote = String(item.item_note ?? "").trim();
          const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");
          const selectedQty = Math.max(1, Math.min(item.quantity_dispatchable || 1, qtyByItem[item.id] ?? 1));
          const canDispatch = item.quantity_dispatchable > 0;
          const remainingToDispatch = item.quantity_dispatchable;
          const dispatchedQuantity = item.quantity_dispatched;
          const isFullyDispatched = item.quantity_pending_prepare === 0 && item.quantity_dispatchable === 0 && dispatchedQuantity > 0;

          return (
            <div key={item.id} className={cn("bg-white/70 px-4 py-4 sm:px-6", isFullyDispatched && "opacity-50 grayscale transition-opacity")}>
              <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {!isBulkItem ? (
                    <div className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                      {item.quantity_ordered}X
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className={cn("break-words whitespace-normal font-medium leading-tight text-[15px]", isFullyDispatched ? "text-slate-500 line-through" : "text-foreground")}>
                      {item.description_snapshot}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-1">
                        {item.modifiers
                          .filter((mod) => String(mod.description ?? "").trim().length > 0)
                          .map((mod, idx) => (
                            <p
                              key={idx}
                              className="break-words whitespace-normal font-semibold text-red-700 text-sm"
                            >
                              - {mod.description}
                            </p>
                          ))}
                      </div>
                    ) : null}
                    {trimmedItemNote ? (
                      <p className={cn(
                        "break-words whitespace-normal text-sm",
                        isDeliveryInstruction
                          ? "font-semibold text-orange-700"
                          : "text-muted-foreground",
                      )}>
                        {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
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
                    <div className="mt-1 flex flex-nowrap gap-x-2 overflow-hidden text-muted-foreground text-sm">
                      {!isBulkItem ? <span className="shrink-0">Env: {item.quantity_ordered}</span> : null}
                      <span className="shrink-0">Desp: {dispatchedQuantity}</span>
                      <span className="shrink-0">Falt: {remainingToDispatch}</span>
                      <span className="shrink-0">Canc: {item.quantity_cancelled}</span>
                    </div>
                  </div>
                </div>

                {!readOnly && canDispatch ? (
                  <div className="flex shrink-0 items-center gap-2 md:justify-end">
                    {isBulkItem ? (
                      <div
                        className="flex items-center justify-center rounded-xl border border-orange-200 bg-orange-50 px-3 font-semibold text-orange-800 h-10 min-w-[5.5rem] text-sm"
                      >
                        ${Number(item.total ?? 0).toFixed(2)}
                      </div>
                    ) : (
                      <QuantityStepper
                        value={selectedQty}
                        min={1}
                        max={Math.max(1, item.quantity_dispatchable)}
                        disabled={isMarkingReady || isDispatching}
                        onChange={(next) => {
                          setQtyByItem((current) => ({ ...current, [item.id]: next }));
                        }}
                        compact={false}
                      />
                    )}

                    {canDispatch && (
                      <Button
                        type="button"
                        variant="success"
                        size="default"
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
          </div>
        </div>
      )}
    </div>
  );
}

export default DispatchCardBase;
