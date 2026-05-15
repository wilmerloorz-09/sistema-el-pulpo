import { useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import type { PayableOrder } from "@/hooks/useCaja";
import { ArrowLeft, ArrowRight, GlassWater, RotateCcw, Soup } from "lucide-react";

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
          "!flex h-[min(84dvh,calc(100dvh-2rem))] max-h-[min(84dvh,calc(100dvh-2rem))] flex-col !gap-0 overflow-hidden bg-white !p-0",
          "w-[calc(100vw-1rem)] max-w-[min(1080px,calc(100vw-1rem))]",
          "sm:h-[86vh] sm:max-h-[86vh] sm:w-[calc(100vw-1.25rem)] sm:max-w-[min(1080px,calc(100vw-1.25rem))]",
          "lg:max-w-[min(1120px,calc(100vw-2rem))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 sm:px-5 sm:py-3">
          <DialogTitle className="font-display text-lg sm:text-xl">Dividir pago por items</DialogTitle>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Mueve lineas entre pendientes y este cobro. El total de la ventana principal se actualiza con lo seleccionado.
          </p>
        </DialogHeader>

        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fffdf8] px-3 py-3 sm:px-5 sm:py-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch lg:gap-4">
            <section className="flex min-h-[min(220px,28dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-950">Items pendientes</h3>
                  <p className="text-xs text-slate-500">
                    {restrictMovingBackToPending
                      ? "Para llevar: todo queda listo para cobrar; solo puedes mover a la derecha."
                      : "Mueve desde aqui lo que vas a cobrar ahora."}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Total pendiente</p>
                  <p className="text-sm font-semibold tabular-nums text-amber-900">{formatCurrency(pendingAmountForNow)}</p>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 rounded-full px-3 text-slate-600"
                    onClick={fillAllToCharge}
                    disabled={pendingItemsForNow.length === 0}
                  >
                    <ArrowRight className="h-4 w-4" />
                    Todo
                  </Button>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dashed border-stone-200/90 bg-stone-50/50">
                {pendingItemsForNow.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-slate-500 sm:py-12">
                    No quedan items pendientes para mover en esta operacion.
                  </div>
                ) : (
                  <div className="scrollbar-none flex-1 space-y-1.5 overflow-y-auto p-2 sm:p-3">
                    {pendingItemsForNow.map((item) => {
                    const isBulkItem = item.tray_item_type === "C";
                    const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                    return (
                      <div
                        key={groupKey}
                        className="grid grid-cols-[44px_minmax(0,1fr)_64px_72px] items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50/50 px-2 py-2 sm:grid-cols-[52px_minmax(0,1fr)_72px_88px]"
                      >
                        <span className="text-center text-sm font-semibold text-slate-900">
                          {isBulkItem ? "AG" : item.quantity_available_now}
                        </span>
                        <div className="flex min-w-0 items-center gap-2">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} />
                          <span className="truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                        </div>
                        <span className="text-right text-sm font-semibold text-slate-900">${item.unit_price.toFixed(2)}</span>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveOneGroupToCharge(item.groupItems)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveAllGroupToCharge(item.groupItems)}
                            className="flex h-8 min-w-[36px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            &gt;&gt;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-[min(220px,28dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-950">Items a cobrar ahora</h3>
                  <p className="text-xs text-slate-500">Se incluye en el total de la ventana de cobro.</p>
                </div>
                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-700">Total seleccionado</p>
                  <p className="text-sm font-semibold tabular-nums text-orange-900">{formatCurrency(selectedAmountForNow)}</p>
                </div>
                {!readOnly && !restrictMovingBackToPending && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-full px-3 text-slate-600" onClick={clearAllSelection}>
                    <RotateCcw className="h-4 w-4" />
                    Vaciar
                  </Button>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dashed border-orange-200/90 bg-orange-50/25">
                {selectedItemsForNow.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-slate-500 sm:py-12">
                    Mueve items desde la izquierda para incluirlos en este cobro.
                  </div>
                ) : (
                  <div className="scrollbar-none flex-1 space-y-1.5 overflow-y-auto p-2 sm:p-3">
                    {selectedItemsForNow.map((item) => {
                    const isBulkItem = item.tray_item_type === "C";
                    const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                    const lineTotal =
                      computeLineAmount(item.quantity_to_charge_now, item.unit_price) +
                      (item.quantity_to_charge_now > 0 ? Number(item.tray_container_cost ?? 0) : 0);
                    return (
                      <div
                        key={groupKey}
                        className="grid grid-cols-[72px_44px_minmax(0,1fr)_72px] items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/40 px-2 py-2 sm:grid-cols-[80px_52px_minmax(0,1fr)_80px]"
                      >
                        <div className="flex justify-start gap-1">
                          {restrictMovingBackToPending ? (
                            <div className="h-8 w-[68px] shrink-0" aria-hidden />
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveAllGroupBackToPending(item.groupItems)}
                                className="flex h-8 min-w-[34px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                &lt;&lt;
                              </button>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveOneGroupBackToPending(item.groupItems)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                <ArrowLeft className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                        <span className="text-center text-sm font-semibold text-slate-900">
                          {isBulkItem ? "AG" : item.quantity_to_charge_now}
                        </span>
                        <div className="flex min-w-0 items-center gap-2">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} tone="selected" />
                          <span className="truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                        </div>
                        <span className="text-right text-sm font-semibold text-slate-900">${lineTotal.toFixed(2)}</span>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-white px-4 py-3 sm:px-5 sm:py-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedUnits > 0 ? `${selectedUnits} unidad(es) en este cobro` : "Selecciona al menos una unidad para cobrar"}
            </p>
            <Button type="button" onClick={() => onOpenChange(false)} className="rounded-xl">
              Listo
            </Button>
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
