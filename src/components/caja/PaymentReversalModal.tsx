import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DenominationVisual from "@/components/caja/DenominationVisual";
import type { CashRefundDenomInput, CompletedPaymentStatus, PaymentVoidSelectionInput, ShiftDenom } from "@/hooks/useCaja";
import { cn } from "@/lib/utils";
import { roundMoney } from "@/lib/paymentQuantity";
import { ArrowLeft, ArrowRight, Coins, Loader2, ReceiptText, RotateCcw } from "lucide-react";

export interface ReversalPaymentData {
  paymentId: string;
  orderId: string;
  orderCode: string | null;
  orderNumber: number;
  tableLabel: string;
  createdAt: string;
  cashierName: string;
  amount: number;
  status: CompletedPaymentStatus;
  notes: string | null;
  methodsSummary: string;
  orderHasDispatchedItems: boolean;
  items: {
    id: string;
    paymentEntryId: string;
    productName: string;
    quantity: number;
    tray_item_type?: "A" | "B" | "C" | null;
    amount: number;
    methodName: string;
    status: CompletedPaymentStatus;
  }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "request" | "execute";
  payment: ReversalPaymentData | null;
  shiftDenoms: ShiftDenom[];
  loading?: boolean;
  allowPartial?: boolean;
  titleOverride?: string;
  submitLabelOverride?: string;
  initialDraft?: {
    reason: string;
    paymentSelections: PaymentVoidSelectionInput[];
    cashRefundDenoms?: CashRefundDenomInput[];
  } | null;
  autoOpenConfirm?: boolean;
  onSubmit: (payload: {
    paymentId: string;
    reason: string;
    paymentSelections: PaymentVoidSelectionInput[];
    cashRefundDenoms: CashRefundDenomInput[];
  }) => Promise<void> | void;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function clampQty(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0)));
}

