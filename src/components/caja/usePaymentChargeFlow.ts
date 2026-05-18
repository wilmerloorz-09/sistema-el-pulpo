import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import { computeLineAmount, distributeProportionalAmounts, roundMoney } from "@/lib/paymentQuantity";
import { isCashPaymentMethodName, isTransferPaymentMethodName } from "@/lib/paymentMethods";
import type { PayableOrder, PayOrderParams, ShiftDenom } from "@/hooks/useCaja";
import { getOrderTotalToCharge } from "@/components/caja/PaymentDialogV2";

function getPayFailureMessage(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  return "No se pudo registrar el cobro.";
}

export interface PaymentChargeFlowOptions {
  order: PayableOrder | null;
  shiftDenoms: ShiftDenom[];
  paymentMethods: { id: string; name: string }[];
  onPay: (params: PayOrderParams) => Promise<unknown> | void;
  paying: boolean;
  open: boolean;
  readOnly?: boolean;
}

export function usePaymentChargeFlow({
  order,
  shiftDenoms,
  paymentMethods,
  onPay,
  paying,
  open,
  readOnly = false,
}: PaymentChargeFlowOptions) {
  const pendingPayPromiseRef = useRef<Promise<unknown> | null>(null);
  const suppressCloseOnceRef = useRef(false);

  const [receivedByDenom, setReceivedByDenom] = useState<Record<string, number>>({});
  const [transferInput, setTransferInput] = useState("");
  const [payItemQtys, setPayItemQtys] = useState<Record<string, number>>({});
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

  const orderUnpaidSignature = useMemo(
    () => (order?.items ?? []).map((i) => `${i.id}:${i.quantity_pending}`).join("|"),
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

  useEffect(() => {
    if (!open) {
      setPostPaySummary(null);
      pendingPayPromiseRef.current = null;
      suppressCloseOnceRef.current = false;
      return;
    }
    if (!order) return;
    setReceivedByDenom({});
    setTransferInput("");
    setPostPaySummary(null);
    pendingPayPromiseRef.current = null;
    suppressCloseOnceRef.current = false;
  }, [open, order?.id]);

  useEffect(() => {
    if (!open || !order) return;
    const next: Record<string, number> = {};
    for (const item of order.items ?? []) {
      const p = Math.floor(Number(item.quantity_pending ?? 0));
      if (p > 0) next[item.id] = p;
    }
    setPayItemQtys(next);
  }, [open, order?.id, orderUnpaidSignature]);

  const sortedDenoms = useMemo(
    () => [...shiftDenoms].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.value - b.value),
    [shiftDenoms],
  );
  const coinDenoms = useMemo(() => sortedDenoms.filter((d) => d.denomination_type !== "bill"), [sortedDenoms]);
  const billDenoms = useMemo(() => sortedDenoms.filter((d) => d.denomination_type === "bill"), [sortedDenoms]);

  const cashTotal = useMemo(
    () =>
      roundMoney(
        shiftDenoms.reduce((sum, d) => sum + (receivedByDenom[d.denomination_id] || 0) * d.value, 0),
      ),
    [receivedByDenom, shiftDenoms],
  );

  const transferAmount = useMemo(() => {
    const n = Number(transferInput.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? roundMoney(n) : 0;
  }, [transferInput]);

  const totalDelivered = roundMoney(cashTotal + transferAmount);
  const cashMethod = useMemo(() => paymentMethods.find((m) => isCashPaymentMethodName(m.name)), [paymentMethods]);
  const transferMethod = useMemo(() => paymentMethods.find((m) => isTransferPaymentMethodName(m.name)), [paymentMethods]);
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

  const canPay = Boolean(order) && !readOnly && !paying && orderChargeTotal > 0 && !payValidationMessage;

  const settlePendingPay = useCallback(async () => {
    const p = pendingPayPromiseRef.current;
    if (!p) return;
    try {
      await p;
    } catch {
      // handled in handleCobrar
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

    if (paymentSplits.length === 0 || tenderedSplits.length === 0) {
      toast.error("Debes registrar transferencia y/o efectivo");
      return;
    }

    const cashReceivedDenoms = Object.entries(receivedByDenom)
      .filter(([, quantity]) => quantity > 0)
      .map(([denomination_id, qty]) => ({ denomination_id, qty }));

    const cashChangeDenoms = changeDenomBreakdown.map((d) => ({
      denomination_id: d.denomination_id,
      qty: d.qty,
    }));

    const receiptItemsMap = new Map<string, { description: string; quantity: number; unitPrice: number; amount: number }>();
    for (const sel of itemSelections) {
      const originalItem = (order.items ?? []).find((i) => i.id === sel.itemId);
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

    const params: PayOrderParams = {
      orderId: order.id,
      itemSelections,
      paymentSplits,
      tenderedSplits,
      isSpecial: order.is_special,
      specialAmount: order.is_special ? chargeTotalRounded : undefined,
      receivedTotal: totalDelivered,
      totalAmount: chargeTotalRounded,
      cashReceivedDenoms,
      cashChangeDenoms,
      preparedTransferProofSession: null,
    };

    const summary = {
      changeAmount,
      lines: changeDenomBreakdown.map((d) => ({
        denomination_id: d.denomination_id,
        qty: d.qty,
        value: d.value,
        label: d.label,
        image_url: d.image_url ?? null,
      })),
      receipt: {
        orderNumber: order.order_code ?? order.order_number ?? "",
        tableName: order.table_name ?? undefined,
        orderType: order.order_type,
        isSpecial: order.is_special,
        isTrayOrder: order.is_tray_order,
        items: Array.from(receiptItemsMap.values()),
        payments: paymentSplits.map((sp) => ({
          methodName: paymentMethods.find((m) => m.id === sp.methodId)?.name ?? "Metodo",
          appliedAmount: sp.amount,
        })),
        totalAmount: chargeTotalRounded,
        totalReceived: totalDelivered,
        changeAmount,
        createdAt: new Date().toISOString(),
      },
    };

    flushSync(() => setPostPaySummary(summary));

    try {
      const payResult = onPay(params);
      if (payResult != null && typeof (payResult as { then?: unknown }).then === "function") {
        const p = payResult as Promise<unknown>;
        pendingPayPromiseRef.current = p;
        p.catch((e) => {
          suppressCloseOnceRef.current = true;
          setPostPaySummary(null);
          toast.error(getPayFailureMessage(e));
        }).finally(() => {
          if (pendingPayPromiseRef.current === p) pendingPayPromiseRef.current = null;
        });
      }
    } catch (e) {
      suppressCloseOnceRef.current = true;
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
    setReceivedByDenom((prev) => ({ ...prev, [denominationId]: (prev[denominationId] || 0) + 1 }));
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

  const receivedByDenomQty = receivedByDenom;

  const selectedLines = useMemo(
    () =>
      sortedDenoms
        .filter((d) => (receivedByDenom[d.denomination_id] || 0) > 0)
        .map((d) => ({
          ...d,
          qty: receivedByDenom[d.denomination_id] || 0,
          lineTotal: roundMoney((receivedByDenom[d.denomination_id] || 0) * d.value),
        })),
    [receivedByDenom, sortedDenoms],
  );

  return {
    postPaySummary,
    setPostPaySummary,
    suppressCloseOnceRef,
    settlePendingPay,
    transferInput,
    setTransferInput,
    orderChargeTotal,
    cashTotal,
    transferAmount,
    totalDelivered,
    changeAmount,
    cannotMakeChange,
    changeDenomBreakdown,
    coinDenoms,
    billDenoms,
    receivedByDenom: receivedByDenomQty,
    selectedLines,
    payValidationMessage,
    canPay,
    handleCobrar,
    addDenom,
    subtractDenom,
    clearCash,
  };
}
