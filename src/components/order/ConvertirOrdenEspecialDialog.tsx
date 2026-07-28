import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, RotateCcw } from "lucide-react";

export type ItemParaEspecial = {
  id: string;
  description_snapshot: string;
  unit_price: number;
  quantity: number;
  /** Unidades despachadas disponibles para pasar a especial. */
  quantity_dispatched: number;
  image_url?: string | null;
  total: number;
};

export type ConvertirOrdenEspecialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemParaEspecial[];
  submitting?: boolean;
  /** "edit": la orden ya es especial mixta; permite reasignar y volver a normal con 0 unidades. */
  mode?: "convert" | "edit";
  /** Precarga (modo edit): unidades actualmente en el grupo especial por item. */
  initialQtyByItemId?: Record<string, number>;
  /** Precarga (modo edit): valor manual actual del grupo especial. */
  initialSpecialTotal?: number | null;
  /** Precarga (modo edit): motivo actual. */
  initialSpecialReason?: string | null;
  onConfirm: (params: {
    qtyByItemId: Record<string, number>;
    specialTotal: number;
    specialReason: string;
  }) => void | Promise<void>;
};

function clampQty(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export default function ConvertirOrdenEspecialDialog({
  open,
  onOpenChange,
  items,
  submitting = false,
  mode = "convert",
  initialQtyByItemId,
  initialSpecialTotal,
  initialSpecialReason,
  onConfirm,
}: ConvertirOrdenEspecialDialogProps) {
  const [qtyByItemId, setQtyByItemId] = useState<Record<string, number>>({});
  const [specialTotalInput, setSpecialTotalInput] = useState("");
  const [specialReasonInput, setSpecialReasonInput] = useState("");
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);

  const isEditMode = mode === "edit";

  const dispatchedItems = useMemo(
    () => items.filter((item) => Number(item.quantity_dispatched ?? 0) > 0),
    [items],
  );

  // Reset al abrir (en modo edit precarga la asignacion actual)
  useEffect(() => {
    if (!open) return;
    if (isEditMode) {
      setQtyByItemId({ ...(initialQtyByItemId ?? {}) });
      setSpecialTotalInput(
        initialSpecialTotal != null && Number.isFinite(Number(initialSpecialTotal))
          ? Number(initialSpecialTotal).toFixed(2)
          : "",
      );
      setSpecialReasonInput(String(initialSpecialReason ?? ""));
    } else {
      setQtyByItemId({});
      setSpecialTotalInput("");
      setSpecialReasonInput("");
    }
    setErrorMensaje(null);
  }, [open, isEditMode, initialQtyByItemId, initialSpecialTotal, initialSpecialReason]);

  const setItemQty = (itemId: string, qty: number, maxQty: number) => {
    const normalized = Number.isFinite(qty) ? Math.floor(qty) : 0;
    const nextQty = clampQty(normalized, 0, maxQty);
    setQtyByItemId((prev) => ({ ...prev, [itemId]: nextQty }));
    setErrorMensaje(null);
  };

  const moveOneToSpecial = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (qtyByItemId[itemId] ?? 0) + 1, maxQty);
  };

  const moveAllToSpecial = (itemId: string, maxQty: number) => {
    setItemQty(itemId, maxQty, maxQty);
  };

  const moveOneBack = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (qtyByItemId[itemId] ?? 0) - 1, maxQty);
  };

  const moveAllBack = (itemId: string, maxQty: number) => {
    setItemQty(itemId, 0, maxQty);
  };

  const fillAll = () => {
    const next: Record<string, number> = {};
    for (const item of dispatchedItems) {
      next[item.id] = item.quantity_dispatched;
    }
    setQtyByItemId(next);
    setErrorMensaje(null);
  };

  const clearAll = () => {
    setQtyByItemId({});
    setErrorMensaje(null);
  };

  const availableItems = useMemo(
    () =>
      dispatchedItems
        .map((item) => {
          const selected = qtyByItemId[item.id] ?? 0;
          const available = Math.max(0, item.quantity_dispatched - selected);
          if (available <= 0) return null;
          return { ...item, quantity_available: available };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [dispatchedItems, qtyByItemId],
  );

  const selectedItems = useMemo(
    () =>
      dispatchedItems
        .map((item) => {
          const selected = qtyByItemId[item.id] ?? 0;
          if (selected <= 0) return null;
          return { ...item, quantity_selected: selected };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [dispatchedItems, qtyByItemId],
  );

  const availableCatalogTotal = useMemo(
    () =>
      roundMoney(
        availableItems.reduce(
          (sum, item) => sum + computeLineAmount(item.quantity_available, item.unit_price),
          0,
        ),
      ),
    [availableItems],
  );

  const selectedCatalogTotal = useMemo(
    () =>
      roundMoney(
        selectedItems.reduce(
          (sum, item) => sum + computeLineAmount(item.quantity_selected, item.unit_price),
          0,
        ),
      ),
    [selectedItems],
  );

  const remainingOnOrderCatalogTotal = useMemo(() => {
    // Items no despachados + unidades despachadas no seleccionadas
    let sum = 0;
    for (const item of items) {
      const dispatched = Number(item.quantity_dispatched ?? 0);
      const selected = qtyByItemId[item.id] ?? 0;
      const undispatched = Math.max(0, item.quantity - dispatched);
      const dispatchedLeft = Math.max(0, dispatched - selected);
      sum += computeLineAmount(undispatched + dispatchedLeft, item.unit_price);
    }
    return roundMoney(sum);
  }, [items, qtyByItemId]);

  const selectedUnits = useMemo(
    () => dispatchedItems.reduce((sum, item) => sum + (qtyByItemId[item.id] ?? 0), 0),
    [dispatchedItems, qtyByItemId],
  );

  const parsedSpecial = (() => {
    const raw = specialTotalInput.trim().replace(",", ".");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return roundMoney(n);
  })();

  const projectedOrderTotal =
    parsedSpecial != null ? roundMoney(parsedSpecial + remainingOnOrderCatalogTotal) : null;

  const handleAccept = async () => {
    if (submitting) return;
    if (selectedUnits <= 0) {
      if (isEditMode) {
        // Sin unidades especiales: la orden vuelve a ser normal.
        setErrorMensaje(null);
        try {
          await onConfirm({ qtyByItemId: {}, specialTotal: 0, specialReason: "" });
        } catch (err: any) {
          const msg =
            err?.message
            || err?.error_description
            || err?.details
            || "No se pudo actualizar la orden especial.";
          setErrorMensaje(String(msg));
        }
        return;
      }
      setErrorMensaje("Selecciona al menos una unidad despachada.");
      return;
    }
    if (parsedSpecial == null) {
      setErrorMensaje("Ingresa un valor especial valido.");
      return;
    }
    const reason = specialReasonInput.trim();
    if (!reason) {
      setErrorMensaje("Ingresa el motivo de la orden especial.");
      return;
    }
    setErrorMensaje(null);
    try {
      await onConfirm({ qtyByItemId, specialTotal: parsedSpecial, specialReason: reason });
    } catch (err: any) {
      const msg =
        err?.message
        || err?.error_description
        || err?.details
        || "No se pudo convertir la orden a especial.";
      setErrorMensaje(String(msg));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "!flex h-[min(94dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem))] max-h-[min(94dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem))] flex-col !gap-0 overflow-hidden bg-white !p-0",
          "w-[calc(100vw-1rem)] max-w-[min(1080px,calc(100vw-1rem))]",
          "sm:h-[86vh] sm:max-h-[86vh] sm:w-[calc(100vw-1.25rem)] sm:max-w-[min(1080px,calc(100vw-1.25rem))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
          <DialogTitle className="font-display text-lg sm:text-xl">
            {isEditMode ? "Editar orden especial" : "Convertir en orden especial"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isEditMode
              ? "Mueve ítems entre la orden normal y la especial como necesites. Si dejas la especial vacía, la orden vuelve a ser normal."
              : "Solo aparecen ítems despachados. El valor especial reemplaza el total de lo que pases a la derecha; lo demás sigue con precio real."}
          </p>
        </DialogHeader>

        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fffdf8] px-2 py-2 sm:px-5 sm:py-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-4">
            <section className="flex min-h-[min(200px,34dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-stone-200 bg-white p-2.5 shadow-sm sm:p-4">
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-950 sm:text-base">
                  {isEditMode ? "Orden normal (despachados)" : "Items despachados"}
                </h3>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-center sm:px-3 sm:py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-700 sm:text-[10px]">
                    Total catálogo
                  </p>
                  <p className="text-[11px] font-semibold tabular-nums text-amber-900 sm:text-sm">
                    {formatCurrency(availableCatalogTotal)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 rounded-full px-2 text-[11px] sm:h-8 sm:text-xs"
                  onClick={fillAll}
                  disabled={availableItems.length === 0 || submitting}
                >
                  <ArrowRight className="mr-1 hidden h-4 w-4 sm:inline-block" />
                  <ArrowDown className="mr-1 inline-block h-3.5 w-3.5 sm:hidden" />
                  Todo
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {availableItems.length === 0 ? (
                  <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-stone-200 px-3 text-center text-xs text-muted-foreground">
                    No hay más unidades despachadas disponibles.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {availableItems.map((item) => {
                      const lineTotal = computeLineAmount(item.quantity_available, item.unit_price);
                      return (
                        <div
                          key={item.id}
                          className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-xl border border-stone-100 bg-stone-50/80 px-2 py-2"
                        >
                          <span className="text-center text-[11px] font-semibold sm:text-sm">
                            {item.quantity_available}
                          </span>
                          <span className="truncate text-[10.5px] font-medium sm:text-sm">
                            {item.description_snapshot}
                          </span>
                          <span className="text-right text-[11px] font-semibold sm:text-sm">
                            ${lineTotal.toFixed(2)}
                          </span>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 w-8 rounded-lg bg-teal-600 p-0 hover:bg-teal-700"
                              disabled={submitting}
                              onClick={() => moveOneToSpecial(item.id, item.quantity_dispatched)}
                              title="Pasar una unidad"
                            >
                              <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
                              <ArrowDown className="h-3.5 w-3.5 sm:hidden" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 w-8 rounded-lg bg-teal-700 p-0 hover:bg-teal-800"
                              disabled={submitting}
                              onClick={() => moveAllToSpecial(item.id, item.quantity_dispatched)}
                              title="Pasar todas"
                            >
                              <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
                              <ArrowDown className="h-3.5 w-3.5 sm:hidden" />
                              <ArrowRight className="-ml-1.5 hidden h-3.5 w-3.5 opacity-70 sm:block" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-[min(200px,34dvh)] min-w-0 flex-1 flex-col rounded-[22px] border border-orange-200 bg-white p-2.5 shadow-sm sm:p-4">
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-950 sm:text-base">
                  {isEditMode ? "Orden especial" : "Items a especial"}
                </h3>
                <div className="rounded-xl border border-orange-200 bg-orange-50 px-2 py-1 text-center sm:px-3 sm:py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-orange-700 sm:text-[10px]">
                    Catálogo seleccionado
                  </p>
                  <p className="text-[11px] font-semibold tabular-nums text-orange-900 sm:text-sm">
                    {formatCurrency(selectedCatalogTotal)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 rounded-full px-2 text-[11px] sm:h-8 sm:text-xs"
                  onClick={clearAll}
                  disabled={selectedItems.length === 0 || submitting}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Vaciar
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedItems.length === 0 ? (
                  <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-orange-200 px-3 text-center text-xs text-muted-foreground">
                    Mueve ítems despachados desde la izquierda para incluirlos en el especial.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedItems.map((item) => {
                      const lineTotal = computeLineAmount(item.quantity_selected, item.unit_price);
                      return (
                        <div
                          key={item.id}
                          className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-xl border border-orange-100 bg-orange-50/60 px-2 py-2"
                        >
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 rounded-lg p-0"
                              disabled={submitting}
                              onClick={() => moveOneBack(item.id, item.quantity_dispatched)}
                              title="Devolver una unidad"
                            >
                              <ArrowLeft className="hidden h-3.5 w-3.5 sm:block" />
                              <ArrowUp className="h-3.5 w-3.5 sm:hidden" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 rounded-lg p-0"
                              disabled={submitting}
                              onClick={() => moveAllBack(item.id, item.quantity_dispatched)}
                              title="Devolver todas"
                            >
                              <ArrowLeft className="hidden h-3.5 w-3.5 sm:block" />
                              <ArrowUp className="h-3.5 w-3.5 sm:hidden" />
                            </Button>
                          </div>
                          <span className="text-center text-[11px] font-semibold sm:text-sm">
                            {item.quantity_selected}
                          </span>
                          <span className="truncate text-[10.5px] font-medium sm:text-sm">
                            {item.description_snapshot}
                          </span>
                          <span className="text-right text-[11px] font-semibold sm:text-sm">
                            ${lineTotal.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="mt-3 shrink-0 space-y-2 rounded-2xl border border-violet-200 bg-violet-50/70 px-3 py-3 sm:px-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="special-total-input" className="text-xs font-semibold text-violet-900 sm:text-sm">
                  Valor especial
                </Label>
                <Input
                  id="special-total-input"
                  inputMode="decimal"
                  value={specialTotalInput}
                  disabled={submitting}
                  onChange={(e) => {
                    setSpecialTotalInput(sanitizeDecimalInput(e.target.value));
                    setErrorMensaje(null);
                  }}
                  placeholder={selectedCatalogTotal > 0 ? selectedCatalogTotal.toFixed(2) : "0.00"}
                  className="mt-1 h-11 rounded-xl bg-white"
                />
              </div>
              <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Orden normal (precio real)
                </p>
                <p className="mt-1 font-display text-base font-black tabular-nums">
                  {formatCurrency(remainingOnOrderCatalogTotal)}
                </p>
              </div>
              <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                  Total orden proyectado
                </p>
                <p className="mt-1 font-display text-base font-black tabular-nums text-orange-950">
                  {projectedOrderTotal != null ? formatCurrency(projectedOrderTotal) : "—"}
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="special-reason-input" className="text-xs font-semibold text-violet-900 sm:text-sm">
                Motivo
              </Label>
              <Input
                id="special-reason-input"
                type="text"
                value={specialReasonInput}
                disabled={submitting}
                onChange={(e) => {
                  setSpecialReasonInput(e.target.value);
                  setErrorMensaje(null);
                }}
                placeholder="Ingresa el motivo"
                className="mt-1 h-11 rounded-xl bg-white"
              />
            </div>
            {errorMensaje ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                {errorMensaje}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Total orden = valor especial + ítems que no pasan a especial.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="footer-safe-bottom shrink-0 border-t border-border bg-white px-4 pt-3 sm:px-5 sm:pb-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedUnits > 0
                ? `${selectedUnits} unidad(es) a especial`
                : isEditMode
                  ? "Sin unidades: la orden volverá a ser normal"
                  : "Selecciona al menos una unidad despachada"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="rounded-xl"
                disabled={submitting || (!isEditMode && selectedUnits <= 0)}
                onClick={handleAccept}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditMode && selectedUnits <= 0 ? (
                  "Volver a orden normal"
                ) : (
                  "Aceptar"
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
