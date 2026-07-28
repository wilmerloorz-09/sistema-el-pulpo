import { useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import type { PayableOrder } from "@/hooks/useCaja";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GlassWater, RotateCcw, Soup } from "lucide-react";

function clampQty(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isDrinkItem(description: string) {
  return /(cola|gaseosa|bebida|jugo|agua|te|cafe|cerveza|personal|limonada|sprite|fanta|coca)/i.test(description);
}

function ProductAvatar({
  description,
  imageUrl,
  tone = "neutral",
}: {
  description: string;
  imageUrl?: string | null;
  tone?: "neutral" | "selected";
}) {
  if (imageUrl) {
    return (
      <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-stone-200 bg-white">
        <img src={imageUrl} alt={description} className="h-full w-full object-cover" />
      </span>
    );
  }

  const toneClass = tone === "selected" ? "bg-orange-100 text-orange-700" : "bg-stone-100 text-slate-600";

  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", toneClass)}>
      {isDrinkItem(description) ? <GlassWater className="h-4 w-4" /> : <Soup className="h-4 w-4" />}
    </span>
  );
}

export interface PaymentItemSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PayableOrder;
  /** Cantidad a cobrar por linea (clave = order_items.id). Maximo por linea = quantity_pending del item. */
  qtyByItemId: Record<string, number>;
  onQtyByItemIdChange: (next: Record<string, number>) => void;
  readOnly?: boolean;
}