export default function PaymentReversalModal({
  open,
  onOpenChange,
  mode = "request",
  payment,
  shiftDenoms,
  loading = false,
  allowPartial = true,
  titleOverride,
  submitLabelOverride,
  initialDraft,
  autoOpenConfirm = false,
  onSubmit,
}: Props) {
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const itemHash = useMemo(
    () => payment?.items.map((item) => `${item.paymentEntryId}:${item.quantity}:${item.amount}`).join("|") ?? "",
    [payment],
  );

  useEffect(() => {
    if (!payment || !open) {
      setSelectedQuantities({});
      setReason("");
      setConfirmOpen(false);
      return;
    }

    const initialQuantities = Object.fromEntries(
      payment.items.map((item) => {
        const draftSelection = initialDraft?.paymentSelections.find(
          (selection) => selection.paymentEntryId === item.paymentEntryId,
        );
        return [
          item.paymentEntryId,
          clampQty(draftSelection?.quantity ?? (allowPartial ? 0 : item.quantity), item.quantity),
        ];
      }),
    );

    setSelectedQuantities(initialQuantities);
    setReason(initialDraft?.reason ?? "");
    setConfirmOpen(false);
  }, [allowPartial, initialDraft, itemHash, open, payment]);

  useEffect(() => {
    if (open && autoOpenConfirm) {
      setConfirmOpen(true);
    }
  }, [autoOpenConfirm, open]);

  const itemsWithState = useMemo(
    () =>
      (payment?.items ?? []).map((item) => {
        const selectedQty = clampQty(selectedQuantities[item.paymentEntryId] ?? 0, item.quantity);
        const quantityPending = Math.max(0, item.quantity - selectedQty);
        const unitAmount = item.quantity > 0 ? roundMoney(item.amount / item.quantity) : 0;
        const selectedAmount = roundMoney(unitAmount * selectedQty);
        const pendingAmount = roundMoney(unitAmount * quantityPending);

        return {
          ...item,
          selectedQty,
          quantityPending,
          unitAmount,
          selectedAmount,
          pendingAmount,
        };
      }),
    [payment, selectedQuantities],
  );

  const pendingItems = useMemo(() => itemsWithState.filter((item) => item.quantityPending > 0), [itemsWithState]);
  const selectedItems = useMemo(() => itemsWithState.filter((item) => item.selectedQty > 0), [itemsWithState]);
  const pendingUnits = useMemo(() => pendingItems.reduce((sum, item) => sum + item.quantityPending, 0), [pendingItems]);
  const selectedUnits = useMemo(() => selectedItems.reduce((sum, item) => sum + item.selectedQty, 0), [selectedItems]);
  const pendingTotal = useMemo(() => roundMoney(pendingItems.reduce((sum, item) => sum + item.pendingAmount, 0)), [pendingItems]);
  const selectedTotal = useMemo(() => roundMoney(selectedItems.reduce((sum, item) => sum + item.selectedAmount, 0)), [selectedItems]);
  const requiresSupervisor = payment?.orderHasDispatchedItems ?? true;

  const refundBreakdown = useMemo(() => {
    if (selectedTotal <= 0) return [];

    const sorted = [...shiftDenoms]
      .filter((denomination) => denomination.value > 0)
      .sort((a, b) => b.value - a.value || a.display_order - b.display_order);

    const result: Array<{
      denomination_id: string;
      label: string;
      value: number;
      qty: number;
      total: number;
      image_url?: string | null;
    }> = [];

    let remaining = selectedTotal;

    for (const denomination of sorted) {
      if (remaining <= 0.001) break;
      const available = Math.max(0, Number(denomination.qty_current ?? 0));
      if (available <= 0) continue;

      const maxQty = Math.floor(remaining / denomination.value);
      const qty = Math.min(maxQty, available);
      if (qty <= 0) continue;

      result.push({
        denomination_id: denomination.denomination_id,
        label: denomination.label,
        value: denomination.value,
        qty,
        total: roundMoney(qty * denomination.value),
        image_url: denomination.image_url ?? null,
      });

      remaining = roundMoney(remaining - qty * denomination.value);
    }

    return result;
  }, [selectedTotal, shiftDenoms]);

  const refundTotal = useMemo(
    () => roundMoney(refundBreakdown.reduce((sum, denomination) => sum + denomination.total, 0)),
    [refundBreakdown],
  );
  const refundDifference = roundMoney(selectedTotal - refundTotal);
  const refundMatches = selectedTotal > 0 && Math.abs(refundDifference) < 0.001;

  const setItemQty = (paymentEntryId: string, nextQty: number, maxQty: number) => {
    setSelectedQuantities((prev) => ({
      ...prev,
      [paymentEntryId]: clampQty(nextQty, maxQty),
    }));
  };

  const clearSelection = () => {
    setSelectedQuantities(Object.fromEntries((payment?.items ?? []).map((item) => [item.paymentEntryId, 0])));
  };

  const fillSelection = () => {
    setSelectedQuantities(Object.fromEntries((payment?.items ?? []).map((item) => [item.paymentEntryId, item.quantity])));
  };

  const canOpenConfirm = Boolean(payment) && selectedUnits > 0 && reason.trim().length > 0 && (requiresSupervisor ? refundMatches : true) && !loading;

  const handleSubmit = async () => {
    if (!payment || !canOpenConfirm) return;

    const paymentSelections = selectedItems.map((item) => ({
      paymentEntryId: item.paymentEntryId,
      quantity: item.selectedQty,
    }));
    const cashRefundDenoms = refundBreakdown.map((denomination) => ({
      denomination_id: denomination.denomination_id,
      qty: denomination.qty,
    }));

    await onSubmit({
      paymentId: payment.paymentId,
      reason: reason.trim(),
      paymentSelections,
      cashRefundDenoms,
    });
  };

  const renderPendingCard = (item: (typeof itemsWithState)[number]) => (
    <div
      key={`pending-${item.paymentEntryId}`}
      className="grid grid-cols-[44px_minmax(0,1fr)_64px_78px_78px] items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50/50 px-2 py-2 sm:grid-cols-[52px_minmax(0,1fr)_72px_92px_86px] sm:gap-2.5 sm:px-2.5 sm:py-2.5"
    >
      <span className="text-center text-sm font-semibold text-slate-900">{item.quantityPending}</span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{item.productName}</span>
        <span className="block text-[11px] text-slate-500 sm:hidden">${item.unitAmount.toFixed(2)} c/u</span>
      </div>
      <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unitAmount.toFixed(2)}</span>
      <span className="text-right text-sm font-semibold text-slate-900">${item.pendingAmount.toFixed(2)}</span>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setItemQty(item.paymentEntryId, item.selectedQty + 1, item.quantity)}
          disabled={loading || item.quantityPending <= 0}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setItemQty(item.paymentEntryId, item.quantity, item.quantity)}
          disabled={loading || item.quantityPending <= 0}
          className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          &gt;&gt;
        </button>
      </div>
    </div>
  );

  const renderSelectedCard = (item: (typeof itemsWithState)[number]) => (
    <div
      key={`selected-${item.paymentEntryId}`}
      className="grid grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/40 px-2 py-2 sm:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] sm:gap-2.5 sm:px-2.5 sm:py-2.5"
    >
      <div className="flex justify-start gap-2">
        <button
          type="button"
          onClick={() => setItemQty(item.paymentEntryId, 0, item.quantity)}
          disabled={loading}
          className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          &lt;&lt;
        </button>
        <button
          type="button"
          onClick={() => setItemQty(item.paymentEntryId, item.selectedQty - 1, item.quantity)}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
      <span className="text-center text-sm font-semibold text-slate-900">{item.selectedQty}</span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{item.productName}</span>
        <span className="block text-[11px] text-slate-500 sm:hidden">${item.unitAmount.toFixed(2)} c/u</span>
      </div>
      <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unitAmount.toFixed(2)}</span>
      <span className="text-right text-sm font-semibold text-slate-900">${item.selectedAmount.toFixed(2)}</span>
    </div>
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmOpen(false);
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="max-h-[94vh] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[28px] border border-orange-200 p-0 sm:max-w-6xl">
          {!payment ? null : (
            <div className="flex max-h-[94vh] flex-col bg-white">
              <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left sm:px-6">
                <DialogTitle className="text-xl font-semibold text-slate-950">
                  {titleOverride ?? "Anular pago"}
                </DialogTitle>
                <div className="space-y-1 text-sm text-slate-500">
                  <p>
                    {payment.tableLabel} - Orden {payment.orderCode ?? `#${payment.orderNumber}`}
                  </p>
                  <p>Mueve desde la izquierda solo lo que vas a anular en esta operacion.</p>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[26px] border border-slate-200 bg-slate-50/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">Items pagados</p>
                          <p className="text-xs text-slate-500">Mueve desde aqui lo que vas a anular ahora.</p>
                        </div>
                        <div className="rounded-2xl border border-orange-200 bg-white px-3 py-2 text-right shadow-sm">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-500">Pendiente</p>
                          <p className="text-base font-bold text-slate-950">{formatCurrency(pendingTotal)}</p>
                        </div>
                      </div>

                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={fillSelection}
                          disabled={loading || !allowPartial || pendingUnits <= 0}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Mover todo
                        </button>
                      </div>

                      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                        <div className="hidden grid-cols-[44px_minmax(0,1fr)_64px_78px_78px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:grid md:grid-cols-[52px_minmax(0,1fr)_72px_92px_86px] md:gap-3 md:px-3 md:text-[11px]">
                          <span className="text-center">Cant.</span>
                          <span>Producto</span>
                          <span className="text-right">Unit.</span>
                          <span className="text-right">Total pend.</span>
                          <span className="text-right">Mover</span>
                        </div>
                        {pendingItems.length > 0 ? (
                          pendingItems.map(renderPendingCard)
                        ) : (
                          <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center text-sm text-slate-500">
                            Todo lo pagado ya esta seleccionado para anular en esta operacion.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-orange-200 bg-orange-50/30 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">Items a anular ahora</p>
                          <p className="text-xs text-slate-500">Esto es lo que se registra en esta operacion.</p>
                        </div>
                        <div className="rounded-2xl border border-orange-200 bg-white px-3 py-2 text-right shadow-sm">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-500">Seleccionado</p>
                          <p className="text-base font-bold text-orange-700">{formatCurrency(selectedTotal)}</p>
                        </div>
                      </div>

                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={clearSelection}
                          disabled={loading || selectedUnits <= 0}
                          className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Vaciar
                        </button>
                      </div>

                      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                        <div className="hidden grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:grid md:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] md:gap-3 md:px-3 md:text-[11px]">
                          <span>Mover</span>
                          <span className="text-center">Cant.</span>
                          <span>Producto</span>
                          <span className="text-right">Unit.</span>
                          <span className="text-right">Subtotal</span>
                        </div>
                        {selectedItems.length > 0 ? (
                          selectedItems.map(renderSelectedCard)
                        ) : (
                          <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-orange-200 bg-white px-5 text-center text-sm text-slate-500">
                            Mueve items desde la izquierda para incluirlos en esta anulacion.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="rounded-2xl bg-slate-100 p-2 text-slate-600">
                        <ReceiptText className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-950">Motivo de anulacion</p>
                        <p className="text-xs text-slate-500">Quedara guardado en la solicitud y en la auditoria.</p>
                      </div>
                    </div>
                    <Textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Ejemplo: cliente devolvio un item, se cobro de mas, correccion de caja..."
                      rows={3}
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-3 sm:px-4 lg:px-6">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
                  <div className="rounded-[22px] border border-stone-200 bg-stone-50/70 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      <span className="text-slate-600">
                        Total seleccionado: <span className="font-semibold text-slate-950">${selectedTotal.toFixed(2)}</span>
                      </span>
                      <span className="text-slate-600">
                        Total a devolver: <span className="font-semibold text-slate-950">${refundTotal.toFixed(2)}</span>
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="destructive"
                    className="h-12 w-full rounded-2xl bg-red-600 text-sm font-bold shadow-lg shadow-red-200 hover:bg-red-700"
                    onClick={() => setConfirmOpen(true)}
                    disabled={loading || selectedTotal <= 0 || !canOpenConfirm}
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    {submitLabelOverride || (requiresSupervisor ? "Solicitar autorización" : "Confirmar anulación")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[400px] rounded-[32px] border-none p-8 shadow-2xl">
          <AlertDialogHeader className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <RotateCcw className="h-8 w-8 text-red-600" />
            </div>
            <div className="space-y-2 text-center">
              <AlertDialogTitle className="text-2xl font-bold text-slate-900">
                ¿Confirmar anulacion?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-base text-slate-600">
                {requiresSupervisor
                  ? "Se enviará una solicitud de autorización al supervisor para procesar esta anulación."
                  : "Esta anulación se procesará directamente ya que no hay ítems despachados."}
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-8 flex-col gap-3 sm:flex-col">
            <AlertDialogAction
              onClick={() => void handleSubmit()}
              className="h-12 w-full rounded-2xl bg-red-600 text-sm font-bold shadow-lg shadow-red-100 hover:bg-red-700"
            >
              Confirmar
            </AlertDialogAction>
            <AlertDialogCancel className="h-12 w-full rounded-2xl border-none bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200">
              Cancelar
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
