import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import {
  buildPayItemQtysAllPending,
  buildPayItemQtysNoneSelected,
  hasPayItemQtySelection,
} from "@/lib/payItemQtys";
import { computeLineAmount, distributeProportionalAmounts, roundMoney } from "@/lib/paymentQuantity";
import { isCashPaymentMethodName, isTransferPaymentMethodName } from "@/lib/paymentMethods";
import { isExtraOrder } from "@/lib/orderFlow";
import { getOrderOriginLabel } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import type { PayableOrder, PayOrderParams, ShiftDenom } from "@/hooks/useCaja";
import { shouldUseSecondaryPaymentDialog } from "@/lib/cajaPaymentUi";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { PaymentItemSplitDialog } from "@/components/caja/PaymentItemSplitDialog";
import PaymentReceipt from "@/components/caja/PaymentReceipt";
import { Banknote, CircleCheck, Coins, CreditCard, Loader2, Printer, UserRound, Wallet, CopyCheck } from "lucide-react";
import { toast } from "sonner";
import { printPaymentReceipt } from "@/lib/thermalPrint";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Círculo compacto con la cantidad (sin "x"); va antes del icono y del nombre. */
function DenominationQtyCircle({
  qty,
  size = "md",
  tone = "emerald",
}: {
  qty: number;
  size?: "sm" | "md";
  tone?: "emerald" | "slate";
}) {
  const badgeTone =
    tone === "slate"
      ? "bg-slate-600 text-white ring-1 ring-slate-400/35"
      : "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500/40";

  const dimensions =
    size === "sm"
      ? "h-6 w-6 text-[10px] sm:text-[11px]"
      : "h-7 w-7 text-[11px] sm:h-8 sm:w-8 sm:text-xs";

  const wide =
    qty >= 100
      ? "min-w-[1.85rem] px-1 sm:min-w-8 sm:px-1.5"
      : qty >= 10
        ? "min-w-7 px-0.5 sm:min-w-[1.85rem] sm:px-1"
        : "";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold tabular-nums leading-none",
        dimensions,
        wide,
        badgeTone,
      )}
      aria-label={`Cantidad: ${qty}`}
    >
      {qty}
    </span>
  );
}

function getPayFailureMessage(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  return "No se pudo registrar el cobro.";
}

/** Monto que debe cubrir el cobro (pendiente especial o suma de líneas pendientes). */
export function getOrderTotalToCharge(order: PayableOrder): number {
  if (order.is_special) {
    return roundMoney(Math.max(0, Number(order.special_pending_amount ?? 0)));
  }
  return roundMoney((order.items ?? []).reduce((sum, item) => sum + Number(item.pending_total ?? 0), 0));
}

