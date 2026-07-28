import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DenominationVisual from "@/components/caja/DenominationVisual";
import type {
  CashRefundDenomInput,
  CompletedPaymentStatus,
  PaymentRefundMethod,
  PaymentVoidSelectionInput,
  ShiftDenom,
} from "@/hooks/useCaja";
import { cn } from "@/lib/utils";
import { roundMoney } from "@/lib/paymentQuantity";
import { isTransferPaymentMethodName } from "@/lib/paymentMethods";
import { ArrowLeft, ArrowRight, Loader2, ReceiptText, RotateCcw } from "lucide-react";

export interface ReversalPaymentData {
  paymentId: string;
  orderId: string;
  orderCode: string | null;
  orderNumber: number;
  tableLabel: string;
  createdAt: string;
  cashierName: string;
  cashierId: string | null;
  amount: number;
  status: CompletedPaymentStatus;
  notes: string | null;
  methodsSummary: string;
  orderHasDispatchedItems: boolean;
  requiresSupervisor?: boolean;
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
    refundMethod?: PaymentRefundMethod | null;
  } | null;
  autoOpenConfirm?: boolean;
  onSubmit: (payload: {
    paymentId: string;
    reason: string;
    paymentSelections: PaymentVoidSelectionInput[];
    cashRefundDenoms: CashRefundDenomInput[];
    refundAmount: number;
    refundMethod: PaymentRefundMethod;
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
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [refundMethod, setRefundMethod] = useState<PaymentRefundMethod | null>(null);

  const itemHash = useMemo(
    () => payment?.items.map((item) => `${item.paymentEntryId}:${item.quantity}:${item.amount}`).join("|") ?? "",
    [payment],
  );

  useEffect(() => {
    if (!payment || !open) {
      setSelectedQuantities({});
      setReason("");
      setConfirmOpen(false);
      setConfirmSubmitting(false);
      setSubmitError(null);
      setRefundMethod(null);
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
    setConfirmSubmitting(false);
    setSubmitError(null);
    setRefundMethod(
      initialDraft?.refundMethod
      ?? (isTransferPaymentMethodName(payment.methodsSummary) ? null : "CASH"),
    );
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
  const requiresSupervisor = payment?.requiresSupervisor || (payment?.orderHasDispatchedItems ?? true);

  const isTransferPayment = payment ? isTransferPaymentMethodName(payment.methodsSummary) : false;
  const refundUsesCash = refundMethod === "CASH";

  const refundBreakdown = useMemo(() => {
    if (selectedTotal <= 0 || !refundUsesCash) return [];

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
  }, [selectedTotal, shiftDenoms, refundUsesCash]);

  const cashRefundTotal = useMemo(
    () => roundMoney(refundBreakdown.reduce((sum, denomination) => sum + denomination.total, 0)),
    [refundBreakdown],
  );
  const refundTotal = refundMethod === "TRANSFER" ? selectedTotal : cashRefundTotal;
  const refundDifference = roundMoney(selectedTotal - cashRefundTotal);
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

  const refundMethodIsValid = !isTransferPayment || refundMethod !== null;
  const canOpenConfirm = Boolean(payment)
    && selectedUnits > 0
    && refundMethodIsValid
    && (refundUsesCash ? refundMatches : true)
    && !loading;

  const handleSubmit = async () => {
    if (!payment || !canOpenConfirm || confirmSubmitting) return;

    const paymentSelections = selectedItems.map((item) => ({
      paymentEntryId: item.paymentEntryId,
      quantity: item.selectedQty,
    }));
    const cashRefundDenoms = refundBreakdown.map((denomination) => ({
      denomination_id: denomination.denomination_id,
      qty: denomination.qty,
    }));

    setConfirmSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        paymentId: payment.paymentId,
        reason: reason.trim() || "Sin motivo especificado",
        paymentSelections,
        cashRefundDenoms: refundUsesCash ? cashRefundDenoms : [],
        refundAmount: selectedTotal,
        refundMethod: refundMethod ?? "CASH",
      });
    } catch (error: any) {
      setSubmitError(error?.message || "No se pudo completar la anulacion.");
    } finally {
      setConfirmSubmitting(false);
    }
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

  const renderConfirmView = () => (
    <div className="flex max-h-[94vh] flex-col bg-white">
      <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left sm:px-6">
        <DialogTitle className="text-xl font-semibold text-slate-950">Confirmar anulacion</DialogTitle>
        <p className="text-sm text-slate-500">Revisa como quedara aplicada la anulacion antes de registrarla.</p>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-muted/50 p-2.5 sm:p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total anulado</p>
              <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">${selectedTotal.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-muted/50 p-2.5 sm:p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total a devolver</p>
              <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">${refundTotal.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-red-500/10 p-2.5 sm:p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo activo</p>
              <p className="mt-1 font-display text-base font-bold text-red-600 sm:text-xl">${pendingTotal.toFixed(2)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border p-3">
            <p className="mb-2 text-sm font-semibold text-foreground">Pago original</p>
            <div className="grid grid-cols-1 gap-1 rounded-xl bg-muted/40 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_110px_110px] sm:gap-2">
              <span className="truncate text-foreground">{payment?.methodsSummary || "Metodo registrado"}</span>
              <span className="text-right text-foreground">Pagado ${payment?.amount.toFixed(2) ?? "0.00"}</span>
              <span className="text-right font-medium text-foreground">Anula ${selectedTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className={cn(
            "rounded-2xl border p-3",
            refundUsesCash ? "border-red-500/20 bg-red-500/5" : "border-blue-200 bg-blue-50",
          )}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {refundUsesCash ? "Devolucion a entregar desde caja" : "Devolucion por transferencia"}
              </p>
              <p className={cn("font-display text-xl font-bold", refundUsesCash ? "text-red-600" : "text-blue-700")}>
                ${refundTotal.toFixed(2)}
              </p>
            </div>
            {!refundUsesCash ? (
              <p className="text-sm text-blue-800">
                La devolucion se registrara por transferencia y no descontara efectivo de caja.
              </p>
            ) : refundBreakdown.length > 0 ? (
              <div className="space-y-1">
                {refundBreakdown.map((denomination) => (
                  <div key={denomination.denomination_id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <DenominationVisual
                        label={denomination.label}
                        imageUrl={denomination.image_url}
                        className="h-9 w-9 rounded-xl"
                        iconClassName="h-4 w-4"
                      />
                      <span className="truncate text-foreground">{denomination.qty}x {denomination.label}</span>
                    </div>
                    <span className="font-medium text-foreground">${denomination.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay detalle de devolucion disponible todavia.</p>
            )}
          </div>

          {refundUsesCash && Math.abs(refundDifference) >= 0.001 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Falta cuadrar ${Math.abs(refundDifference).toFixed(2)} en denominaciones para completar la devolucion exacta.
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-600">
            {mode === "execute" 
              ? "Esta anulación cuenta con autorización y se procesará inmediatamente."
              : requiresSupervisor
                ? "Se enviara una solicitud de autorizacion al supervisor para procesar esta anulacion."
                : "Esta anulacion se procesara directamente ya que no hay items despachados."}
          </div>

          {submitError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {submitError}
            </div>
          )}
        </div>
      </div>

      <div className="footer-safe-bottom shrink-0 border-t border-stone-200 bg-white px-3 pt-3 sm:px-4 lg:px-6">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading || confirmSubmitting}>
            Volver
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canOpenConfirm || loading || confirmSubmitting}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading || confirmSubmitting 
              ? "Procesando..." 
              : (mode === "execute" || !requiresSupervisor) 
                ? "Confirmar anulacion" 
                : "Solicitar autorizacion"}
          </Button>
        </div>
      </div>
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
        <DialogContent className="max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.5rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[28px] border border-orange-200 p-0 sm:max-h-[94vh] sm:max-w-6xl">
          {!payment ? null : (
            confirmOpen ? renderConfirmView() : (
            <div className="flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.5rem)] flex-col bg-white sm:max-h-[94vh]">
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

                  {isTransferPayment && (
                    <div className="rounded-[26px] border border-blue-200 bg-blue-50/50 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm font-semibold text-slate-950">Forma de devolucion</p>
                        <Select
                          value={refundMethod ?? ""}
                          onValueChange={(value) => setRefundMethod(value as PaymentRefundMethod)}
                          disabled={loading}
                        >
                          <SelectTrigger className="h-9 w-full min-w-[220px] rounded-xl bg-white sm:w-auto sm:flex-1">
                            <SelectValue placeholder="Selecciona una opcion" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CASH">En efectivo (sale de caja)</SelectItem>
                            <SelectItem value="TRANSFER">Por transferencia (no afecta caja)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {refundMethod === null && (
                        <p className="mt-2 text-xs font-medium text-amber-700">
                          Selecciona una forma de devolucion para continuar.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="rounded-2xl bg-slate-100 p-2 text-slate-600">
                        <ReceiptText className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-950">Motivo de anulación <span className="text-xs font-normal text-slate-500">(Opcional)</span></p>
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

              <div className="footer-safe-bottom shrink-0 border-t border-stone-200 bg-white px-3 pt-3 sm:px-4 lg:px-6">
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
                    {submitLabelOverride || ((mode === "execute" || !requiresSupervisor) ? "Confirmar anulación" : "Solicitar autorización")}
                  </Button>
                </div>
              </div>
            </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
