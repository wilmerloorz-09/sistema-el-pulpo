import { useEffect, useState } from "react";
import { OrderItemSummary, OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Clock, Ban, CreditCard, Package, ShoppingBag, UtensilsCrossed, UserRound } from "lucide-react";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";

interface OrderListRowProps {
  order: OrderSummary;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCancel?: (order: OrderSummary) => void;
  onApproveCancellation?: (order: OrderSummary) => void;
  onRejectCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
  showRejectButton?: boolean;
  readOnly?: boolean;
  canAuthorizeCancel?: boolean;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
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
  if (!iso) return "--";

  const time = new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  switch (status) {
    case "PENDING_CANCELLATION":
      return `Solicitada ${time}`;
    case "KITCHEN_DISPATCHED":
      return `Despachada ${time}`;
    case "PAID":
      return `Pagada ${time}`;
    case "CANCELLED":
      return `Anulada ${time}`;
    default:
      return time;
  }
}

function formatCompactEventTime(iso: string | null | undefined, status: string): string {
  if (!iso) return "--";

  const time = new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  switch (status) {
    case "PENDING_CANCELLATION":
      return `Sol. ${time}`;
    case "KITCHEN_DISPATCHED":
      return `Desp. ${time}`;
    case "PAID":
      return `Pag. ${time}`;
    case "CANCELLED":
      return `Anul. ${time}`;
    default:
      return time;
  }
}

