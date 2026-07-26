import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import type { Denomination, PayableOrder, PayOrderParams, ShiftDenom } from "@/hooks/useCaja";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { PaymentItemSplitDialog } from "@/components/caja/PaymentItemSplitDialog";
import PaymentReceipt from "@/components/caja/PaymentReceipt";
import { CircleCheck, Coins, CreditCard, Loader2, Printer, UserRound, Wallet } from "lucide-react";
import { toast } from "sonner";
import { printPaymentReceipt } from "@/lib/thermalPrint";
import { catalogToPaymentDenoms } from "@/lib/cajaDenominations";
import PaymentClienteCard from "@/components/caja/PaymentClienteCard";
import { usePaymentClienteSelection } from "@/hooks/usePaymentClienteSelection";
import { datosClienteEnRecibo, type PaymentReceiptData } from "@/lib/paymentReceiptData";
import { useClientWinningOffer } from "@/hooks/useClientWinningOffer";
import { fetchPromocionReciboExtrasForOrder } from "@/lib/promocionesRecibo";
import { useBancosActivos } from "@/hooks/useBancosActivos";
import type { TransferenciaPagoDatos } from "@/lib/transferenciaPago";
import { liberarVistaPreviaTransferencia } from "@/lib/transferenciaPago";
import TransferenciaPagoSection from "@/components/caja/TransferenciaPagoSection";
import { mensajeErrorPago } from "@/lib/transferenciaDuplicada";

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
  tone?: "emerald" | "amber" | "slate";
}) {
  const badgeTone =
    tone === "slate"
      ? "bg-slate-600 text-white ring-1 ring-slate-400/35"
      : tone === "amber"
        ? "bg-amber-600 text-white shadow-sm ring-1 ring-amber-500/40"
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
  return mensajeErrorPago(e, "No se pudo registrar el cobro.");
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
  denominations: Denomination[];
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
  denominations,
  shiftDenoms,
  paymentMethods,
  onPay,
  paying,
  open,
  onClose,
  readOnly = false,
}: Props) {
  const hidePrintReceipt = false;
  const clienteSelection = usePaymentClienteSelection(order, open);
  const pendingPayPromiseRef = useRef<Promise<unknown> | null>(null);
  const suppressCloseOnceRef = useRef(false);

  const [receivedByDenom, setReceivedByDenom] = useState<Record<string, number>>({});
  const [transferDatos, setTransferDatos] = useState<TransferenciaPagoDatos | null>(null);
  const transferDatosRef = useRef<TransferenciaPagoDatos | null>(null);
  transferDatosRef.current = transferDatos;

  const clearTransferDatos = useCallback(() => {
    liberarVistaPreviaTransferencia(transferDatosRef.current);
    setTransferDatos(null);
  }, []);

  const handleTransferDatosChange = useCallback((datos: TransferenciaPagoDatos | null) => {
    setTransferDatos((prev) => {
      if (prev?.fotoVistaPreviaUrl && prev.fotoVistaPreviaUrl !== datos?.fotoVistaPreviaUrl) {
        liberarVistaPreviaTransferencia(prev);
      }
      return datos;
    });
  }, []);

  const { data: bancosActivos = [] } = useBancosActivos(open);
  const [useSaldo, setUseSaldo] = useState(true);
  const [wasFullyPaid, setWasFullyPaid] = useState(false);
  const wasFullyPaidRef = useRef(false);
  const [postPaySummary, setPostPaySummary] = useState<{
    changeAmount: number;
    lines: {
      denomination_id: string;
      qty: number;
      value: number;
      label: string;
      image_url?: string | null;
      denomination_type?: string | null;
    }[];
    receipt: PaymentReceiptData;
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

  const baseChargeTotal = useMemo(() => {
    if (!order) return 0;
    if (order.is_special) return roundMoney(Math.max(0, Number(order.special_pending_amount ?? 0)));
    const lines = (order.items ?? []).filter((i) => Number(i.quantity_pending ?? 0) > 0);
    const qtyMapReady = lines.length > 0 && lines.every((i) => typeof payItemQtys[i.id] === "number");
    if (!qtyMapReady) return getOrderTotalToCharge(order);
    return roundMoney(
      lines.reduce((sum, item) => {
        const q = Math.max(0, Number(payItemQtys[item.id] ?? 0));
        if (q <= 0) return sum;
        return sum + computeLineAmount(q, item.unit_price) + (q > 0 ? Number(item.tray_container_cost ?? 0) : 0);
      }, 0),
    );
  }, [order, payItemQtys]);

  const { data: winningOffer } = useClientWinningOffer(clienteSelection.selectedCliente?.id);

  /** Orden especial MIXTA: parte con valor manual (grupo) + resto a precio real. */
  const isMixedSpecial = Boolean(order?.is_special) && order?.special_group_total != null;
  const mixedRestReal = useMemo(() => {
    if (!order || !isMixedSpecial) return 0;
    return roundMoney(
      (order.items ?? []).reduce((sum, i) => {
        const qty = Math.max(0, Number(i.quantity ?? 0));
        const esp = Math.min(Math.max(0, Number(i.cantidad_especial ?? 0)), qty);
        const normal = Math.max(0, qty - esp);
        return sum + normal * Number(i.unit_price ?? 0);
      }, 0),
    );
  }, [order, isMixedSpecial]);
  const mixedGroupTotal = isMixedSpecial ? roundMoney(Number(order?.special_group_total ?? 0)) : 0;

  const discountAmount = 0;

  const orderChargeTotal = roundMoney(Math.max(0, baseChargeTotal - discountAmount));

  const clientSaldo = clienteSelection.selectedCliente?.saldo_promocional ?? 0;
  const appliedSaldo = useSaldo ? roundMoney(Math.min(clientSaldo, orderChargeTotal)) : 0;
  const netChargeTotal = roundMoney(Math.max(0, orderChargeTotal - appliedSaldo));

  const unpaidPayableLines = useMemo(
    () => (order?.items ?? []).filter((i) => Number(i.quantity_pending ?? 0) > 0),
    [order?.items],
  );
  const totalPendingUnits = useMemo(
    () => unpaidPayableLines.reduce((s, i) => s + Number(i.quantity_pending ?? 0), 0),
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
      setWasFullyPaid(false);
      wasFullyPaidRef.current = false;
      return;
    }
    if (!order) return;
    setReceivedByDenom({});
    clearTransferDatos();
    setPostPaySummary(null);
    pendingPayPromiseRef.current = null;
    suppressCloseOnceRef.current = false;
    itemSplitHasSignaledRef.current = false;
    setSplitItemsDialogOpen(false);
    setWasFullyPaid(false);
    wasFullyPaidRef.current = false;
  }, [open, order?.id, clearTransferDatos]);

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

  /**
   * Denominaciones que el cliente puede entregar: catálogo global (independiente de la plantilla).
   * `shiftDenoms` se usa para disponibilidad de cambio (caja).
   */
  const sortedDenoms = useMemo(() => {
    const paymentDenoms = catalogToPaymentDenoms(denominations);
    const uniqueDenoms = new Map<string, ShiftDenom>();
    for (const d of paymentDenoms) {
      if (!uniqueDenoms.has(d.denomination_id)) {
        uniqueDenoms.set(d.denomination_id, d);
      }
    }
    return Array.from(uniqueDenoms.values())
      .filter((d) => d.value > 0)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.value - b.value);
  }, [denominations]);
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
    const n = Number(transferDatos?.monto ?? 0);
    return Number.isFinite(n) && n >= 0 ? roundMoney(n) : 0;
  }, [transferDatos?.monto]);

  const totalDelivered = roundMoney(cashTotal + transferAmount);

  const cashMethod = useMemo(
    () => paymentMethods.find((m) => isCashPaymentMethodName(m.name)),
    [paymentMethods],
  );
  const transferMethod = useMemo(
    () => paymentMethods.find((m) => isTransferPaymentMethodName(m.name)),
    [paymentMethods],
  );
  const saldoMethod = useMemo(
    () => paymentMethods.find((m) => m.name === "Saldo Promocional"),
    [paymentMethods],
  );

  const appliedTransfer = roundMoney(Math.min(transferAmount, netChargeTotal));
  const appliedCash = roundMoney(netChargeTotal - appliedTransfer);

  const changeAmount = roundMoney(Math.max(0, totalDelivered - netChargeTotal));

  const changeDenomBreakdown = useMemo(() => {
    if (changeAmount <= 0.001) return [];
    const sorted = [...shiftDenoms].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const result: {
      denomination_id: string;
      qty: number;
      value: number;
      label: string;
      image_url?: string | null;
      denomination_type?: string | null;
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
          denomination_type: denomination.denomination_type ?? null,
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
    if (netChargeTotal > 0 && totalDelivered + 0.005 < netChargeTotal) return "El total entregado es menor al total a cobrar";
    if (appliedTransfer > 0.005 && !transferMethod) return "No hay metodo de transferencia activo";
    if (appliedCash > 0.005 && !cashMethod) return "No hay metodo de efectivo activo";
    if (appliedSaldo > 0.005 && !saldoMethod) return "No hay metodo de Saldo Promocional activo";
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
    appliedSaldo,
    transferMethod,
    cashMethod,
    saldoMethod,
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
    if (!order) return;
    if (readOnly || paying || !canPay) return;

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
    if (appliedSaldo > 0.005) {
      if (!saldoMethod) {
        toast.error("No hay metodo de Saldo Promocional activo");
        return;
      }
      paymentSplits.push({ methodId: saldoMethod.id, amount: appliedSaldo });
    }
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
    if (appliedSaldo > 0.005) {
      if (!saldoMethod) {
        toast.error("No hay metodo de Saldo Promocional activo");
        return;
      }
      tenderedSplits.push({ methodId: saldoMethod.id, amount: appliedSaldo });
    }
    if (transferAmount > 0.005) {
      if (!transferMethod) {
        toast.error("No hay metodo de transferencia activo");
        return;
      }
      if (!transferDatos?.bancoId) {
        toast.error("Registra la transferencia con banco y numero");
        return;
      }
      if (!transferDatos.numeroTransferencia.trim()) {
        toast.error("El numero de transferencia es obligatorio");
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
      toast.error("Debes registrar el monto entregado (saldo, transferencia o efectivo)");
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
      orderNumber: getOrderRef(order.order_code, order.order_number),
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
      ...datosClienteEnRecibo(clienteSelection.selectedCliente),
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
      clienteId: clienteSelection.selectedCliente?.id ?? null,
      prediccionIdAUsar: discountAmount > 0 && winningOffer ? winningOffer.prediccion_id : undefined,
      transferencia: transferAmount > 0.005 && transferDatos
        ? {
            bancoId: transferDatos.bancoId,
            numeroTransferencia: transferDatos.numeroTransferencia,
            monto: transferAmount,
            fotoArchivo: transferDatos.fotoArchivo ?? null,
            analisisIa: transferDatos.analisisIa ?? null,
            validacionComprobante: transferDatos.validacionComprobante ?? null,
            motivoAceptacion: transferDatos.motivoAceptacion ?? null,
          }
        : null,
    };

    const changeLinesSnapshot = changeDenomBreakdown.map((d) => ({
      denomination_id: d.denomination_id,
      qty: d.qty,
      value: d.value,
      label: d.label,
      image_url: d.image_url ?? null,
      denomination_type: d.denomination_type ?? null,
    }));

    const isFullyPaid = order.is_special
      ? (chargeTotalRounded >= Number(order.special_pending_amount ?? 0) - 0.005)
      : (order.items ?? []).every((item) => {
          const selectedQty = payItemQtys[item.id] ?? 0;
          return selectedQty >= (item.quantity_pending ?? 0);
        });

    try {
      const payResult = onPay(params);
      if (payResult != null && typeof (payResult as { then?: unknown }).then === "function") {
        const p = payResult as Promise<unknown>;
        pendingPayPromiseRef.current = p;
        await p;
        pendingPayPromiseRef.current = null;
      }

      const promocionExtras = isFullyPaid
        ? await fetchPromocionReciboExtrasForOrder(order.id)
        : { token_promocion: null, qrCodeDataUrl: null };

      const summary = {
        changeAmount,
        lines: changeLinesSnapshot,
        receipt: {
          ...receipt,
          ...promocionExtras,
        },
      };

      wasFullyPaidRef.current = isFullyPaid;
      setWasFullyPaid(isFullyPaid);
      setPostPaySummary(summary);
    } catch (e) {
      console.error("Payment failed", e);
      suppressCloseOnceRef.current = true;
      pendingPayPromiseRef.current = null;
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
    clienteSelection.selectedCliente,
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

  const renderDenomButton = (d: ShiftDenom, tone: "coin" | "bill" = "coin") => {
    const qty = receivedByDenom[d.denomination_id] || 0;
    const active = qty > 0;
    const toneClasses =
      tone === "bill"
        ? active
          ? "border-emerald-500/60 bg-emerald-100/80 shadow-sm ring-1 ring-emerald-500/30"
          : "border-emerald-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/70 hover:shadow-sm"
        : active
          ? "border-amber-500/60 bg-amber-100/80 shadow-sm ring-1 ring-amber-500/30"
          : "border-amber-200 bg-white hover:border-amber-400 hover:bg-amber-50/70 hover:shadow-sm";
    const badgeClasses =
      tone === "bill"
        ? "bg-emerald-600 text-white"
        : "bg-amber-600 text-white";
    return <button
          key={d.denomination_id}
          type="button"
          onClick={() => addDenom(d.denomination_id)}
          disabled={readOnly}
          className={cn(
            "group relative flex items-center gap-2 rounded-xl border px-2 py-1 text-left transition-colors outline-none focus:outline-none select-none transform-gpu",
            toneClasses
          )}
        >
          {active && (
            <span className={cn(
              "absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold shadow-sm",
              badgeClasses
            )}>
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
            "shrink-0 bg-white px-3 sm:px-4 mt-2 sm:mt-0",
            postPaySummary ? "pt-safe pb-1 sm:pt-0 sm:pb-2" : "pt-safe pb-0 sm:pt-0",
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
                <>Cobrar {order ? getOrderRef(order.order_code, order.order_number) : ""}</>
              )}
            </span>
            {order && !postPaySummary && (
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                -{" "}
                {getCajaOrderOriginLabel({
                  orderType: order.order_type,
                  tableName: order.table_name ?? order.table_name_snapshot,
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
              Orden {getOrderRef(order.order_code, order.order_number)}
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
                      {postPaySummary.lines.map((denomination) => {
                        const isBill = denomination.denomination_type === "bill";
                        return (
                        <div
                          key={denomination.denomination_id}
                          className={cn(
                            "flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-base sm:text-lg",
                            isBill
                              ? "border-emerald-300/70 bg-emerald-100"
                              : "border-amber-300/70 bg-amber-100"
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <DenominationQtyCircle
                              qty={denomination.qty}
                              size="md"
                              tone={isBill ? "emerald" : "amber"}
                            />
                            <DenominationVisual
                              label={denomination.label}
                              imageUrl={denomination.image_url}
                              className={cn(
                                "h-9 w-9 shrink-0 rounded-md border bg-white",
                                isBill ? "border-emerald-200" : "border-amber-200"
                              )}
                              iconClassName="h-3.5 w-3.5 sm:h-4 sm:w-4"
                            />
                            <span className={cn(
                              "min-w-0 flex-1 break-words font-semibold leading-tight sm:text-lg",
                              isBill ? "text-emerald-900" : "text-amber-900"
                            )}>
                              {denomination.label}
                            </span>
                          </div>
                          <span className={cn(
                            "shrink-0 font-bold tabular-nums leading-none sm:text-xl",
                            isBill ? "text-emerald-900" : "text-amber-900"
                          )}>
                            {formatCurrency(denomination.qty * denomination.value)}
                          </span>
                        </div>
                        );
                      })}
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
              <div className="grid gap-3 md:grid-cols-2 md:items-stretch xl:grid-cols-[minmax(0,1.28fr)_minmax(0,1.14fr)_9.25rem_minmax(0,1.08fr)] lg:gap-4">
                <PaymentClienteCard
                  order={order}
                  readOnly={readOnly}
                  selection={clienteSelection}
                  className="md:col-span-2 xl:col-span-1"
                />

                <div className="flex min-h-[100px] flex-col rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                  <div className="flex flex-1 flex-col justify-between gap-3 px-4 pt-3 pb-2 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                        <CreditCard className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 whitespace-nowrap">Total de la orden</p>
                        <p className="truncate text-[11px] text-sky-700/90 mt-0.5">
                          {order.is_special ? "Saldo precio especial" : "Pendiente por cobrar"}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-6 self-start sm:self-start">
                      {canOfferItemSplit && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 border-sky-300 bg-white/90 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                          onClick={() => handleSplitItemsDialogOpenChange(true)}
                        >
                          Dividir
                        </Button>
                      ) : showDisabledItemSplit && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          title="Express y Extra solo permiten cobro total de la orden"
                          className="h-8 cursor-not-allowed border-sky-200 bg-white/60 text-xs font-semibold text-sky-700/60"
                        >
                          Dividir
                        </Button>
                      ) : null}
                      <p className="font-display text-sm font-black tabular-nums tracking-tight text-sky-950">
                        {formatCurrency(baseChargeTotal)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-1.5 px-4 pb-3 text-[11px] font-medium text-sky-800/75">
                    {isMixedSpecial && (
                      <>
                        <div className="flex items-center justify-between">
                          <span>Orden especial (valor manual)</span>
                          <span className="font-semibold text-orange-700">{formatCurrency(mixedGroupTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Orden normal (precio real)</span>
                          <span className="font-semibold">{formatCurrency(mixedRestReal)}</span>
                        </div>
                        <div className="my-0.5 border-t border-dashed border-sky-200" />
                      </>
                    )}
                    <div className="flex items-center justify-between">
                      <span>Descuento Normal</span>
                      <span>{formatCurrency(0)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between">
                        <span>Descuento por Oferta Pasada</span>
                        <span className="text-emerald-600 font-bold tabular-nums">
                          -{formatCurrency(discountAmount)}
                        </span>
                      </div>
                    )}
                    {clientSaldo > 0 && (
                      <div className="flex items-center justify-between mt-1 pt-1 border-t border-sky-200/50">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={useSaldo} 
                            onChange={(e) => setUseSaldo(e.target.checked)}
                            disabled={readOnly}
                            className="rounded border-sky-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span>Usar Saldo a Favor ({formatCurrency(clientSaldo)})</span>
                        </label>
                        <span className={appliedSaldo > 0 ? "text-emerald-600 font-bold tabular-nums" : "tabular-nums"}>
                          {appliedSaldo > 0 ? `-${formatCurrency(appliedSaldo)}` : formatCurrency(0)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-b-[15px] border-t border-sky-200/60 bg-sky-100/40 px-4 py-2.5">
                    <span className="font-bold tracking-wider text-sky-950 text-xs">TOTAL A PAGAR</span>
                    <p className="font-display text-sm font-black tabular-nums tracking-tight text-sky-950">
                      {formatCurrency(netChargeTotal)}
                    </p>
                  </div>
                </div>

                <TransferenciaPagoSection
                  transferDatos={transferDatos}
                  onTransferDatosChange={handleTransferDatosChange}
                  netChargeTotal={netChargeTotal}
                  bancos={bancosActivos}
                  readOnly={readOnly}
                />

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
                <div className="flex min-h-0 flex-col rounded-[22px] border border-slate-200 bg-white px-4 pt-3 pb-4 shadow-sm sm:px-5 sm:pt-4 sm:pb-5 md:h-full transform-gpu">
                  <div className="mb-3 flex items-start justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">Efectivo entregado</p>
                      </div>
                    </div>
                    {!readOnly && Object.keys(receivedByDenom).length > 0 && (
                      <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-[11px] text-slate-600 hover:text-slate-900 sm:px-3 sm:text-xs" onClick={clearCash}>
                        Limpiar efectivo
                      </Button>
                    )}
                  </div>

                  <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden md:overflow-y-auto">
                    {!shiftDenoms || shiftDenoms.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Cargando denominaciones del turno... Si no aparecen en unos segundos,
                        verifica tu conexion y que tu caja este abierta en este turno.
                      </p>
                    ) : (
                      <>
                        {coinDenoms.length > 0 && (
                          <div className="rounded-2xl border border-amber-300/70 bg-amber-100 p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm" />
                              <p className="text-xs font-bold uppercase tracking-wider text-amber-900">Monedas</p>
                            </div>
                            <div className="flex flex-wrap gap-2 sm:gap-2">
                              {coinDenoms.map((d) => renderDenomButton(d, "coin"))}
                            </div>
                          </div>
                        )}
                        {billDenoms.length > 0 && (
                          <div className="rounded-2xl border border-emerald-300/70 bg-emerald-100 p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shadow-sm" />
                              <p className="text-xs font-bold uppercase tracking-wider text-emerald-900">Billetes</p>
                            </div>
                            <div className="flex flex-wrap gap-2 sm:gap-2">
                              {billDenoms.map((d) => renderDenomButton(d, "bill"))}
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
                        {selectedLines.map((line) => {
                          const isBill = line.denomination_type === "bill";
                          return (
                          <div
                            key={line.denomination_id}
                            className={cn(
                              "flex items-center justify-between gap-2 rounded-xl border px-2 py-1.5 text-[13px] shadow-sm",
                              isBill
                                ? "border-emerald-300/70 bg-emerald-100"
                                : "border-amber-300/70 bg-amber-100"
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <DenominationQtyCircle
                                qty={line.qty}
                                size="sm"
                                tone={isBill ? "emerald" : "amber"}
                              />
                              <span className={cn(
                                "min-w-0 flex-1 truncate",
                                isBill ? "text-emerald-900" : "text-amber-900"
                              )}>{line.label}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(line.lineTotal)}</span>
                              {!readOnly && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className={cn(
                                    "h-6 px-2 text-[11px]",
                                    isBill
                                      ? "border-emerald-400 text-emerald-900 hover:bg-emerald-50"
                                      : "border-amber-400 text-amber-900 hover:bg-amber-50"
                                  )}
                                  onClick={() => subtractDenom(line.denomination_id)}
                                >
                                  −1
                                </Button>
                              )}
                            </div>
                          </div>
                          );
                        })}
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
                        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-slate-300 bg-slate-200 px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Total</p>
                          <p className="font-display text-lg font-bold tabular-nums text-slate-900">{formatCurrency(changeAmount)}</p>
                        </div>
                        {changeDenomBreakdown.length > 0 ? (
                          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                            {changeDenomBreakdown.map((denomination) => {
                              const isBill = denomination.denomination_type === "bill";
                              return (
                              <div
                                key={denomination.denomination_id}
                                className={cn(
                                  "flex items-center justify-between gap-2 rounded-xl border px-2 py-1.5 text-[13px] shadow-sm",
                                  isBill
                                    ? "border-emerald-300/70 bg-emerald-100"
                                    : "border-amber-300/70 bg-amber-100"
                                )}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <DenominationQtyCircle
                                    qty={denomination.qty}
                                    size="sm"
                                    tone={isBill ? "emerald" : "amber"}
                                  />
                                  <DenominationVisual
                                    label={denomination.label}
                                    imageUrl={denomination.image_url}
                                    className={cn(
                                      "h-7 w-7 shrink-0 rounded-lg border bg-white",
                                      isBill ? "border-emerald-200" : "border-amber-200"
                                    )}
                                    iconClassName="h-3 w-3"
                                  />
                                  <span className={cn(
                                    "min-w-0 flex-1 truncate font-medium",
                                    isBill ? "text-emerald-900" : "text-amber-900"
                                  )}>
                                    {denomination.label}
                                  </span>
                                </div>
                                <span className={cn(
                                  "shrink-0 font-medium tabular-nums",
                                  isBill ? "text-emerald-900" : "text-amber-900"
                                )}>
                                  {formatCurrency(denomination.qty * denomination.value)}
                                </span>
                              </div>
                              );
                            })}
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
            postPaySummary ? "pt-2 pb-safe-min sm:py-2" : "pt-2 pb-safe-min sm:pb-0",
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
                    const handleSuccessDismiss = () => {
                      setPostPaySummary(null);
                      setReceivedByDenom({});
                      clearTransferDatos();
                      const isFullyPaidVal = wasFullyPaidRef.current || wasFullyPaid || (order 
                        ? order.is_special 
                          ? Number(order.special_pending_amount ?? 0) <= 0.005 
                          : (order.items ?? []).every((i) => Number(i.quantity_pending ?? 0) <= 0)
                        : true);
                      if (isFullyPaidVal) {
                        onClose();
                      }
                    };

                    if (!postPaySummary?.receipt) {
                      window.print();
                      handleSuccessDismiss();
                      return;
                    }
                    void printPaymentReceipt(postPaySummary.receipt).then((result) => {
                      if (result.mode === "html" && result.error) {
                        toast.warning(
                          "Impresion HTML (puente ESC/POS no disponible). Ejecute: node scripts/thermal-print-bridge.mjs",
                        );
                      }
                      handleSuccessDismiss();
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
                  setPostPaySummary(null);
                  setReceivedByDenom({});
                  clearTransferDatos();
                  const isFullyPaidVal = wasFullyPaidRef.current || wasFullyPaid || (order 
                    ? order.is_special 
                      ? Number(order.special_pending_amount ?? 0) <= 0.005 
                      : (order.items ?? []).every((i) => Number(i.quantity_pending ?? 0) <= 0)
                    : true);
                  if (isFullyPaidVal) {
                    onClose();
                  }
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
                    disabled={!canPay || paying}
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
