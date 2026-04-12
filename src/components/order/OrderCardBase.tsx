import { useState, useEffect } from "react";
import { OrderItemSummary, OrderSummary } from "@/hooks/useOrdersByStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, UtensilsCrossed, ShoppingBag, DollarSign, Package, Eye, Ban } from "lucide-react";
import { getOrderKind, getOrderOriginLabel } from "@/lib/orderPresentation";
import { cn, formatElapsedHHMMSS } from "@/lib/utils";

const CARD_SUMMARY_LIMITS = {
  maxModifiersPerItem: 2,
  maxModifiersTotal: 4,
} as const;

type CardItemSummary = OrderItemSummary & {
  visibleModifiers: { description: string }[];
  hiddenModifiersCount: number;
  hasNote: boolean;
};

type CardItemStage = "sent" | "partial" | "dispatched" | "neutral";

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

function formatEventTimeWithLabel(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function buildCardSummary(items: OrderItemSummary[]) {
  const activeItems = items.filter((item) => item.status !== "DRAFT");
  const visibleItems: CardItemSummary[] = [];
  let remainingModifierBudget = CARD_SUMMARY_LIMITS.maxModifiersTotal;

  for (const item of activeItems) {
    const validModifiers = (item.modifiers ?? []).filter(
      (modifier) => String(modifier.description ?? "").trim().length > 0,
    );
    const visibleModifierCount = Math.max(
      0,
      Math.min(CARD_SUMMARY_LIMITS.maxModifiersPerItem, remainingModifierBudget, validModifiers.length),
    );
    const visibleModifiers = validModifiers.slice(0, visibleModifierCount);

    remainingModifierBudget = Math.max(0, Number(remainingModifierBudget) - visibleModifiers.length);

    visibleItems.push({
      ...item,
      visibleModifiers,
      hiddenModifiersCount: Math.max(0, validModifiers.length - visibleModifiers.length),
      hasNote: String(item.item_note ?? "").trim().length > 0,
    });
  }

  return { visibleItems };
}

function getCardItemStage(item: OrderItemSummary, orderStatus: OrderSummary["status"]): CardItemStage {
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));

  if (orderStatus === "KITCHEN_DISPATCHED" || (dispatchedQty > 0 && remainingQty === 0)) {
    return "dispatched";
  }

  if (dispatchedQty > 0 && remainingQty > 0) {
    return "partial";
  }

  if (orderStatus === "SENT_TO_KITCHEN" || remainingQty > 0) {
    return "sent";
  }

  return "neutral";
}

function getCardItemStageClasses(stage: CardItemStage) {
  switch (stage) {
    case "sent":
      return {
        container: "border-orange-200 bg-orange-50/70",
        badge: "border-orange-300 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
        total: "text-orange-700",
      };
    case "partial":
      return {
        container: "border-amber-200 bg-amber-50/80",
        badge: "border-amber-300 bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950",
        total: "text-amber-800",
      };
    case "dispatched":
      return {
        container: "border-emerald-200 bg-emerald-50/80",
        badge: "border-emerald-300 bg-gradient-to-r from-emerald-500 to-teal-400 text-white",
        total: "text-emerald-800",
      };
    default:
      return {
        container: "border-slate-200 bg-white",
        badge: "border-orange-300 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
        total: "text-primary",
      };
  }
}

interface OrderCardBaseProps {
  order: OrderSummary;
  onCancel?: (order: OrderSummary) => void;
  onApproveCancellation?: (order: OrderSummary) => void;
  onRejectCancel?: (order: OrderSummary) => void;
  showCancelButton?: boolean;
  showRejectButton?: boolean;
  showEyeIcon?: boolean;
  onEyeClick?: () => void;
  readOnly?: boolean;
  canAuthorizeCancel?: boolean;
}