function pluralize(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getDisplayQuantity(item: OrderItemSummary, status: OrderSummary["status"]) {
  if (status === "PENDING_CANCELLATION") {
    return Math.max(0, Number(item.quantity_requested ?? item.quantity ?? 0));
  }

  if (status === "CANCELLED" || status === "KITCHEN_DISPATCHED") {
    return Math.max(0, Number(item.quantity ?? 0));
  }

  return Math.max(0, Number(item.quantity_total ?? item.quantity ?? 0));
}

export default function OrderListRow({
  order,
  index,
  isExpanded,
  onToggleExpand,
  onCancel,
  onApproveCancellation,
  onRejectCancel,
  showCancelButton = true,
  showRejectButton = false,
  readOnly = false,
  canAuthorizeCancel = true,
}: OrderListRowProps) {
  const since = order.sent_to_kitchen_at || order.created_at;
  const { elapsed } = useElapsed(since);
  const orderKind = getOrderKind({ orderType: order.order_type, isSpecial: order.is_special });
  const isTakeout = orderKind === "takeout";
  const isSpecial = orderKind === "special";
  const isSentToKitchen = order.status === "SENT_TO_KITCHEN";
  const isPendingCancellationView = order.status === "PENDING_CANCELLATION";
  const isWarning = isSentToKitchen && elapsed > 10 * 60;
  const isUrgent = isSentToKitchen && elapsed > 15 * 60;
  const eventTime = isPendingCancellationView
    ? order.cancel_requested_at
    : order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = isSentToKitchen
    ? formatElapsedHHMMSS(elapsed)
    : formatEventTimeWithLabel(eventTime, order.status);
  const compactTimeDisplay = isSentToKitchen
    ? timeDisplay
    : formatCompactEventTime(eventTime, order.status);
  const footerItemCount = isPendingCancellationView ? order.items.length : (order.item_count || 0);
  const realTotal = Number(order.total || 0);
  const specialManualTotal = isSpecial ? Number(order.special_total_manual ?? 0) : null;
  const displayedUnits = order.items.reduce((sum, item) => sum + getDisplayQuantity(item, order.status), 0);
  const dispatchedUnits = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity_dispatched ?? 0)), 0);
  const remainingUnits = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity_remaining ?? 0)), 0);

  let summaryPrimary = pluralize(displayedUnits, "item visible", "items visibles");
  if (order.status === "SENT_TO_KITCHEN") {
    summaryPrimary = remainingUnits > 0
      ? `${pluralize(remainingUnits, "cantidad pendiente", "cantidades pendientes")}`
      : "Sin pendientes visibles";
  } else if (order.status === "KITCHEN_DISPATCHED") {
    summaryPrimary = pluralize(displayedUnits, "cantidad despachada", "cantidades despachadas");
  } else if (order.status === "PENDING_CANCELLATION") {
    summaryPrimary = pluralize(displayedUnits, "cantidad solicitada", "cantidades solicitadas");
  } else if (order.status === "CANCELLED") {
    summaryPrimary = pluralize(displayedUnits, "cantidad anulada", "cantidades anuladas");
  } else if (order.status === "PAID") {
    summaryPrimary = pluralize(displayedUnits, "cantidad cobrada", "cantidades cobradas");
  }

  const summarySecondaryParts: string[] = [
    pluralize(footerItemCount, "item", "items"),
  ];
  if (dispatchedUnits > 0 && order.status !== "KITCHEN_DISPATCHED") {
    summarySecondaryParts.push(`${dispatchedUnits} desp.`);
  }
  if (remainingUnits > 0 && order.status !== "SENT_TO_KITCHEN") {
    summarySecondaryParts.push(`${remainingUnits} falt.`);
  }
  const summarySecondary = summarySecondaryParts.join(" - ");
  const mobileSummaryPrimary = order.status === "SENT_TO_KITCHEN"
    ? `${remainingUnits} pend.`
    : order.status === "KITCHEN_DISPATCHED"
      ? `${displayedUnits} desp.`
      : order.status === "PENDING_CANCELLATION"
        ? `${displayedUnits} solic.`
        : order.status === "CANCELLED"
          ? `${displayedUnits} anul.`
          : order.status === "PAID"
            ? `${displayedUnits} cobr.`
            : `${displayedUnits} vis.`;
  const mobileSummaryParts = [`${mobileSummaryPrimary}`, `${footerItemCount} items`];
  if (isSpecial) {
    mobileSummaryParts.push(`Real ${formatCurrency(realTotal)}`);
  }
  const mobileSummary = mobileSummaryParts.join(" - ");
  const mobileAmount = isSpecial
    ? formatCurrency(specialManualTotal ?? 0)
    : formatCurrency(realTotal);

  const canShowMainAction =
    !readOnly &&
    order.status !== "PAID" &&
    showCancelButton &&
    (Boolean(onCancel) || Boolean(onApproveCancellation));
  const canShowRejectAction =
    !readOnly &&
    order.status !== "PAID" &&
    showRejectButton &&
    isPendingCancellationView &&
    canAuthorizeCancel &&
    Boolean(onRejectCancel);

  const actionLabel = isPendingCancellationView
    ? canAuthorizeCancel
      ? "Autorizar anulacion"
      : "Respuesta pendiente"
    : "Anular pedido";

  const actionVariant = isPendingCancellationView
    ? canAuthorizeCancel
      ? "default"
      : "secondary"
    : "destructive";

  const label = getOrderOriginLabel({
    orderType: order.order_type,
    tableName: order.table_name || order.table_name_snapshot || null,
    splitCode: order.split_code,
    isSpecial: order.is_special,
  });

  const renderActions = (compact = false) => {
    const compactMainActionLabel = isPendingCancellationView
      ? canAuthorizeCancel
        ? "Autorizar"
        : "Pendiente"
      : "Anular";

    if (readOnly) {
      return <span className="px-1 text-xs text-muted-foreground whitespace-nowrap">{compact ? "Consulta" : "Solo consulta"}</span>;
    }

    if (!canShowMainAction && !canShowRejectAction) return null;

    return (
      <div className={cn("flex items-center gap-2 lg:justify-end", compact ? "flex-nowrap" : "flex-wrap")}>
        {canShowRejectAction && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "rounded-full border-amber-300 font-semibold text-amber-800 hover:bg-amber-50 whitespace-nowrap",
              compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-4",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onRejectCancel?.(order);
            }}
          >
            {compact ? "Negar" : "Negar anulacion"}
          </Button>
        )}

        {canShowMainAction && (
          <Button
            type="button"
            variant={actionVariant}
            size="sm"
            disabled={isPendingCancellationView && !canAuthorizeCancel}
            className={cn(
              "rounded-full font-semibold whitespace-nowrap",
              compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-4",
              isPendingCancellationView && canAuthorizeCancel && "border-amber-500 bg-amber-600 text-white hover:bg-amber-700",
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (isPendingCancellationView && onApproveCancellation) {
                onApproveCancellation(order);
                return;
              }
              onCancel?.(order);
            }}
          >
            <Ban className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {compact ? compactMainActionLabel : actionLabel}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className={cn(
      "rounded-2xl border border-slate-200 shadow-sm transition-shadow hover:shadow-md overflow-hidden",
      index % 2 === 0 ? "bg-white" : "bg-slate-100"
    )}>
      <div
        onClick={onToggleExpand}
        className={cn(
          "group flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-4 py-4 lg:px-6 transition-colors",
          "cursor-pointer hover:bg-slate-50",
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
            {isTakeout ? (
              <ShoppingBag className="h-5 w-5" />
            ) : isSpecial ? (
              <CreditCard className="h-5 w-5" />
            ) : (
              <UtensilsCrossed className="h-5 w-5" />
            )}
          </span>

          <div className="flex flex-col min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950 lg:text-base">
                {label}
              </p>
              <p className="font-mono text-sm font-bold tracking-wider text-slate-700">
                {getOrderRef(order.order_code, order.order_number)}
              </p>
            </div>
            
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
              {order.created_by_name && (
                <span className="flex items-center gap-1 truncate">
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{order.created_by_name}</span>
                </span>
              )}
              <span className="flex items-center gap-1 truncate font-semibold text-slate-700">
                {summaryPrimary}
              </span>
              <span className="hidden lg:inline">{summarySecondary}</span>
            </div>
          </div>
        </div>

        {/* Middle Section: Money and Time */}
        <div className="flex flex-row items-center justify-between lg:justify-end gap-4 shrink-0 pl-11 lg:pl-0 mt-2 lg:mt-0">
           <div className="flex flex-wrap items-center gap-2">
             <span className="text-[1.15rem] font-bold tracking-[-0.03em] text-slate-950">
               {formatCurrency(isSpecial ? (specialManualTotal ?? 0) : realTotal)}
             </span>
             {isPendingCancellationView && (
               <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                 Solicitud pendiente
               </span>
             )}
             {isSpecial && (
               <span className="text-xs font-semibold text-slate-500">
                 (Real {formatCurrency(realTotal)})
               </span>
             )}
           </div>
           
          <div className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-bold shadow-sm",
            isUrgent ? "border-red-200 bg-red-50 text-red-700" : isWarning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-700"
          )}>
            <Clock className="h-4 w-4 shrink-0" />
            <span>{timeDisplay}</span>
          </div>
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center justify-start lg:justify-end gap-2 pl-11 lg:pl-0 shrink-0 mt-2 lg:mt-0">
          {renderActions(false)}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/70">
          <div className="overflow-hidden rounded-2xl">
            <div className="hidden grid-cols-[minmax(0,1.75fr)_100px_90px_90px_110px] gap-3 border-b border-slate-200/60 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 lg:grid">
              <span>Detalle</span>
              <span className="text-right">{isPendingCancellationView ? "Solic." : "Cant."}</span>
              <span className="text-right">Desp.</span>
              <span className="text-right">Falt.</span>
              <span className="text-right">Subtotal</span>
            </div>

            <div className="divide-y divide-slate-200/60">
              {order.items.map((item) => {
                const isBulkItem = item.tray_item_type === "C";
                const visibleQty = getDisplayQuantity(item, order.status);
                const trimmedItemNote = String(item.item_note ?? "").trim();
                const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");

                return (
                  <div
                    key={item.id}
                    className="grid gap-2 px-4 py-4 text-sm lg:grid-cols-[minmax(0,1.75fr)_100px_90px_90px_110px] lg:gap-3 lg:px-8"
                  >
                    <div className="min-w-0">
                      <p className="break-words whitespace-normal font-medium text-slate-900">
                        {item.description_snapshot || "Item sin nombre"}
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {item.tray_item_type ? (
                          <TrayItemChip type={item.tray_item_type as TrayItemType} size="xs" />
                        ) : null}
                        {item.status === "ITEM_PENDING_CANCELLATION" && (
                          <Badge variant="secondary" className="border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-800">
                            Petición de anulación
                          </Badge>
                        )}
                      </div>

                      {item.modifiers.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5 text-xs font-semibold text-red-600">
                          {(() => {
                            const modCounts: Record<string, { description: string; count: number; firstId: string }> = {};
                            for (const mod of item.modifiers) {
                              const desc = (mod.description || "").trim();
                              if (!desc) continue;
                              const key = desc.toLowerCase();
                              if (!modCounts[key]) {
                                modCounts[key] = { description: desc, count: visibleQty, firstId: (mod as any).id || "mod" };
                              } else {
                                modCounts[key].count += visibleQty;
                              }
                            }
                            return Object.values(modCounts);
                          })().map((mc) => (
                            <p
                              key={`${item.id}-modifier-${mc.firstId}`}
                              className="break-words whitespace-normal"
                            >
                              - {mc.description} {mc.count > 1 ? `(${mc.count})` : ""}
                            </p>
                          ))}
                        </div>
                      )}

                      {trimmedItemNote && (
                        <p
                          className={cn(
                            "mt-1 break-words whitespace-normal",
                            isDeliveryInstruction
                              ? "text-sm font-semibold text-orange-700"
                              : "text-xs italic text-slate-500",
                          )}
                        >
                          {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs lg:contents lg:text-sm">
                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-700 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
                        {!isBulkItem ? <span className="mr-1 font-medium text-slate-500 lg:hidden">Cant.</span> : null}
                        {isBulkItem ? "A granel" : visibleQty}
                      </span>
                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-600 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
                        <span className="mr-1 font-medium text-slate-500 lg:hidden">Desp.</span>
                        {item.quantity_dispatched ?? 0}
                      </span>
                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-600 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
                        <span className="mr-1 font-medium text-slate-500 lg:hidden">Falt.</span>
                        {item.quantity_remaining ?? 0}
                      </span>
                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center font-medium text-slate-900 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
                        <span className="mr-1 font-medium text-slate-500 lg:hidden">Subtotal</span>
                        {formatCurrency(Number(item.total ?? 0))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200/60 bg-slate-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Package className="h-4 w-4" />
                <span>{pluralize(footerItemCount, "item", "items")}</span>
              </div>

              <div className="text-right">
                <p className="text-[15px] font-black text-slate-900">
                  {formatCurrency(isSpecial ? (specialManualTotal ?? 0) : realTotal)}
                </p>
                {isSpecial && (
                  <p className="text-xs text-slate-500">
                    Total real visible: {formatCurrency(realTotal)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
