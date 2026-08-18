import { useEffect, useMemo, useState } from "react";
import type { DispatchOrder, DispatchOrderItem } from "@/hooks/useDispatchOrders";
import { Button } from "@/components/ui/button";
import { Clock, Check, Loader2, Minus, Plus, ShoppingBag, Truck, UtensilsCrossed, ChevronDown, ChevronUp, CreditCard, Lock, UserRound } from "lucide-react";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import {
  computeDispatchItemCatalogTotal,
  prorateOrderChargeAmount,
  resolveDispatchPendingChargeTotal,
} from "@/lib/orderFlow";
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
  onDispatchAll: (order: DispatchOrder) => void;
  isMarkingOrderReady?: boolean;
  isMarkingReady?: boolean;
  isDispatching?: boolean;
  isDispatchingOrder?: boolean;
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

function formatMoney(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

/** Misma lógica que en `OrderListRow` (mesa / órdenes): conteo por modificador alineado a la cantidad de línea. */
function consolidateModifiersForDisplay(
  modifiers: { description: string }[],
  lineVisibleQty: number,
): Array<{ description: string; count: number; key: string }> {
  const modCounts: Record<string, { description: string; count: number; firstId: string }> = {};
  for (const mod of modifiers) {
    const desc = (mod.description || "").trim();
    if (!desc) continue;
    const key = desc.toLowerCase();
    if (!modCounts[key]) {
      modCounts[key] = { description: desc, count: lineVisibleQty, firstId: key };
    } else {
      modCounts[key].count += lineVisibleQty;
    }
  }
  return Object.values(modCounts).map((mc) => ({
    description: mc.description,
    count: mc.count,
    key: mc.firstId,
  }));
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
        type="text"
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
  onDispatchAll,
  isMarkingOrderReady = false,
  isMarkingReady = false,
  isDispatching = false,
  isDispatchingOrder = false,
  readOnly = false,
}: DispatchCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.updated_at;
  const { elapsed } = useElapsed(since);
  const orderKind = getOrderKind({ orderType: order.order_type, isSpecial: order.is_special, isTrayOrder: order.is_tray_order });
  const isTakeout = orderKind === "takeout";
  const isSpecial = orderKind === "special";
  const isTray = orderKind === "tray";
  const usesOrderLevelDispatch = isTakeout || isSpecial;
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
  const dispatchAllBusy = isDispatching || isDispatchingOrder;
  const dispatchAllDisabled = order.locked_for_editing || dispatchAllBusy || !canDispatchAny;
  // Solo unidades pendientes de servir/despachar (no mostrar ya despachadas).
  const previewableItems = useMemo(
    () => order.items.filter((item) => item.quantity_dispatchable > 0),
    [order.items],
  );
  const {
    pendingTotal,
    chargeTotal: specialChargeTotal,
    catalogOrderTotal,
  } = useMemo(
    () => resolveDispatchPendingChargeTotal({
      is_special: order.is_special,
      special_total_manual: order.special_total_manual,
      special_group_total: order.special_group_total,
      items: order.items,
    }),
    [order.is_special, order.items, order.special_group_total, order.special_total_manual],
  );

  const summaryParts: string[] = [];
  if (order.pending_prepare_count > 0) summaryParts.push(`${order.pending_prepare_count} pendientes`);
  if (order.ready_available_count > 0) summaryParts.push(`${order.ready_available_count} listos`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join(" - ") : "Sin acciones pendientes";

  return (
    <div className={cn(
      "rounded-2xl border shadow-sm transition-shadow hover:shadow-md overflow-hidden",
      order.is_packer_order 
        ? "border-red-600 bg-yellow-300 ring-4 ring-red-500" 
        : cn("border-slate-200", index % 2 === 0 ? "bg-white" : "bg-slate-100")
    )}>
      <div
        onClick={onToggleExpand}
        className={cn(
          "group flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-4 py-4 lg:px-6 transition-colors",
          "cursor-pointer",
          order.is_packer_order ? "hover:bg-yellow-400" : "hover:bg-slate-50",
        )}
      >
        {/* Left Section: Chevron, Icon, Type, User, Order Ref */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800"
            aria-label={isExpanded ? "Ocultar detalle" : "Mostrar detalle"}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>

          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            {isTray ? (
              <ShoppingBag className="h-5 w-5" />
            ) : isTakeout ? (
              <ShoppingBag className="h-5 w-5" />
            ) : isSpecial ? (
              <CreditCard className="h-5 w-5" />
            ) : (
              <UtensilsCrossed className="h-5 w-5" />
            )}
          </span>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950 lg:text-base">
                {label}
              </p>
              {order.locked_for_editing && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                  <Lock className="h-3 w-3" /> Editando
                </span>
              )}
            </div>
            
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
              <span className="font-mono font-bold text-slate-700 tracking-wider">
                {getOrderRef(order.order_code, order.order_number)}
              </span>
              {order.created_by_name && (
                <span className="flex items-center gap-1 truncate">
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{order.created_by_name}</span>
                </span>
              )}
              {order.is_special && order.table_name ? (
                <span className="flex items-center gap-1 truncate font-semibold text-orange-700">
                  <UtensilsCrossed className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Mesa {order.table_name}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Middle Section: Summary & Time (Desktop) */}
        <div className="hidden lg:flex items-center gap-6 shrink-0 px-4">
          <div className="text-right">
            <p className="truncate text-[13px] font-semibold text-slate-700">
              {summaryText}
            </p>
            <p className="mt-0.5 text-sm font-black text-emerald-700">
              Total pendiente {formatMoney(pendingTotal)}
            </p>
          </div>
          <div className={cn(
            "flex shrink-0 items-center justify-end gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-bold shadow-sm",
            isUrgent ? "border-red-200 bg-red-50 text-red-700" : isWarning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-700"
          )}>
            <Clock className="h-4 w-4 shrink-0" />
            <span>{timeDisplay}</span>
          </div>
        </div>

        {/* Mobile Middle Section */}
        <div className="flex lg:hidden items-center justify-between pl-11">
          <div>
             <p className="text-xs font-semibold text-slate-700">{summaryText}</p>
             <p className="mt-0.5 text-xs font-black text-emerald-700">Total pendiente {formatMoney(pendingTotal)}</p>
          </div>
          <div className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold shadow-sm",
            isUrgent ? "border-red-200 bg-red-50 text-red-700" : isWarning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-700"
          )}>
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>{timeDisplay}</span>
          </div>
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center justify-end gap-2 pl-11 lg:pl-0 shrink-0">
          {!readOnly ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={order.locked_for_editing || isMarkingOrderReady || isMarkingReady || isDispatching || (usesOrderLevelDispatch && !canDispatchAny)}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkOrderReady(order);
                }}
                className="h-10 gap-1.5 rounded-xl border-blue-200 bg-blue-50 px-5 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-100 hover:text-blue-800"
              >
                {order.locked_for_editing ? <Lock className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                <span className="hidden lg:inline">{order.locked_for_editing ? "Editando" : "Listo"}</span>
                <span className="lg:hidden">Listo</span>
              </Button>
              
              {canDispatchAny && (
                <Button
                  type="button"
                  size="sm"
                  disabled={dispatchAllDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDispatchAll(order);
                  }}
                  className="h-10 gap-1.5 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-slate-800"
                >
                  {isDispatchingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                  <span className="hidden lg:inline">Despachar todo</span>
                  <span className="lg:hidden">Todo</span>
                </Button>
              )}
            </>
          ) : (
            <span className="px-2 text-xs font-medium text-slate-400">Solo consulta</span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/70">
          <div className="divide-y divide-slate-200/60">
        {previewableItems.map((item) => {
          const isBulkItem = item.tray_item_type === "C";
          const trimmedItemNote = String(item.item_note ?? "").trim();
          const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");
          const remainingToDispatch = Math.max(0, item.quantity_dispatchable);
          const selectedQty = Math.max(1, Math.min(remainingToDispatch || 1, qtyByItem[item.id] ?? 1));
          const canDispatch = remainingToDispatch > 0;
          const remainingCatalogTotal = computeDispatchItemCatalogTotal(item, remainingToDispatch);
          const remainingLineTotal = specialChargeTotal != null && catalogOrderTotal > 0
            ? prorateOrderChargeAmount(specialChargeTotal, remainingCatalogTotal, catalogOrderTotal)
            : remainingCatalogTotal;

          return (
            <div key={item.id} className="px-4 py-4 lg:px-8">
              <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  {!isBulkItem ? (
                    <div className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                      {remainingToDispatch}X
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="break-words whitespace-normal font-medium leading-tight text-[15px] text-foreground">
                      {item.description_snapshot}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-1">
                        {consolidateModifiersForDisplay(item.modifiers, remainingToDispatch).map((mc) => (
                          <p
                            key={`${item.id}-modifier-${mc.key}`}
                            className="break-words whitespace-normal text-sm font-semibold text-red-700"
                          >
                            - {mc.description}
                            {mc.count > 1 ? ` (${mc.count})` : ""}
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

                    <div className="mt-1 text-sm font-semibold text-slate-800">
                      {isBulkItem ? (
                        <span>{formatMoney(remainingLineTotal)}</span>
                      ) : specialChargeTotal != null ? (
                        <span>
                          {formatMoney(remainingLineTotal)}
                          <span className="ml-1 text-xs font-semibold text-orange-700">cobro manual</span>
                          {remainingLineTotal !== remainingCatalogTotal ? (
                            <span className="mt-0.5 block text-xs font-medium text-slate-500">
                              Ref. {formatMoney(item.unit_price)} x {remainingToDispatch} = {formatMoney(remainingCatalogTotal)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span>{formatMoney(item.unit_price)} x {remainingToDispatch} = {formatMoney(remainingLineTotal)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {!readOnly && canDispatch && !usesOrderLevelDispatch ? (
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
                        disabled={order.locked_for_editing || isDispatching || isMarkingReady}
                        onClick={(e) => {
                          e.stopPropagation();
                          const remainingQty = Math.max(0, item.quantity_dispatchable - selectedQty);
                          setQtyByItem((current) => ({
                            ...current,
                            [item.id]: Math.max(1, remainingQty),
                          }));
                          onDispatchItem(order, item, selectedQty);
                        }}
                      >
                        {order.locked_for_editing ? <Lock className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
                        {order.locked_for_editing ? "Editando" : "Despachar"}
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
      )}
    </div>
  );
}

export default DispatchCardBase;