export function PaymentItemSplitDialog({
  open,
  onOpenChange,
  order,
  qtyByItemId,
  onQtyByItemIdChange,
  readOnly = false,
}: PaymentItemSplitDialogProps) {
  const restrictMovingBackToPending = order.order_type === "TAKEOUT" || Boolean(order.is_special);

  const unpaidItems = useMemo(
    () => (order.items ?? []).filter((item) => Number(item.quantity_pending ?? 0) > 0),
    [order.items],
  );

  const setItemQty = (itemId: string, qty: number, maxQty: number) => {
    const normalized = Number.isFinite(qty) ? Math.floor(qty) : 0;
    let nextQty = clampQty(normalized, 0, maxQty);
    if (restrictMovingBackToPending) {
      const prevQty = qtyByItemId[itemId] ?? 0;
      if (nextQty < prevQty) nextQty = prevQty;
    }
    onQtyByItemIdChange({
      ...qtyByItemId,
      [itemId]: nextQty,
    });
  };

  const moveOneToCharge = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (qtyByItemId[itemId] ?? 0) + 1, maxQty);
  };

  const moveAllToCharge = (itemId: string, maxQty: number) => {
    setItemQty(itemId, maxQty, maxQty);
  };

  const moveOneBackToPending = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (qtyByItemId[itemId] ?? 0) - 1, maxQty);
  };

  const moveAllBackToPending = (itemId: string, maxQty: number) => {
    setItemQty(itemId, 0, maxQty);
  };

  const fillAllToCharge = () => {
    const next: Record<string, number> = { ...qtyByItemId };
    for (const item of unpaidItems) {
      next[item.id] = item.quantity_pending;
    }
    onQtyByItemIdChange(next);
  };

  const clearAllSelection = () => {
    if (restrictMovingBackToPending) return;
    const next: Record<string, number> = { ...qtyByItemId };
    for (const item of unpaidItems) {
      next[item.id] = 0;
    }
    onQtyByItemIdChange(next);
  };

  const groupedUnpaidItems = useMemo(() => {
    const groups: Record<string, typeof unpaidItems> = {};
    for (const item of unpaidItems) {
      const key = `${item.description_snapshot}_${item.unit_price}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.values(groups);
  }, [unpaidItems]);

  const pendingItemsForNow = useMemo(
    () =>
      groupedUnpaidItems
        .map((group) => {
          const qty = group.reduce(
            (sum, item) => sum + Math.max(0, item.quantity_pending - (qtyByItemId[item.id] ?? 0)),
            0,
          );
          if (qty <= 0) return null;
          return {
            ...group[0],
            quantity_available_now: qty,
            groupItems: group,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [groupedUnpaidItems, qtyByItemId],
  );

  const selectedItemsForNow = useMemo(
    () =>
      groupedUnpaidItems
        .map((group) => {
          const qty = group.reduce((sum, item) => sum + (qtyByItemId[item.id] ?? 0), 0);
          if (qty <= 0) return null;
          return {
            ...group[0],
            quantity_to_charge_now: qty,
            groupItems: group,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [groupedUnpaidItems, qtyByItemId],
  );

  const moveOneGroupToCharge = (group: typeof unpaidItems) => {
    const target = group.find((item) => item.quantity_pending - (qtyByItemId[item.id] ?? 0) > 0);
    if (target) moveOneToCharge(target.id, target.quantity_pending);
  };

  const moveAllGroupToCharge = (group: typeof unpaidItems) => {
    for (const item of group) {
      moveAllToCharge(item.id, item.quantity_pending);
    }
  };

  const moveOneGroupBackToPending = (group: typeof unpaidItems) => {
    const target = [...group].reverse().find((item) => (qtyByItemId[item.id] ?? 0) > 0);
    if (target) moveOneBackToPending(target.id, target.quantity_pending);
  };

  const moveAllGroupBackToPending = (group: typeof unpaidItems) => {
    for (const item of group) {
      moveAllBackToPending(item.id, item.quantity_pending);
    }
  };

  const pendingAmountForNow = useMemo(
    () =>
      roundMoney(
        pendingItemsForNow.reduce(
          (sum, item) => sum + computeLineAmount(item.quantity_available_now, item.unit_price),
          0,
        ),
      ),
    [pendingItemsForNow],
  );

  const selectedAmountForNow = useMemo(
    () =>
      roundMoney(
        selectedItemsForNow.reduce(
          (sum, item) =>
            sum +
            computeLineAmount(item.quantity_to_charge_now, item.unit_price) +
            (item.quantity_to_charge_now > 0 ? Number(item.tray_container_cost ?? 0) : 0),
          0,
        ),
      ),
    [selectedItemsForNow],
  );

  const selectedUnits = useMemo(
    () => unpaidItems.reduce((sum, item) => sum + (qtyByItemId[item.id] ?? 0), 0),
    [unpaidItems, qtyByItemId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "!flex h-[min(94dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem))] max-h-[min(94dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem))] flex-col !gap-0 overflow-hidden bg-white !p-0",
          "w-[calc(100vw-1rem)] max-w-[min(1080px,calc(100vw-1rem))]",
          "sm:h-[86vh] sm:max-h-[86vh] sm:w-[calc(100vw-1.25rem)] sm:max-w-[min(1080px,calc(100vw-1.25rem))]",
          "lg:max-w-[min(1120px,calc(100vw-2rem))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 sm:px-5 sm:py-3">
          <DialogTitle className="font-display text-lg sm:text-xl">Dividir pago por items</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fffdf8] px-2 py-2 sm:px-5 sm:py-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 lg:grid-cols-2 lg:items-stretch lg:gap-4">
            <section className="flex min-h-[min(220px,38dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-stone-200 bg-white p-2.5 shadow-sm sm:p-4">
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-slate-950 sm:text-base">Items pendientes</h3>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-center sm:rounded-2xl sm:px-3 sm:py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-700 sm:text-[10px]">Total pendiente</p>
                  <p className="text-[11px] font-semibold tabular-nums text-amber-900 sm:text-sm">{formatCurrency(pendingAmountForNow)}</p>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-600 sm:h-8 sm:px-3 sm:text-xs"
                    onClick={fillAllToCharge}
                    disabled={pendingItemsForNow.length === 0}
                  >
                    <ArrowRight className="hidden sm:inline-block h-4 w-4 mr-1" />
                    <ArrowDown className="inline-block sm:hidden h-3.5 w-3.5 mr-1" />
                    Todo
                  </Button>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dashed border-stone-200/90 bg-stone-50/50">
                {pendingItemsForNow.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] text-slate-500 sm:py-12 sm:text-sm">
                    No quedan items pendientes para mover en esta operacion.
                  </div>
                ) : (
                  <div className="scrollbar-none flex-1 space-y-1 overflow-y-auto p-1.5 sm:p-3">
                    {pendingItemsForNow.map((item) => {
                    const isBulkItem = item.tray_item_type === "C";
                    const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                    return (
                      <div
                        key={groupKey}
                        className="grid grid-cols-[24px_minmax(0,1fr)_52px_66px] items-center gap-1 rounded-xl border border-stone-200 bg-stone-50/50 px-1.5 py-1.5 sm:grid-cols-[52px_minmax(0,1fr)_72px_88px] sm:gap-2 sm:rounded-2xl sm:px-2 sm:py-2"
                      >
                        <span className="text-center text-[11px] font-semibold text-slate-900 sm:text-sm">
                          {isBulkItem ? "AG" : item.quantity_available_now}
                        </span>
                        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                          <div className="hidden xs:block sm:block">
                            <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} />
                          </div>
                          <span className="truncate text-[10.5px] font-medium text-slate-900 sm:text-sm">{item.description_snapshot}</span>
                        </div>
                        <span className="text-right text-[11px] font-semibold text-slate-900 sm:text-sm">${item.unit_price.toFixed(2)}</span>
                        <div className="flex justify-end gap-1 sm:gap-1.5">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveOneGroupToCharge(item.groupItems)}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 sm:h-8 sm:w-8"
                          >
                            <ArrowRight className="hidden sm:block h-4 w-4" />
                            <ArrowDown className="block sm:hidden h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveAllGroupToCharge(item.groupItems)}
                            className="flex h-7 min-w-[30px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 sm:h-8 sm:min-w-[36px] sm:text-xs"
                          >
                            <span className="hidden sm:inline">&gt;&gt;</span>
                            <span className="inline sm:hidden">↓↓</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-[min(220px,38dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-stone-200 bg-white p-2.5 shadow-sm sm:p-4">
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-slate-955 sm:text-base">Items a cobrar ahora</h3>
                </div>
                <div className="rounded-xl border border-orange-200 bg-orange-50 px-2 py-1 text-center sm:rounded-2xl sm:px-3 sm:py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-orange-700 sm:text-[10px]">Total seleccionado</p>
                  <p className="text-[11px] font-semibold tabular-nums text-orange-900 sm:text-sm">{formatCurrency(selectedAmountForNow)}</p>
                </div>
                {!readOnly && !restrictMovingBackToPending && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-600 sm:h-8 sm:px-3 sm:text-xs"
                    onClick={clearAllSelection}
                  >
                    <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Vaciar
                  </Button>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dashed border-orange-200/90 bg-orange-50/25">
                {selectedItemsForNow.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] text-slate-500 sm:py-12 sm:text-sm">
                    Mueve items desde la izquierda para incluirlos en este cobro.
                  </div>
                ) : (
                  <div className="scrollbar-none flex-1 space-y-1 overflow-y-auto p-1.5 sm:p-3">
                    {selectedItemsForNow.map((item) => {
                    const isBulkItem = item.tray_item_type === "C";
                    const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                    const lineTotal =
                      computeLineAmount(item.quantity_to_charge_now, item.unit_price) +
                      (item.quantity_to_charge_now > 0 ? Number(item.tray_container_cost ?? 0) : 0);
                    return (
                      <div
                        key={groupKey}
                        className="grid grid-cols-[62px_24px_minmax(0,1fr)_52px] items-center gap-1 rounded-xl border border-orange-200 bg-orange-50/40 px-1.5 py-1.5 sm:grid-cols-[80px_52px_minmax(0,1fr)_80px] sm:gap-2 sm:rounded-2xl sm:px-2 sm:py-2"
                      >
                        <div className="flex justify-start gap-1">
                          {restrictMovingBackToPending ? (
                            <div className="h-7 w-[56px] shrink-0 sm:h-8 sm:w-[68px]" aria-hidden />
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveAllGroupBackToPending(item.groupItems)}
                                className="flex h-7 min-w-[26px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 sm:h-8 sm:min-w-[34px] sm:px-1 sm:text-xs"
                              >
                                <span className="hidden sm:inline">&lt;&lt;</span>
                                <span className="inline sm:hidden">↑↑</span>
                              </button>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveOneGroupBackToPending(item.groupItems)}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 sm:h-8 sm:w-8"
                              >
                                <ArrowLeft className="hidden sm:block h-4 w-4" />
                                <ArrowUp className="block sm:hidden h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                        <span className="text-center text-[11px] font-semibold text-slate-900 sm:text-sm">
                          {isBulkItem ? "AG" : item.quantity_to_charge_now}
                        </span>
                        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                          <div className="hidden xs:block sm:block">
                            <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} tone="selected" />
                          </div>
                          <span className="truncate text-[10.5px] font-medium text-slate-900 sm:text-sm">{item.description_snapshot}</span>
                        </div>
                        <span className="text-right text-[11px] font-semibold text-slate-900 sm:text-sm">${lineTotal.toFixed(2)}</span>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="footer-safe-bottom shrink-0 border-t border-border bg-white px-4 pt-3 sm:px-5 sm:pb-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedUnits > 0 ? `${selectedUnits} unidad(es) en este cobro` : "Selecciona al menos una unidad para cobrar"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  clearAllSelection();
                  onOpenChange(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} className="rounded-xl">
                Aceptar
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}