export function OrderCardBase({
  order,
  onCancel,
  onApproveCancellation,
  onRejectCancel,
  showCancelButton = true,
  showRejectButton = false,
  showEyeIcon = false,
  onEyeClick,
  readOnly = false,
  canAuthorizeCancel = true,
}: OrderCardBaseProps) {
  const since = order.sent_to_kitchen_at || order.created_at;
  const { elapsed } = useElapsed(since);
  const { visibleItems } = buildCardSummary(order.items ?? []);
  const orderKind = getOrderKind({ orderType: order.order_type, isSpecial: order.is_special });
  const isTakeout = orderKind === "takeout";
  const isSpecial = orderKind === "special";

  const isSentToKitchen = order.status === "SENT_TO_KITCHEN";
  const isDispatchedView = order.status === "KITCHEN_DISPATCHED";
  const isPendingCancellationView = order.status === "PENDING_CANCELLATION";
  const isCancelledView = order.status === "CANCELLED";
  const isWarning = isSentToKitchen && elapsed > 10 * 60;
  const isCancelRequested = isPendingCancellationView;
  const footerItemCount = isPendingCancellationView ? visibleItems.length : (order.item_count || 0);
  const specialManualTotal = isSpecial ? Number(order.special_total_manual ?? 0) : null;
  const realTotal = Number(order.total || 0);

  const eventTime = order.ready_at ?? order.dispatched_at ?? order.paid_at ?? order.cancelled_at ?? null;
  const timeDisplay = isSentToKitchen ? formatElapsedHHMMSS(elapsed) : formatEventTimeWithLabel(eventTime);

  return (
    <div
      className={cn(
        "flex self-start flex-col overflow-hidden rounded-2xl border-2 bg-card transition-colors",
        isSpecial ? "bg-gradient-to-br from-orange-50 via-white to-amber-50" : isTakeout ? "bg-gradient-to-br from-emerald-50 via-white to-lime-50" : "bg-gradient-to-br from-sky-50 via-white to-cyan-50",
        isWarning ? "border-warning/50 shadow-md shadow-warning/10" : "border-border",
      )}
    >
      <div className={cn("flex items-center justify-between border-b border-border px-4 py-3", isSpecial ? "bg-orange-100/55" : isTakeout ? "bg-emerald-100/55" : "bg-sky-100/55")}>
        <div className="min-w-0 flex items-center gap-2">
          {isTakeout ? (
            <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : isSpecial ? (
            <DollarSign className="h-4 w-4 shrink-0 text-orange-700" />
          ) : (
            <UtensilsCrossed className="h-4 w-4 shrink-0 text-sky-700" />
          )}
          <span className="truncate font-display text-sm font-bold">
            {getOrderOriginLabel({
              orderType: order.order_type,
              tableName: order.table_name,
              splitCode: order.split_code,
              isSpecial: order.is_special,
            })}
          </span>
          <span className="shrink-0 font-display text-xs text-muted-foreground">
            {order.order_code ?? String(order.order_number)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs font-mono font-semibold",
              isWarning ? "text-amber-600" : "text-muted-foreground",
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

      {isCancelRequested && order.status !== "CANCELLED" && (
        <div className="border-y border-amber-200 bg-amber-100/80 px-4 py-2 text-center text-xs font-bold text-amber-900 shadow-inner">
          Anulacion solicitada
        </div>
      )}

      <div className="max-h-[19rem] overflow-y-auto px-4 py-3 pr-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-100 px-2 py-1 text-orange-800">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            En cocina
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-amber-900">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Parcial despachado
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-emerald-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Despachado
          </span>
        </div>
        <div className="space-y-3">
          {visibleItems.map((item) => {
            const itemStage = getCardItemStage(item, order.status);
            const itemStageClasses = getCardItemStageClasses(itemStage);

            return (
            <div
              key={item.id}
              className={cn("flex items-start justify-between gap-2 rounded-2xl border px-3 py-3 text-sm", itemStageClasses.container)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <Badge className={cn("min-w-[2.35rem] justify-center rounded-md px-1.5 py-0.5 text-[11px] font-black leading-none shadow-[0_10px_18px_-16px_rgba(15,23,42,0.35)]", itemStageClasses.badge)}>
                    {(
                      isPendingCancellationView
                        ? item.quantity_requested
                        : isCancelledView
                          ? item.quantity
                        : isDispatchedView
                          ? item.quantity
                          : (item.quantity_total || item.quantity)
                    ) || 1}x
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="break-words whitespace-normal text-sm font-medium text-foreground">
                      {item.description_snapshot || "Item sin nombre"}
                    </p>

                    {item.visibleModifiers.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {item.visibleModifiers.map((modifier, index) => (
                          <p
                            key={`${item.id}-modifier-${index}-${modifier.description}`}
                            className="w-fit max-w-full truncate rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                          >
                            - {modifier.description}
                          </p>
                        ))}
                      </div>
                    )}

                    {item.hiddenModifiersCount > 0 && (
                      <p className="mt-1 text-xs font-bold text-red-700">
                        +{item.hiddenModifiersCount} modificacion
                        {item.hiddenModifiersCount !== 1 ? "es" : ""} mas
                      </p>
                    )}

                    {item.hasNote && (
                      <p className="mt-1 pl-2 text-xs italic text-muted-foreground">Nota adicional</p>
                    )}

                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Despachado: {item.quantity_dispatched ?? 0}</span>
                      <span>Falta: {item.quantity_remaining ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
              <span className={cn("ml-auto shrink-0 text-sm font-semibold", itemStageClasses.total)}>
                ${item.total ? item.total.toFixed(2) : "0.00"}
              </span>
            </div>
          )})}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border px-4 py-3 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Package className="h-4 w-4" />
          <span>{footerItemCount} item{footerItemCount !== 1 ? "s" : ""}</span>
        </div>
        {isSpecial ? (
          <div className="text-right">
            <div className="flex items-center justify-end gap-1 font-semibold text-primary">
              <DollarSign className="h-4 w-4" />
              <span>{(specialManualTotal ?? 0).toFixed(2)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Real: ${realTotal.toFixed(2)}</p>
          </div>
        ) : (
          <div className="flex items-center gap-1 font-semibold text-primary">
            <DollarSign className="h-4 w-4" />
            <span>{realTotal.toFixed(2)}</span>
          </div>
        )}
      </div>

      {readOnly && (
        <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          Modo consulta
        </div>
      )}

      {!readOnly && order.status !== "PAID" && ((showCancelButton && (onCancel || onApproveCancellation)) || (showRejectButton && onRejectCancel)) && (
        <div className="border-t border-border px-4 py-3">
          <div className={cn("flex gap-2", showRejectButton ? "flex-col sm:flex-row" : "flex-col")}>
            {showRejectButton && isCancelRequested && canAuthorizeCancel && onRejectCancel && (
              <Button
                onClick={() => onRejectCancel(order)}
                variant="outline"
                className="h-10 w-full rounded-xl border-amber-300 font-display font-semibold text-amber-800 hover:bg-amber-50"
              >
                Negar anulacion
              </Button>
            )}

            {showCancelButton && (onCancel || onApproveCancellation) && (
              <Button
                onClick={() => {
                  if (isPendingCancellationView && onApproveCancellation) {
                    onApproveCancellation(order);
                    return;
                  }
                  onCancel?.(order);
                }}
                variant={isCancelRequested && canAuthorizeCancel ? "default" : isCancelRequested ? "secondary" : "destructive"}
                className={cn(
                  "h-10 w-full rounded-xl font-display font-semibold gap-2",
                  isCancelRequested && canAuthorizeCancel && "bg-amber-600 text-white hover:bg-amber-700",
                  isCancelRequested && !canAuthorizeCancel && "opacity-50 pointer-events-none"
                )}
              >
                <Ban className="h-4 w-4" />
                {isCancelRequested && canAuthorizeCancel
                  ? "Autorizar anulacion"
                  : isCancelRequested
                    ? "Respuesta pendiente"
                    : "Anular pedido"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default OrderCardBase;