interface Props {
  order: PayableOrder | null;
  shiftDenoms: ShiftDenom[];
  paymentMethods: { id: string; name: string }[];
  onPay: (params: PayOrderParams) => Promise<unknown> | void;
  paying: boolean;
  open: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

export default function PaymentDialogV2({
  order,
  shiftDenoms,
  paymentMethods,
  onPay,
  paying,
  open,
  onClose,
  readOnly = false,
}: Props) {
  const shiftGateQuery = useBranchShiftGate();
  const hidePrintReceipt = shouldUseSecondaryPaymentDialog(shiftGateQuery.data);
  const pendingPayPromiseRef = useRef<Promise<unknown> | null>(null);
  const suppressCloseOnceRef = useRef(false);

  const [receivedByDenom, setReceivedByDenom] = useState<Record<string, number>>({});
  const [transferInput, setTransferInput] = useState("");
  const [postPaySummary, setPostPaySummary] = useState<{
    changeAmount: number;
    lines: { denomination_id: string; qty: number; value: number; label: string; image_url?: string | null }[];
    receipt: {
      orderNumber: string | number;
      tableName?: string;
      orderType?: string;
      isSpecial: boolean;
      isTrayOrder: boolean;
      items: { description: string; quantity: number; unitPrice: number; amount: number }[];
      payments: { methodName: string; appliedAmount: number }[];
      totalAmount: number;
      totalReceived: number;
      changeAmount: number;
      createdAt: string;
    };
  } | null>(null);

  const [payItemQtys, setPayItemQtys] = useState<Record<string, number>>({});
  const [splitItemsDialogOpen, setSplitItemsDialogOpen] = useState(false);
  /** El usuario ya movió ítems en el split de este cobro; reaperturas conservan payItemQtys. */
  const itemSplitHasSignaledRef = useRef(false);

  const orderUnpaidSignature = useMemo(
    () =>
      (order?.items ?? [])
        .map((i) => `${i.id}:${i.quantity_pending}`)
        .join("|"),
    [order?.items],
  );

  const orderChargeTotal = useMemo(() => {
    if (!order) return 0;
    if (order.is_special) return roundMoney(Math.max(0, Number(order.special_pending_amount ?? 0)));
    const lines = (order.items ?? []).filter((i) => Number(i.quantity_pending ?? 0) > 0);
    const qtyMapReady = lines.length > 0 && lines.every((i) => typeof payItemQtys[i.id] === "number");
    if (!qtyMapReady) return getOrderTotalToCharge(order);
    return roundMoney(
      lines.reduce((sum, item) => {
        const q = Math.max(0, Math.floor(Number(payItemQtys[item.id] ?? 0)));
        if (q <= 0) return sum;
        return sum + computeLineAmount(q, item.unit_price) + (q > 0 ? Number(item.tray_container_cost ?? 0) : 0);
      }, 0),
    );
  }, [order, payItemQtys]);

  const unpaidPayableLines = useMemo(
    () => (order?.items ?? []).filter((i) => Number(i.quantity_pending ?? 0) > 0),
    [order?.items],
  );
  const totalPendingUnits = useMemo(
    () => unpaidPayableLines.reduce((s, i) => s + Math.floor(Number(i.quantity_pending ?? 0)), 0),
    [unpaidPayableLines],
  );
  const wouldOfferItemSplit = Boolean(
    order
    && !order.is_special
    && unpaidPayableLines.length > 0
    && (totalPendingUnits > 1 || unpaidPayableLines.length > 1),
  );
  const isExpressOrder = order?.order_type === "EXPRESS";
  const isExtraOrderType = isExtraOrder(order);
  const canOfferItemSplit = wouldOfferItemSplit && !isExpressOrder && !isExtraOrderType;
  const showDisabledItemSplit = wouldOfferItemSplit && (isExpressOrder || isExtraOrderType);

  useEffect(() => {
    if (!open) {
      setPostPaySummary(null);
      pendingPayPromiseRef.current = null;
      suppressCloseOnceRef.current = false;
      itemSplitHasSignaledRef.current = false;
      setSplitItemsDialogOpen(false);
      return;
    }
    if (!order) return;
    setReceivedByDenom({});
    setTransferInput("");
    setPostPaySummary(null);
    pendingPayPromiseRef.current = null;
    suppressCloseOnceRef.current = false;
    itemSplitHasSignaledRef.current = false;
    setSplitItemsDialogOpen(false);
  }, [open, order?.id]);

  useEffect(() => {
    if (!open || !order) return;
    itemSplitHasSignaledRef.current = false;
    setPayItemQtys(buildPayItemQtysAllPending(order));
  }, [open, order?.id, orderUnpaidSignature]);

  const handleSplitItemsDialogOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!order) {
        setSplitItemsDialogOpen(isOpen);
        return;
      }
      if (isOpen) {
        if (!itemSplitHasSignaledRef.current) {
          setPayItemQtys(buildPayItemQtysNoneSelected(order));
        }
        setSplitItemsDialogOpen(true);
        return;
      }
      setSplitItemsDialogOpen(false);
      setPayItemQtys((prev) => {
        if (hasPayItemQtySelection(order, prev)) {
          itemSplitHasSignaledRef.current = true;
          return prev;
        }
        itemSplitHasSignaledRef.current = false;
        return buildPayItemQtysAllPending(order);
      });
    },
    [order],
  );

  const sortedDenoms = useMemo(() => {
    const uniqueDenoms = new Map<string, ShiftDenom>();
    for (const d of shiftDenoms) {
      if (!uniqueDenoms.has(d.denomination_id)) {
        uniqueDenoms.set(d.denomination_id, d);
      }
    }
    return Array.from(uniqueDenoms.values()).sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.value - b.value,
    );
  }, [shiftDenoms]);
  const coinDenoms = useMemo(
    () => sortedDenoms.filter((d) => d.denomination_type !== "bill"),
    [sortedDenoms],
  );
  const billDenoms = useMemo(
    () => sortedDenoms.filter((d) => d.denomination_type === "bill"),
    [sortedDenoms],
  );

  const cashTotal = useMemo(() => roundMoney(sortedDenoms.reduce((sum, d) => sum + (receivedByDenom[d.denomination_id] || 0) * d.value, 0)), [receivedByDenom, sortedDenoms]);

  const transferAmount = useMemo(() => {
    const n = Number(transferInput.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? roundMoney(n) : 0;
  }, [transferInput]);

  const totalDelivered = roundMoney(cashTotal + transferAmount);

  const cashMethod = useMemo(
    () => paymentMethods.find((m) => isCashPaymentMethodName(m.name)),
    [paymentMethods],
  );
  const transferMethod = useMemo(
    () => paymentMethods.find((m) => isTransferPaymentMethodName(m.name)),
    [paymentMethods],
  );

  const appliedTransfer = roundMoney(Math.min(transferAmount, orderChargeTotal));
  const appliedCash = roundMoney(orderChargeTotal - appliedTransfer);

  const changeAmount = roundMoney(Math.max(0, totalDelivered - orderChargeTotal));

  const changeDenomBreakdown = useMemo(() => {
    if (changeAmount <= 0.001) return [];
    const sorted = [...shiftDenoms].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const result: {
      denomination_id: string;
      qty: number;
      value: number;
      label: string;
      image_url?: string | null;
    }[] = [];
    let remaining = changeAmount;
    for (const denomination of sorted) {
      if (remaining <= 0.001) break;
      const maxQty = Math.floor(remaining / denomination.value);
      const available = denomination.qty_current + (receivedByDenom[denomination.denomination_id] || 0);
      const qty = Math.min(maxQty, available);
      if (qty > 0) {
        result.push({
          denomination_id: denomination.denomination_id,
          qty,
          value: denomination.value,
          label: denomination.label,
          image_url: denomination.image_url ?? null,
        });
        remaining = roundMoney(remaining - qty * denomination.value);
      }
    }
    return result;
  }, [changeAmount, shiftDenoms, receivedByDenom]);

  const changeGiven = roundMoney(changeDenomBreakdown.reduce((sum, d) => sum + d.qty * d.value, 0));
  const cannotMakeChange = changeAmount > 0 && Math.abs(changeGiven - changeAmount) > 0.001;

  const hasReceivedDenoms = useMemo(() => Object.values(receivedByDenom).some((q) => q > 0), [receivedByDenom]);

  const payValidationMessage = useMemo(() => {
    if (!order || readOnly || paying) return null;
    if (orderChargeTotal <= 0) return null;
    if (paymentMethods.length === 0) return "No hay metodos de pago activos configurados";
    if (totalDelivered + 0.005 < orderChargeTotal) return "El total entregado es menor al total a cobrar";
    if (appliedTransfer > 0.005 && !transferMethod) return "No hay metodo de transferencia activo";
    if (appliedCash > 0.005 && !cashMethod) return "No hay metodo de efectivo activo";
    if (appliedCash > 0.005 && !hasReceivedDenoms) return "Efectivo requiere registrar el monto recibido por denominaciones";
    if (appliedCash > 0.005 && cashTotal + 0.005 < appliedCash) {
      return "El monto recibido en efectivo es menor al valor aplicado en efectivo";
    }
    if (cannotMakeChange) return "No hay cambio exacto disponible en caja";
    return null;
  }, [
    order,
    readOnly,
    paying,
    orderChargeTotal,
    paymentMethods.length,
    totalDelivered,
    appliedTransfer,
    appliedCash,
    transferMethod,
    cashMethod,
    hasReceivedDenoms,
    cashTotal,
    cannotMakeChange,
  ]);

  const canPay =
    Boolean(order) &&
    !readOnly &&
    !paying &&
    orderChargeTotal > 0 &&
    !payValidationMessage;

  const settlePendingPay = useCallback(async () => {
    const p = pendingPayPromiseRef.current;
    if (!p) return;
    try {
      await p;
    } catch {
      // El rechazo ya se maneja en la cadena iniciada en handleCobrar.
    }
  }, []);

  const handleCobrar = useCallback(async () => {
    if (!order || readOnly || paying || !canPay) return;

    const unpaidItems = (order.items ?? []).filter((item) => (payItemQtys[item.id] ?? 0) > 0);
    if (unpaidItems.length === 0) {
      toast.error("Selecciona al menos una linea o unidad para cobrar");
      return;
    }

    const chargeTotalRounded = roundMoney(orderChargeTotal);
    const catalogWeights = unpaidItems.map((item) => {
      const qty = Number(payItemQtys[item.id] ?? 0);
      return roundMoney(computeLineAmount(qty, item.unit_price) + (qty > 0 ? Number(item.tray_container_cost ?? 0) : 0));
    });
    const catalogSum = roundMoney(catalogWeights.reduce((s, w) => s + w, 0));
    const lineChargeAmounts =
      order.is_special && catalogSum > chargeTotalRounded + 0.01
        ? distributeProportionalAmounts(catalogWeights, chargeTotalRounded)
        : Math.abs(catalogSum - chargeTotalRounded) > 0.02
          ? distributeProportionalAmounts(catalogWeights, chargeTotalRounded)
          : catalogWeights;

    const itemSelections = unpaidItems.map((item, idx) => ({
      itemId: item.id,
      quantity: Number(payItemQtys[item.id] ?? 0),
      unitPrice: item.unit_price,
      amount: lineChargeAmounts[idx] ?? 0,
    }));

    const paymentSplits: PayOrderParams["paymentSplits"] = [];
    if (appliedTransfer > 0.005) {
      if (!transferMethod) {
        toast.error("No hay metodo de transferencia activo");
        return;
      }
      paymentSplits.push({ methodId: transferMethod.id, amount: appliedTransfer });
    }
    if (appliedCash > 0.005) {
      if (!cashMethod) {
        toast.error("No hay metodo de efectivo activo");
        return;
      }
      paymentSplits.push({ methodId: cashMethod.id, amount: appliedCash });
    }

    const tenderedSplits: PayOrderParams["tenderedSplits"] = [];
    if (transferAmount > 0.005) {
      if (!transferMethod) {
        toast.error("No hay metodo de transferencia activo");
        return;
      }
      tenderedSplits.push({ methodId: transferMethod.id, amount: transferAmount });
    }
    if (cashTotal > 0.005) {
      if (!cashMethod) {
        toast.error("No hay metodo de efectivo activo");
        return;
      }
      tenderedSplits.push({ methodId: cashMethod.id, amount: cashTotal });
    }

    if (paymentSplits.length === 0) {
      toast.error("Debes ingresar al menos un metodo de pago");
      return;
    }
    if (tenderedSplits.length === 0) {
      toast.error("Debes registrar el monto entregado (transferencia o efectivo)");
      return;
    }

    const cashReceivedDenoms = Object.entries(receivedByDenom)
      .filter(([, quantity]) => quantity > 0)
      .map(([denomination_id, qty]) => ({ denomination_id, qty }));

    const cashChangeDenoms = changeDenomBreakdown.map((d) => ({
      denomination_id: d.denomination_id,
      qty: d.qty,
    }));

    const receivedTotal = totalDelivered;

    const receiptItemsMap = new Map<string, { description: string; quantity: number; unitPrice: number; amount: number }>();
    const orderLines = order.items ?? [];
    for (const sel of itemSelections) {
      const originalItem = orderLines.find((i) => i.id === sel.itemId);
      const key = `${originalItem?.description_snapshot ?? "Producto"}_${sel.unitPrice}`;
      const existing = receiptItemsMap.get(key);
      if (existing) {
        existing.quantity += sel.quantity;
        existing.amount += sel.amount;
      } else {
        receiptItemsMap.set(key, {
          description: originalItem?.description_snapshot ?? "Producto",
          quantity: sel.quantity,
          unitPrice: sel.unitPrice,
          amount: sel.amount,
        });
      }
    }
    const transactionItems = Array.from(receiptItemsMap.values());
    const transactionPayments = paymentSplits.map((sp) => ({
      methodName: paymentMethods.find((m) => m.id === sp.methodId)?.name ?? "Metodo",
      appliedAmount: sp.amount,
    }));
    const receipt = {
      orderNumber: order.order_code ?? order.order_number ?? "",
      tableName: order.table_name ?? undefined,
      orderType: order.order_type,
      isSpecial: order.is_special,
      isTrayOrder: order.is_tray_order,
      items: transactionItems,
      payments: transactionPayments,
      totalAmount: chargeTotalRounded,
      totalReceived: receivedTotal,
      changeAmount,
      createdAt: new Date().toISOString(),
    };

    const params: PayOrderParams = {
      orderId: order.id,
      itemSelections,
      paymentSplits,
      tenderedSplits,
      isSpecial: order.is_special,
      specialAmount: order.is_special ? chargeTotalRounded : undefined,
      receivedTotal,
      totalAmount: chargeTotalRounded,
      cashReceivedDenoms,
      cashChangeDenoms,
      preparedTransferProofSession: null,
    };

    const changeLinesSnapshot = changeDenomBreakdown.map((d) => ({
      denomination_id: d.denomination_id,
      qty: d.qty,
      value: d.value,
      label: d.label,
      image_url: d.image_url ?? null,
    }));

    const summary = {
      changeAmount,
      lines: changeLinesSnapshot,
      receipt,
    };

    flushSync(() => {
      setPostPaySummary(summary);
    });

    try {
      const payResult = onPay(params);
      if (payResult != null && typeof (payResult as { then?: unknown }).then === "function") {
        const p = payResult as Promise<unknown>;
        pendingPayPromiseRef.current = p;
        p.catch((e) => {
          console.error("Payment failed", e);
          suppressCloseOnceRef.current = true;
          setPostPaySummary(null);
          toast.error(getPayFailureMessage(e));
        }).finally(() => {
          if (pendingPayPromiseRef.current === p) pendingPayPromiseRef.current = null;
        });
      } else {
        pendingPayPromiseRef.current = null;
      }
    } catch (e) {
      console.error("Payment failed", e);
      suppressCloseOnceRef.current = true;
      pendingPayPromiseRef.current = null;
      setPostPaySummary(null);
      toast.error(getPayFailureMessage(e));
    }
  }, [
    order,
    readOnly,
    paying,
    canPay,
    orderChargeTotal,
    appliedTransfer,
    appliedCash,
    transferAmount,
    cashTotal,
    totalDelivered,
    receivedByDenom,
    changeDenomBreakdown,
    changeAmount,
    transferMethod,
    cashMethod,
    paymentMethods,
    onPay,
    payItemQtys,
  ]);

  const addDenom = (denominationId: string) => {
    if (readOnly) return;
    setReceivedByDenom((prev) => ({
      ...prev,
      [denominationId]: (prev[denominationId] || 0) + 1,
    }));
  };

  const subtractDenom = (denominationId: string) => {
    if (readOnly) return;
    setReceivedByDenom((prev) => {
      const next = { ...prev };
      const q = (next[denominationId] || 0) - 1;
      if (q <= 0) delete next[denominationId];
      else next[denominationId] = q;
      return next;
    });
  };

  const clearCash = () => {
    if (readOnly) return;
    setReceivedByDenom({});
  };

  const renderDenomButton = (d: ShiftDenom) => {
    const qty = receivedByDenom[d.denomination_id] || 0;
    return <button
          key={d.denomination_id}
          type="button"
          onClick={() => addDenom(d.denomination_id)}
          disabled={readOnly}
          className={cn(
            "group relative flex items-center gap-2 rounded-xl border bg-card px-2 py-1 text-left transition-colors outline-none focus:outline-none select-none transform-gpu",
            qty > 0 ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:shadow-sm"
          )}
        >
          {qty > 0 && (
            <span className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shadow-sm">
              {qty}
            </span>
          )}
          <DenominationVisual
            label={d.label}
            imageUrl={d.image_url}
            className="h-7 w-7 shrink-0 rounded-md border border-slate-100 bg-white shadow-sm"
            imageClassName="object-contain p-0.5"
            iconClassName="h-4 w-4"
          />
          <div className="text-xs font-black text-slate-700 sm:text-xs">${d.value.toFixed(2)}</div>
        </button>;
  };

  const selectedLines = useMemo(() => {
    return sortedDenoms
      .filter((d) => (receivedByDenom[d.denomination_id] || 0) > 0)
      .map((d) => ({
        ...d,
        qty: receivedByDenom[d.denomination_id] || 0,
        lineTotal: roundMoney((receivedByDenom[d.denomination_id] || 0) * d.value),
      }));
  }, [receivedByDenom, sortedDenoms]);

  return (
    <>
      {postPaySummary && !hidePrintReceipt ? <PaymentReceipt {...postPaySummary.receipt} /> : null}
      {order && !postPaySummary ? (
        <PaymentItemSplitDialog
          open={splitItemsDialogOpen}
          onOpenChange={handleSplitItemsDialogOpenChange}
          order={order}
          qtyByItemId={payItemQtys}
          onQtyByItemIdChange={setPayItemQtys}
          readOnly={readOnly}
        />
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          const dismissedFromSuccessUi = postPaySummary != null;
          void (async () => {
            await settlePendingPay();
            if (dismissedFromSuccessUi && suppressCloseOnceRef.current) {
              suppressCloseOnceRef.current = false;
              return;
            }
            suppressCloseOnceRef.current = false;
            onClose();
          })();
        }}
      >
        <DialogContent
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          className={cn(
            "flex flex-col overflow-hidden bg-white p-0 sm:max-h-[96vh]",
            postPaySummary
              ? "no-print max-h-[96dvh] w-[min(560px,calc(100vw-1.25rem))] max-w-[min(560px,calc(100vw-1.25rem))] sm:max-w-2xl"
              : "max-h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.75rem)] max-w-[min(1320px,calc(100vw-0.75rem))] sm:w-[calc(100vw-1rem)] sm:max-w-[min(1320px,calc(100vw-1rem))] lg:max-w-[min(1400px,calc(100vw-1.5rem))]",
          )}
        >
        <DialogHeader
          className={cn(
            "shrink-0 bg-white px-3 sm:px-4 -mt-1",
            postPaySummary ? "pt-0 pb-1 sm:pt-0 sm:pb-2" : "pt-0 pb-0",
          )}
        >
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-lg leading-none sm:text-xl">
            <span className="min-w-0">
              {postPaySummary ? (
                <>
                  <CircleCheck className="inline-block h-6 w-6 shrink-0 text-emerald-600 sm:h-7 sm:w-7" aria-hidden />
                  <span>Cobro registrado</span>
                </>
              ) : readOnly ? (
                "Consulta de cobro"
              ) : (
                <>Cobrar {order?.order_code ?? (order ? `#${order.order_number}` : "")}</>
              )}
            </span>
            {order && !postPaySummary && (
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                -{" "}
                {getCajaOrderOriginLabel({
                  orderType: order.order_type,
                  tableName: order.table_name,
                  splitCode: order.split_code,
                  isSpecial: order.is_special,
                  isTrayOrder: order.is_tray_order,
                })}
              </span>
            )}
            {order?.created_by_name && !postPaySummary && (
              <span className="flex items-center gap-1.5 self-center text-xs font-semibold leading-none text-slate-600 sm:text-sm">
                <UserRound className="h-3.5 w-3.5" />
                <span className="truncate">{order.created_by_name}</span>
              </span>
            )}
          </DialogTitle>

          {postPaySummary && order && (
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Orden {order.order_code ?? `#${order.order_number}`}
              {order.table_name ? ` · ${order.table_name}` : ""}
            </p>
          )}
        </DialogHeader>

        <div
          className={cn(
            "scrollbar-none min-h-0 flex-1 overflow-y-auto",
            postPaySummary ? "px-3 py-2 sm:px-4 sm:py-2" : "px-3 pt-1 pb-1 sm:px-4",
            postPaySummary && "no-print",
          )}
        >
          {postPaySummary && order ? (
            <div className="mx-auto flex w-full max-w-full flex-col gap-2 py-0">
              {postPaySummary.changeAmount > 0.001 ? (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-50/90 p-2 shadow-sm sm:p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 text-base font-semibold leading-tight text-emerald-950 sm:text-lg">
                      Cambio a entregar desde caja
                    </p>
                    <p className="shrink-0 font-display text-2xl font-bold tabular-nums leading-none text-emerald-800 sm:text-3xl">
                      {formatCurrency(postPaySummary.changeAmount)}
                    </p>
                  </div>
                  {postPaySummary.lines.length > 0 ? (
                    <div className="space-y-1">
                      {postPaySummary.lines.map((denomination) => (
                        <div
                          key={denomination.denomination_id}
                          className="flex items-center justify-between gap-1.5 rounded-lg border border-emerald-200/60 bg-white/90 px-2 py-1 text-base sm:text-lg"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <DenominationQtyCircle qty={denomination.qty} size="md" tone="emerald" />
                            <DenominationVisual
                              label={denomination.label}
                              imageUrl={denomination.image_url}
                              className="h-9 w-9 shrink-0 rounded-md border border-emerald-100 bg-white"
                              iconClassName="h-3.5 w-3.5 sm:h-4 sm:w-4"
                            />
                            <span className="min-w-0 flex-1 break-words font-semibold leading-tight text-foreground sm:text-lg">
                              {denomination.label}
                            </span>
                          </div>
                          <span className="shrink-0 font-bold tabular-nums leading-none text-emerald-900 sm:text-xl">
                            {formatCurrency(denomination.qty * denomination.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-base text-muted-foreground sm:text-lg">No hay desglose por denominacion para este cambio.</p>
                  )}
                </div>
              ) : (
                <p className="text-center text-base font-medium text-foreground sm:text-lg">No hay cambio que entregar al cliente.</p>
              )}
            </div>
          ) : !order ? null : (
            <div className="flex flex-col gap-3 xl:gap-4">
              {/* Fila superior: total, transferencia y resumen en horizontal desde md */}
              <div className="grid gap-3 md:grid-cols-3 md:items-stretch lg:gap-4">
                <div className="flex min-h-[100px] flex-col justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm sm:flex-row sm:items-stretch">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <CreditCard className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">Total de la orden</p>
                      <p className="truncate text-xs text-sky-700/90">
                        {order.is_special ? "Saldo precio especial" : "Pendiente por cobrar"}
                      </p>
                      {canOfferItemSplit && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 h-8 border-sky-300 bg-white/90 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                          onClick={() => handleSplitItemsDialogOpenChange(true)}
                        >
                          Dividir pago
                        </Button>
                      ) : showDisabledItemSplit && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          title="Express y Extra solo permiten cobro total de la orden"
                          className="mt-2 h-8 cursor-not-allowed border-sky-200 bg-white/60 text-xs font-semibold text-sky-700/60"
                        >
                          Dividir pago
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="shrink-0 self-center font-display text-2xl font-black tabular-nums tracking-tight text-sky-950 sm:text-right">
                    {formatCurrency(orderChargeTotal)}
                  </p>
                </div>

                <div className="flex min-h-[100px] flex-col justify-center rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <label htmlFor="payment-v2-transfer" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-800">
                      <Banknote className="h-3.5 w-3.5" />
                      Transferencia
                    </label>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        const isExact = Math.abs(Number(transferInput || 0) - orderChargeTotal) < 0.005;
                        if (isExact) {
                          setTransferInput("");
                        } else {
                          setTransferInput(orderChargeTotal.toFixed(2));
                        }
                      }}
                      className="flex items-center gap-1 rounded-md border border-violet-300 bg-white/60 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700 shadow-sm transition-colors hover:bg-violet-100 disabled:opacity-50"
                      title={Math.abs(Number(transferInput || 0) - orderChargeTotal) < 0.005 ? "Limpiar monto" : "Usar monto total"}
                    >
                      <CopyCheck className="h-3 w-3" />
                      {Math.abs(Number(transferInput || 0) - orderChargeTotal) < 0.005 ? "Limpiar" : "Exacto"}
                    </button>
                  </div>
                  <Input
                    id="payment-v2-transfer"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={transferInput}
                    onChange={(e) => setTransferInput(sanitizeDecimalInput(e.target.value))}
                    disabled={readOnly}
                    className="mt-2 h-11 rounded-xl border-violet-200 bg-white text-lg font-semibold tabular-nums"
                  />
                </div>

                <div className="flex min-h-[100px] flex-col justify-center rounded-2xl border border-stone-200 bg-stone-50/90 px-4 py-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-600">
                    <Wallet className="h-3.5 w-3.5" />
                    Resumen entregado
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted-foreground">
                      Efectivo <strong className="ml-1 text-foreground">{formatCurrency(cashTotal)}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Transfer. <strong className="ml-1 text-foreground">{formatCurrency(transferAmount)}</strong>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-stone-200/80 pt-2 text-base font-bold text-stone-950">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(totalDelivered)}</span>
                  </div>
                  {changeAmount > 0.001 && (
                    <p className="mt-2 text-xs font-medium text-stone-700">
                      Cambio a devolver: <span className="tabular-nums font-bold">{formatCurrency(changeAmount)}</span>
                      {cannotMakeChange ? (
                        <span className="ml-1 text-destructive">(no alcanza en caja)</span>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>
              {/* Efectivo y detalle: en tablet (8\"+) mostrar las 3 columnas en una fila */}
              <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(260px,1fr)_minmax(260px,1fr)] md:items-stretch md:gap-5">
                <div className="flex min-h-0 flex-col rounded-[22px] border border-amber-200 bg-gradient-to-br from-amber-50/95 via-white to-emerald-50/40 px-4 pt-3 pb-4 shadow-sm sm:px-5 sm:pt-4 sm:pb-5 md:h-full transform-gpu">
                  <div className="mb-3 flex items-start justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">Efectivo entregado</p>
                      </div>
                    </div>
                    {!readOnly && Object.keys(receivedByDenom).length > 0 && (
                      <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-[11px] text-amber-900 sm:px-3 sm:text-xs" onClick={clearCash}>
                        Limpiar efectivo
                      </Button>
                    )}
                  </div>

                  <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden md:overflow-y-auto">
                    {!shiftDenoms || shiftDenoms.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No hay denominaciones configuradas para este turno. Abre la caja correctamente.
                      </p>
                    ) : (
                      <>
                        {coinDenoms.length > 0 && (
                          <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Monedas</p>
                            <div className="flex flex-wrap gap-2 sm:gap-2">
                              {coinDenoms.map(renderDenomButton)}
                            </div>
                          </div>
                        )}
                        {billDenoms.length > 0 && (
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">Billetes</p>
                            <div className="flex flex-wrap gap-2 sm:gap-2">
                              {billDenoms.map(renderDenomButton)}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-col gap-4 rounded-[22px] border border-slate-200 bg-slate-50/90 px-3 pt-3 pb-4 shadow-sm sm:px-4 sm:pt-4 sm:pb-5 md:h-full">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Efectivo que recibe caja (cliente)
                    </p>
                    {selectedLines.length === 0 ? (
                      <div className="min-h-0 flex-1 overflow-y-auto">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          Al elegir monedas o billetes en el cuadro de efectivo, el desglose aparecera aqui.
                        </p>
                      </div>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                        {selectedLines.map((line) => (
                          <div
                            key={line.denomination_id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[13px] shadow-sm"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <DenominationQtyCircle qty={line.qty} size="sm" tone="slate" />
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">{line.label}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(line.lineTotal)}</span>
                              {!readOnly && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => subtractDenom(line.denomination_id)}
                                >
                                  −1
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-col gap-4 rounded-[22px] border border-emerald-200 bg-emerald-50/40 px-3 pt-3 pb-4 shadow-sm sm:px-4 sm:pt-4 sm:pb-5 md:h-full">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-emerald-900">
                      Cambio a entregar
                    </p>

                    {changeAmount > 0.001 && !cannotMakeChange ? (
                      <>
                        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-xl bg-emerald-100/50 px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Total</p>
                          <p className="font-display text-lg font-bold tabular-nums text-emerald-800">{formatCurrency(changeAmount)}</p>
                        </div>
                        {changeDenomBreakdown.length > 0 ? (
                          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                            {changeDenomBreakdown.map((denomination) => (
                              <div
                                key={denomination.denomination_id}
                                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-white/60 px-2 py-1.5 text-[13px] shadow-sm"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <DenominationQtyCircle qty={denomination.qty} size="sm" tone="emerald" />
                                  <DenominationVisual
                                    label={denomination.label}
                                    imageUrl={denomination.image_url}
                                    className="h-7 w-7 shrink-0 rounded-lg border border-emerald-100 bg-white"
                                    iconClassName="h-3 w-3"
                                  />
                                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                    {denomination.label}
                                  </span>
                                </div>
                                <span className="shrink-0 font-medium tabular-nums text-emerald-900">
                                  {formatCurrency(denomination.qty * denomination.value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-1 items-center justify-center text-center">
                            <p className="text-xs text-muted-foreground">Sin desglose por denominacion.</p>
                          </div>
                        )}
                      </>
                    ) : changeAmount > 0.001 && cannotMakeChange ? (
                      <div className="shrink-0 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
                        Hay vuelto por {formatCurrency(changeAmount)} pero no alcanzan las piezas en caja para armarlo.
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-emerald-200/60 bg-emerald-50/30 p-4 text-center">
                        <p className="text-sm text-emerald-700/60">No hay cambio que entregar.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex shrink-0 flex-col gap-2 bg-white px-3 sm:flex-row sm:items-end sm:justify-end sm:gap-3 sm:px-4",
            postPaySummary ? "py-2" : "pt-2 pb-0",
            postPaySummary && "no-print",
          )}
        >
          {postPaySummary ? (
            <div
              className={cn(
                "flex w-full flex-col gap-2 sm:ms-auto sm:flex-row sm:justify-end sm:gap-3",
                hidePrintReceipt && "sm:justify-stretch",
              )}
            >
              {!hidePrintReceipt ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full gap-2 rounded-2xl border-2 text-sm font-semibold shadow-sm sm:flex-1"
                  onClick={() => {
                    if (!postPaySummary?.receipt) {
                      window.print();
                      return;
                    }
                    void printPaymentReceipt(postPaySummary.receipt).then((result) => {
                      if (result.mode === "html" && result.error) {
                        toast.warning(
                          "Impresion HTML (puente ESC/POS no disponible). Ejecute: node scripts/thermal-print-bridge.mjs",
                        );
                      }
                    });
                  }}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  Imprimir Comprobante
                </Button>
              ) : null}
              <Button
                type="button"
                className={cn(
                  "h-10 w-full rounded-2xl text-sm font-semibold shadow-md",
                  hidePrintReceipt ? "sm:w-full" : "sm:flex-1",
                )}
                onClick={() => {
                  void (async () => {
                    await settlePendingPay();
                    setPostPaySummary(null);
                    onClose();
                  })();
                }}
              >
                Listo
              </Button>
            </div>
          ) : (
            <>
              {payValidationMessage && !readOnly ? (
                <p className="order-2 text-center text-sm text-destructive sm:order-1 sm:me-auto sm:text-left">{payValidationMessage}</p>
              ) : null}
              <div className="order-1 flex w-full gap-2 sm:order-2 sm:w-auto sm:self-end sm:justify-end">
                <Button type="button" variant="outline" className="flex-1 rounded-xl sm:flex-none sm:min-w-[120px]" onClick={onClose}>
                  Cerrar
                </Button>
                {!readOnly && (
                  <Button
                    type="button"
                    className="flex-1 rounded-xl sm:flex-none sm:min-w-[140px]"
                    disabled={!canPay}
                    onClick={() => void handleCobrar()}
                  >
                    {paying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cobrando…
                      </>
                    ) : (
                      "Cobrar"
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
