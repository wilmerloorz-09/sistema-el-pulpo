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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { getOrderOriginLabel } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import {
  getCashPaymentMethod,
  getDefaultPaymentMethodId,
  isCashPaymentMethodName,
  type PaymentMethodOption,
} from "@/lib/paymentMethods";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowRight, BadgeDollarSign, Clock3, Coins, CreditCard, GlassWater, HandCoins, Loader2, Minus, Plus, ReceiptText, RotateCcw, Soup, Trash2, Wallet, WalletCards } from "lucide-react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import DenominationVisual from "@/components/caja/DenominationVisual";

interface Props {
  order: PayableOrder | null;
  paymentMethods: PaymentMethodOption[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => void;
  paying: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

interface PaymentSplitDraft {
  id: string;
  methodId: string;
  amount: number;
}

function clampQty(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildSplitId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildInitialPaymentSplits(
  paymentMethods: PaymentMethodOption[],
  cashMethodId: string | null,
  preferredMethodId: string | null,
  totalAmount: number,
): PaymentSplitDraft[] {
  if (cashMethodId) {
    return [{ id: buildSplitId(), methodId: cashMethodId, amount: 0 }];
  }

  const fallbackMethodId =
    preferredMethodId ?? paymentMethods.find((method) => method.id !== cashMethodId)?.id ?? null;
  return fallbackMethodId ? [{ id: buildSplitId(), methodId: fallbackMethodId, amount: totalAmount }] : [];
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

  const toneClass = tone === "selected"
    ? "bg-orange-100 text-orange-700"
    : "bg-stone-100 text-slate-600";

  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", toneClass)}>
      {isDrinkItem(description) ? <GlassWater className="h-4 w-4" /> : <Soup className="h-4 w-4" />}
    </span>
  );
}

export default function PaymentDialog({
  order,
  paymentMethods,
  shiftDenoms,
  onPay,
  paying,
  onClose,
  readOnly = false,
}: Props) {
  const unpaidItems = useMemo(() => order?.items.filter((item) => item.quantity_pending > 0) ?? [], [order]);
  const paidItems = useMemo(() => order?.items.filter((item) => item.quantity_pending <= 0) ?? [], [order]);
  const defaultMethodId = useMemo(() => getDefaultPaymentMethodId(paymentMethods), [paymentMethods]);
  const cashMethod = useMemo(() => getCashPaymentMethod(paymentMethods), [paymentMethods]);

  const [payQuantities, setPayQuantities] = useState<Record<string, number>>({});
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitDraft[]>([]);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [cashDraftReceived, setCashDraftReceived] = useState<Record<string, number>>({});
  const [specialAmountInput, setSpecialAmountInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cashDetailOpen, setCashDetailOpen] = useState(false);
  const [cashOverpayConfirmOpen, setCashOverpayConfirmOpen] = useState(false);
  const [pendingCashDenominationId, setPendingCashDenominationId] = useState<string | null>(null);
  const isSpecialOrder = Boolean(order?.is_special);

  useEffect(() => {
    if (!order) return;

    const nextQuantities: Record<string, number> = {};
    for (const item of order.items) {
      if (item.quantity_pending > 0) {
        nextQuantities[item.id] = 0;
      }
    }

    setPayQuantities(nextQuantities);
    setSelectedRows(
      Object.fromEntries(
        order.items
          .filter((item) => item.quantity_pending > 0)
          .map((item) => [item.id, false]),
      ),
    );
    setPaymentSplits(buildInitialPaymentSplits(paymentMethods, cashMethod?.id ?? null, defaultMethodId ?? null, 0));
    setReceived({});
    setCashDraftReceived({});
    setCashDetailOpen(false);
    setCashOverpayConfirmOpen(false);
    setPendingCashDenominationId(null);
  }, [order?.id, order?.items, defaultMethodId, cashMethod?.id, paymentMethods]);

  useEffect(() => {
    if (!order?.is_special) {
      setSpecialAmountInput("");
      return;
    }

    const suggestedAmount = roundMoney(
      Math.max(0, Number(order.special_pending_amount ?? order.special_total_manual ?? 0)),
    );
    setSpecialAmountInput(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "");
  }, [order?.id, order?.is_special, order?.special_pending_amount, order?.special_total_manual]);

  const selectedItems = useMemo(
    () => unpaidItems.filter((item) => (selectedRows[item.id] ?? false) && (payQuantities[item.id] ?? 0) > 0),
    [unpaidItems, payQuantities, selectedRows],
  );

  const selectedTotal = useMemo(
    () => roundMoney(selectedItems.reduce((sum, item) => sum + computeLineAmount(payQuantities[item.id] ?? 0, item.unit_price), 0)),
    [selectedItems, payQuantities],
  );
  const specialChargeAmount = useMemo(
    () => roundMoney(Math.max(0, parseMoneyInput(specialAmountInput))),
    [specialAmountInput],
  );
  const currentChargeTotal = isSpecialOrder ? specialChargeAmount : selectedTotal;
  const hasChargeSelection = isSpecialOrder ? currentChargeTotal > 0 : selectedItems.length > 0;
  const selectedCount = isSpecialOrder ? (hasChargeSelection ? 1 : 0) : selectedItems.length;

  const paymentMethodMap = useMemo(
    () => Object.fromEntries(paymentMethods.map((method) => [method.id, method])),
    [paymentMethods],
  );

  useEffect(() => {
    setPaymentSplits((prev) => {
      const validMethods = new Set(paymentMethods.map((method) => method.id));
      const filtered = prev.filter((split) => validMethods.has(split.methodId));
      const base = filtered.length > 0 ? filtered : defaultMethodId ? [{ id: buildSplitId(), methodId: defaultMethodId, amount: 0 }] : [];

      if (base.length === 0) return base;
      if (base.length === 1) {
        const isCashOnly = isCashPaymentMethodName(paymentMethodMap[base[0].methodId]?.name ?? "");
        return [{ ...base[0], amount: isCashOnly ? 0 : currentChargeTotal }];
      }

      const next = base.map((split) => ({ ...split }));
      const sumBeforeLast = roundMoney(next.slice(0, -1).reduce((sum, split) => sum + Number(split.amount || 0), 0));
      next[next.length - 1].amount = Math.max(0, roundMoney(currentChargeTotal - sumBeforeLast));
      return next;
    });
  }, [currentChargeTotal, defaultMethodId, paymentMethods, paymentMethodMap]);

  const cashSplit = useMemo(
    () => paymentSplits.find((split) => isCashPaymentMethodName(paymentMethodMap[split.methodId]?.name ?? "")) ?? null,
    [paymentSplits, paymentMethodMap],
  );

  useEffect(() => {
    if (!cashSplit && cashDetailOpen) {
      setCashDetailOpen(false);
    }
  }, [cashDetailOpen, cashSplit]);

  useEffect(() => {
    if (cashDetailOpen) {
      setCashDraftReceived(received);
    }
  }, [cashDetailOpen, received]);

  const orderedPaymentMethods = useMemo(() => {
    if (!cashMethod) return paymentMethods;

    return [
      cashMethod,
      ...paymentMethods.filter((method) => method.id !== cashMethod.id),
    ];
  }, [cashMethod, paymentMethods]);



  const totalReceived = useMemo(
    () => roundMoney(shiftDenoms.reduce((sum, denomination) => sum + (received[denomination.denomination_id] || 0) * denomination.value, 0)),
    [received, shiftDenoms],
  );
  const hasReceivedDenoms = Object.values(received).some((quantity) => quantity > 0);
  const paymentAllocationPreview = useMemo(() => {
    let remainingToApply = currentChargeTotal;

    return paymentSplits
      .filter((split) => Number(split.amount) > 0)
      .map((split) => {
        const isCashMethod = isCashPaymentMethodName(paymentMethodMap[split.methodId]?.name ?? "");
        const baseAmount = roundMoney(Number(split.amount) || 0);
        const receivedAmount = isCashMethod && hasReceivedDenoms ? totalReceived : baseAmount;
        const appliedAmount = roundMoney(Math.min(receivedAmount, Math.max(0, remainingToApply)));
        remainingToApply = roundMoney(Math.max(0, remainingToApply - appliedAmount));

        return {
          ...split,
          isCashMethod,
          receivedAmount,
          appliedAmount,
          overpayAmount: roundMoney(Math.max(0, receivedAmount - appliedAmount)),
          methodName: paymentMethodMap[split.methodId]?.name ?? "Metodo",
        };
      });
  }, [paymentSplits, paymentMethodMap, currentChargeTotal, hasReceivedDenoms, totalReceived]);
  const cashPreview = paymentAllocationPreview.find((split) => split.isCashMethod) ?? null;
  const cashAppliedAmount = roundMoney(cashPreview?.appliedAmount ?? 0);
  const appliedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.appliedAmount, 0));
  const receivedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.receivedAmount, 0));
  const shortageAmount = roundMoney(Math.max(0, currentChargeTotal - appliedSplitTotal));
  const changeAmount = roundMoney(Math.max(0, receivedSplitTotal - currentChargeTotal));

  const changeDenomBreakdown = useMemo(() => {
    if (changeAmount <= 0) return [];

    const sorted = [...shiftDenoms].filter((denomination) => denomination.value > 0).sort((a, b) => b.value - a.value);
    const result: { denomination_id: string; qty: number; value: number; label: string; image_url?: string | null }[] = [];
    let remaining = changeAmount;

    for (const denomination of sorted) {
      if (remaining <= 0.001) break;
      const maxQty = Math.floor(remaining / denomination.value);
      const available = denomination.qty_current + (received[denomination.denomination_id] || 0);
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
  }, [changeAmount, shiftDenoms, received]);

  const changeGiven = roundMoney(changeDenomBreakdown.reduce((sum, denomination) => sum + denomination.qty * denomination.value, 0));
  const cannotMakeChange = changeAmount > 0 && Math.abs(changeGiven - changeAmount) > 0.001;
  const availableMethodIds = useMemo(() => new Set(paymentMethods.map((method) => method.id)), [paymentMethods]);
  const setItemQty = (itemId: string, qty: number, maxQty: number) => {
    const normalized = Number.isFinite(qty) ? Math.floor(qty) : 0;
    const nextQty = clampQty(normalized, 0, maxQty);
    setPayQuantities((prev) => ({
      ...prev,
      [itemId]: nextQty,
    }));
    setSelectedRows((prev) => ({
      ...prev,
      [itemId]: nextQty > 0,
    }));
  };

  const moveOneToCharge = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (payQuantities[itemId] ?? 0) + 1, maxQty);
  };

  const moveAllToCharge = (itemId: string, maxQty: number) => {
    setItemQty(itemId, maxQty, maxQty);
  };

  const moveOneBackToPending = (itemId: string, maxQty: number) => {
    setItemQty(itemId, (payQuantities[itemId] ?? 0) - 1, maxQty);
  };

  const moveAllBackToPending = (itemId: string, maxQty: number) => {
    setItemQty(itemId, 0, maxQty);
  };

  const fillAllPending = () => {
    const next: Record<string, number> = {};
    const nextSelected: Record<string, boolean> = {};
    for (const item of unpaidItems) {
      next[item.id] = item.quantity_pending;
      nextSelected[item.id] = true;
    }
    setPayQuantities(next);
    setSelectedRows(nextSelected);
  };

  const clearAllSelection = () => {
    const next: Record<string, number> = {};
    const nextSelected: Record<string, boolean> = {};
    for (const item of unpaidItems) {
      next[item.id] = 0;
      nextSelected[item.id] = false;
    }
    setPayQuantities(next);
    setSelectedRows(nextSelected);
  };

  const toggleItemSelection = (itemId: string, checked: boolean, maxQty: number) => {
    setSelectedRows((prev) => ({
      ...prev,
      [itemId]: checked,
    }));

    setPayQuantities((prev) => {
      if (checked) {
        return {
          ...prev,
          [itemId]: maxQty,
        };
      }

      return {
        ...prev,
        [itemId]: 0,
      };
    });
  };

  const pendingUnitsTotal = useMemo(
    () => unpaidItems.reduce((sum, item) => sum + Math.max(0, item.quantity_pending - (payQuantities[item.id] ?? 0)), 0),
    [unpaidItems, payQuantities],
  );

  const selectedUnitsTotal = useMemo(
    () => unpaidItems.reduce((sum, item) => sum + (payQuantities[item.id] ?? 0), 0),
    [unpaidItems, payQuantities],
  );

  const pendingItemsForNow = useMemo(
    () => unpaidItems
      .map((item) => ({
        ...item,
        quantity_available_now: Math.max(0, item.quantity_pending - (payQuantities[item.id] ?? 0)),
      }))
      .filter((item) => item.quantity_available_now > 0),
    [unpaidItems, payQuantities],
  );

  const selectedItemsForNow = useMemo(
    () => unpaidItems
      .map((item) => ({
        ...item,
        quantity_to_charge_now: payQuantities[item.id] ?? 0,
      }))
      .filter((item) => item.quantity_to_charge_now > 0),
    [unpaidItems, payQuantities],
  );

  const pendingAmountForNow = useMemo(
    () => roundMoney(pendingItemsForNow.reduce((sum, item) => sum + computeLineAmount(item.quantity_available_now, item.unit_price), 0)),
    [pendingItemsForNow],
  );

  const selectedAmountForNow = useMemo(
    () => roundMoney(selectedItemsForNow.reduce((sum, item) => sum + computeLineAmount(item.quantity_to_charge_now, item.unit_price), 0)),
    [selectedItemsForNow],
  );

  const setSplitAmount = (splitId: string, amount: number) => {
    const normalized = Number.isFinite(amount) ? roundMoney(Math.max(0, amount)) : 0;
    setPaymentSplits((prev) => prev.map((split) => (split.id === splitId ? { ...split, amount: normalized } : split)));
  };

  const toggleMethodSelection = (methodId: string, checked: boolean) => {
    const isCashMethod = isCashPaymentMethodName(paymentMethodMap[methodId]?.name ?? "");
    setPaymentSplits((prev) => {
      const exists = prev.some((split) => split.methodId === methodId);

      if (checked) {
        if (exists) return prev;
        return [
          ...prev,
          {
            id: buildSplitId(),
            methodId,
            amount: prev.length === 0 ? currentChargeTotal : Math.max(0, shortageAmount),
          },
        ];
      }

      if (!exists) return prev;
      return prev.filter((split) => split.methodId !== methodId);
    });

    if (!checked && isCashMethod) {
      setReceived({});
      setCashDraftReceived({});
      setCashDetailOpen(false);
    }
  };

  const handlePay = () => {
    if (!order || readOnly) return;
    if (!hasChargeSelection) return;
    if (paymentMethods.length === 0) {
      toast.error("No hay metodos de pago activos configurados");
      return;
    }

    const itemSelections = isSpecialOrder
      ? []
      : selectedItems.map((item) => {
          const quantity = payQuantities[item.id] ?? 0;
          const amount = computeLineAmount(quantity, item.unit_price);
          return {
            itemId: item.id,
            quantity,
            unitPrice: item.unit_price,
            amount,
          };
        });

    if (!isSpecialOrder && itemSelections.some((item) => item.quantity <= 0)) {
      toast.error("Debes seleccionar al menos una cantidad valida para cobrar");
      return;
    }
    if (isSpecialOrder && currentChargeTotal <= 0) {
      toast.error("Ingresa un monto valido para cobrar la orden especial");
      return;
    }

    const tenderedSplitsPayload = paymentAllocationPreview.map((split) => ({
      methodId: split.methodId,
      amount: split.receivedAmount,
    }));
    const paymentSplitsPayload = paymentAllocationPreview
      .filter((split) => split.appliedAmount > 0)
      .map((split) => ({ methodId: split.methodId, amount: split.appliedAmount }));

    if (tenderedSplitsPayload.length === 0) {
      toast.error("Debes ingresar al menos un metodo de pago");
      return;
    }

    if (tenderedSplitsPayload.some((split) => !split.methodId || !availableMethodIds.has(split.methodId))) {
      toast.error("Hay metodos de pago invalidos en la distribucion");
      return;
    }

    if (shortageAmount > 0.01) {
      toast.error("El total recibido es menor al total a cobrar");
      return;
    }

    if (cashSplit && cashAppliedAmount > 0) {
      if (!hasReceivedDenoms) {
        toast.error("Efectivo requiere registrar el monto recibido por denominaciones");
        return;
      }
      if (totalReceived + 0.001 < cashAppliedAmount) {
        toast.error("El monto recibido en efectivo es menor al valor aplicado en efectivo");
        return;
      }
      if (cannotMakeChange) {
        toast.error("No hay suficientes denominaciones en caja para dar el cambio exacto");
        return;
      }
    }

    const cashReceivedDenoms = cashSplit
      ? Object.entries(received)
          .filter(([, quantity]) => quantity > 0)
          .map(([denomination_id, qty]) => ({ denomination_id, qty }))
      : [];

    const cashChangeDenoms = cashSplit
      ? changeDenomBreakdown.map((denomination) => ({
          denomination_id: denomination.denomination_id,
          qty: denomination.qty,
        }))
      : [];

    setConfirmOpen(false);
    onPay({
      orderId: order.id,
      itemSelections,
      paymentSplits: paymentSplitsPayload,
      tenderedSplits: tenderedSplitsPayload,
      isSpecial: isSpecialOrder,
      specialAmount: isSpecialOrder ? currentChargeTotal : undefined,
      receivedTotal: roundMoney(receivedSplitTotal),
      totalAmount: roundMoney(currentChargeTotal),
      cashReceivedDenoms,
      cashChangeDenoms,
    });
  };

  const canPay =
    !readOnly &&
    hasChargeSelection &&
    paymentMethods.length > 0 &&
    paymentSplits.some((split) => split.amount > 0) &&
    !paying &&
    shortageAmount <= 0.01 &&
    (!cashSplit || (cashAppliedAmount <= 0 || (hasReceivedDenoms && totalReceived + 0.001 >= cashAppliedAmount))) &&
    !(changeAmount > 0 && cannotMakeChange);

  const paymentStatusMessage = useMemo(() => {
    if (readOnly) return "Modo consulta activo";
    if (!hasChargeSelection) return isSpecialOrder ? "Ingresa un monto para cobrar" : "Selecciona al menos una cantidad para cobrar";
    if (paymentMethods.length === 0) return "No hay metodos de pago activos";
    if (!paymentSplits.some((split) => split.amount > 0)) return "Ingresa al menos un monto de pago";
    if (shortageAmount > 0.01) return `Faltan $${shortageAmount.toFixed(2)} por recibir`;
    if (cashSplit && cashAppliedAmount > 0 && !hasReceivedDenoms) return "Registra el monto recibido en efectivo";
    if (cashSplit && cashAppliedAmount > 0 && totalReceived + 0.001 < cashAppliedAmount) {
      return `Efectivo recibido insuficiente: faltan $${(cashAppliedAmount - totalReceived).toFixed(2)}`;
    }
    if (changeAmount > 0 && cannotMakeChange) return "No hay cambio exacto disponible en caja";
    if (paying) return "Procesando cobro...";
    if (changeAmount > 0) return `Listo para confirmar. Se entregaran $${changeAmount.toFixed(2)} de cambio`;
    return "Cobro listo para confirmar";
  }, [
    readOnly,
    hasChargeSelection,
    isSpecialOrder,
    paymentMethods.length,
    paymentSplits,
    shortageAmount,
    cashSplit,
    cashAppliedAmount,
    hasReceivedDenoms,
    totalReceived,
    changeAmount,
    cannotMakeChange,
    paying,
  ]);

  const sortedDenoms = useMemo(
    () => [...shiftDenoms].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.value - b.value),
    [shiftDenoms],
  );
  const coinDenoms = useMemo(
    () => sortedDenoms.filter((denomination) => denomination.denomination_type !== "bill"),
    [sortedDenoms],
  );
  const billDenoms = useMemo(
    () => sortedDenoms.filter((denomination) => denomination.denomination_type === "bill"),
    [sortedDenoms],
  );

  const draftTotalReceived = useMemo(
    () =>
      roundMoney(
        shiftDenoms.reduce(
          (sum, denomination) => sum + (cashDraftReceived[denomination.denomination_id] || 0) * denomination.value,
          0,
        ),
      ),
    [cashDraftReceived, shiftDenoms],
  );
  const draftHasReceivedDenoms = Object.values(cashDraftReceived).some((quantity) => quantity > 0);
  const nonCashAppliedAmount = roundMoney(
    paymentAllocationPreview
      .filter((split) => !split.isCashMethod)
      .reduce((sum, split) => sum + split.appliedAmount, 0),
  );
  const draftCashAppliedAmount = roundMoney(Math.max(0, currentChargeTotal - nonCashAppliedAmount));
  const draftChangeAmount = roundMoney(draftCashAppliedAmount > 0 ? Math.max(0, draftTotalReceived - draftCashAppliedAmount) : 0);

  const commitDraftDenomination = (denominationId: string) => {
    setCashDraftReceived((prev) => ({
      ...prev,
      [denominationId]: (prev[denominationId] || 0) + 1,
    }));
  };

  const addDraftDenomination = (denominationId: string) => {
    if (draftCashAppliedAmount > 0 && draftTotalReceived + 0.001 >= draftCashAppliedAmount) {
      setPendingCashDenominationId(denominationId);
      setCashOverpayConfirmOpen(true);
      return;
    }

    commitDraftDenomination(denominationId);
  };

  const setDraftDenominationQty = (denominationId: string, nextQty: number) => {
    const normalized = Math.max(0, Math.floor(Number.isFinite(nextQty) ? nextQty : 0));

    setCashDraftReceived((prev) => {
      if (normalized <= 0) {
        const next = { ...prev };
        delete next[denominationId];
        return next;
      }

      return {
        ...prev,
        [denominationId]: normalized,
      };
    });
  };

  const openCashDetail = (methodId: string, isSelected: boolean) => {
    if (!isSelected) {
      toggleMethodSelection(methodId, true);
    }
    setCashDraftReceived(received);
    setCashDetailOpen(true);
  };

  const cancelCashDetail = () => {
    setCashDraftReceived(received);
    setCashDetailOpen(false);
    setCashOverpayConfirmOpen(false);
    setPendingCashDenominationId(null);
  };

  const acceptCashDetail = () => {
    setReceived(cashDraftReceived);
    if (cashSplit) {
      const nextAmount = roundMoney(
        shiftDenoms.reduce(
          (sum, denomination) => sum + (cashDraftReceived[denomination.denomination_id] || 0) * denomination.value,
          0,
        ),
      );
      setSplitAmount(cashSplit.id, nextAmount);
    }
    setCashDetailOpen(false);
  };

  const renderDenominationButton = (denomination: ShiftDenom) => {
    const selectedQty = cashDraftReceived[denomination.denomination_id] || 0;

    return (
      <button
        key={denomination.denomination_id}
        onClick={() => addDraftDenomination(denomination.denomination_id)}
        className={cn(
          "group relative overflow-hidden rounded-2xl border bg-card text-left transition-all",
          selectedQty > 0 ? "border-primary/50 shadow-sm" : "border-border hover:border-primary/30 hover:shadow-sm",
        )}
        disabled={readOnly}
      >
        {selectedQty > 0 && (
          <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-sm">
            x{selectedQty}
          </span>
        )}
        <DenominationVisual
          label={denomination.label}
          imageUrl={denomination.image_url}
          className="h-12 w-full rounded-none border-0 bg-white sm:h-14"
          imageClassName="object-contain bg-white p-1"
          iconClassName="h-5 w-5"
        />
        <div className="border-t border-border bg-muted/20 px-1 py-1 text-center">
          <div className="text-xs font-black leading-none text-primary">${denomination.value.toFixed(2)}</div>
        </div>
      </button>
    );
  };

  const renderModernStandardContent = (currentOrder: PayableOrder) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#fffdf8] px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
        <div className="space-y-4">
          {readOnly && (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-slate-500">
              Modo consulta. Puedes revisar la distribucion del cobro, pero no registrarlo.
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="min-h-[260px] rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)] md:min-h-[300px]">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-950">Items pendientes</h3>
                  <p className="text-xs text-slate-500">Mueve desde aqui lo que vas a cobrar ahora.</p>
                </div>
                <div className="w-full sm:w-auto">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-amber-700">Total pendiente</p>
                    <p className="text-base font-semibold text-amber-900">${pendingAmountForNow.toFixed(2)}</p>
                  </div>
                </div>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto" onClick={fillAllPending}>
                    <ArrowRight className="h-4 w-4" />
                    Todo
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                        <div className="hidden grid-cols-[44px_minmax(0,1fr)_64px_78px_78px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:grid md:grid-cols-[52px_minmax(0,1fr)_72px_92px_86px] md:gap-3 md:px-3 md:text-[11px]">
                          <span className="text-center">Cant.</span>
                          <span>Producto</span>
                          <span className="text-right">Unit.</span>
                          <span className="text-right">Total pend.</span>
                          <span className="text-right">Mover</span>
                        </div>

                {pendingItemsForNow.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 px-6 text-center text-sm text-slate-500 md:h-[320px]">
                    No quedan items pendientes para mover en esta operacion.
                  </div>
                ) : (
                        <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1 md:max-h-[320px]">
                          {pendingItemsForNow.map((item) => (
                      <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)_64px_78px_78px] items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50/50 px-2 py-2 sm:grid-cols-[52px_minmax(0,1fr)_72px_92px_86px] sm:gap-2.5 sm:px-2.5 sm:py-2.5">
                        <span className="text-center text-sm font-semibold text-slate-900">{item.quantity_available_now}</span>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} />
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                            <span className="block text-[11px] text-slate-500 sm:hidden">
                              ${item.unit_price.toFixed(2)} c/u
                            </span>
                          </div>
                        </div>
                        <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unit_price.toFixed(2)}</span>
                        <span className="text-right text-sm font-semibold text-slate-900">${computeLineAmount(item.quantity_available_now, item.unit_price).toFixed(2)}</span>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveOneToCharge(item.id, item.quantity_pending)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveAllToCharge(item.id, item.quantity_pending)}
                            className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            &gt;&gt;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="min-h-[260px] rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)] md:min-h-[300px]">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-950">Items a cobrar ahora</h3>
                  <p className="text-xs text-slate-500">Esto es lo que se registra en esta operacion.</p>
                </div>
                <div className="w-full sm:w-auto">
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-orange-700">Total seleccionado</p>
                    <p className="text-base font-semibold text-orange-900">${selectedAmountForNow.toFixed(2)}</p>
                  </div>
                </div>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto" onClick={clearAllSelection}>
                    <RotateCcw className="h-4 w-4" />
                    Vaciar
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <div className="hidden grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:grid md:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] md:gap-3 md:px-3 md:text-[11px]">
                  <span>Mover</span>
                  <span className="text-center">Cant.</span>
                  <span>Producto</span>
                  <span className="text-right">Unit.</span>
                  <span className="text-right">Subtotal</span>
                </div>

                {selectedItemsForNow.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 px-6 text-center text-sm text-slate-500 md:h-[320px]">
                    Mueve items desde la izquierda para incluirlos en este cobro.
                  </div>
                ) : (
                  <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1 md:max-h-[320px]">
                    {selectedItemsForNow.map((item) => (
                      <div key={item.id} className="grid grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/40 px-2 py-2 sm:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] sm:gap-2.5 sm:px-2.5 sm:py-2.5">
                        <div className="flex justify-start gap-2">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveAllBackToPending(item.id, item.quantity_pending)}
                            className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            &lt;&lt;
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveOneBackToPending(item.id, item.quantity_pending)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ArrowLeft className="h-4 w-4" />
                          </button>
                        </div>
                        <span className="text-center text-sm font-semibold text-slate-900">{item.quantity_to_charge_now}</span>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} tone="selected" />
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                            <span className="block text-[11px] text-slate-500 sm:hidden">
                              ${item.unit_price.toFixed(2)} c/u
                            </span>
                          </div>
                        </div>
                        <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unit_price.toFixed(2)}</span>
                        <span className="text-right text-sm font-semibold text-slate-900">${computeLineAmount(item.quantity_to_charge_now, item.unit_price).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

          </div>

        </div>
      </div>

      <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-3 sm:px-4 lg:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_250px] lg:items-start">
          <div className="rounded-[22px] border border-stone-200 bg-stone-50/70 px-3 py-3">
            {paymentMethods.length === 0 ? (
              <div className="text-sm text-red-700">
                No hay metodos de pago activos para esta sucursal.
              </div>
            ) : (
              <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-3 xl:flex xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
                {orderedPaymentMethods.map((method) => {
                  const split = paymentSplits.find((row) => row.methodId === method.id) ?? null;
                  const isSelected = !!split;
                  const isCash = isCashPaymentMethodName(method.name);

                  return (
                    <div
                      key={method.id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 sm:gap-3",
                        isCash ? "w-full xl:w-[420px]" : "w-full md:w-auto xl:w-[280px]",
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleMethodSelection(method.id, checked === true)}
                        disabled={readOnly}
                        className="h-5 w-5 rounded-md"
                      />

                      <div className="w-[102px] shrink-0 sm:w-[110px]">
                        <p className="text-sm font-semibold text-slate-950">{method.name}</p>
                        <p className="text-xs text-slate-500">
                          {isCash ? "Efectivo recibido" : "Valor recibido"}
                        </p>
                      </div>

                      <Input
                        type="text"
                        inputMode="decimal"
                        value={(split?.amount ?? 0).toFixed(2)}
                        onChange={(e) => split && setSplitAmount(split.id, parseMoneyInput(e.target.value))}
                        className="h-10 min-w-[112px] flex-1 rounded-2xl border-stone-200 bg-white sm:w-[126px] sm:flex-none"
                        readOnly={isCash}
                        disabled={readOnly || !isSelected || isCash}
                      />

                      {isCash && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 rounded-full border-stone-200 bg-white px-4 text-slate-700"
                          onClick={() => openCashDetail(method.id, isSelected)}
                        >
                          <Coins className="h-4 w-4" />
                          Monedas y billetes
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!readOnly ? (
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!canPay}
              className="h-12 w-full rounded-full border-0 bg-gradient-to-r from-orange-500 to-amber-400 px-6 text-base font-semibold text-white shadow-[0_18px_36px_-24px_rgba(249,115,22,0.55)] hover:translate-y-0 hover:brightness-105 lg:mt-0 lg:w-[250px]"
            >
              {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
              Cobrar ${currentChargeTotal.toFixed(2)}
            </Button>
          ) : (
            <div className="rounded-2xl bg-stone-100 px-4 py-3 text-center text-xs text-slate-500 lg:w-[280px]">
              Esta cuenta no puede registrar cobros.
            </div>
          )}
        </div>

        <div
          className={cn(
            "mt-3 rounded-2xl px-4 py-3 text-sm font-medium",
            canPay
              ? "border border-green-500/20 bg-green-500/10 text-green-700"
              : "border border-amber-500/20 bg-amber-500/10 text-amber-700",
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-slate-600">
                Total seleccionado: <span className="font-semibold text-slate-950">${currentChargeTotal.toFixed(2)}</span>
              </span>
              <span className="text-slate-600">
                Total recibido: <span className="font-semibold text-slate-950">${receivedSplitTotal.toFixed(2)}</span>
              </span>
              <span className="text-slate-600">
                {changeAmount > 0 ? "Cambio" : "Faltante"}:{" "}
                <span
                  className={cn(
                    "font-semibold",
                    changeAmount > 0 ? "text-emerald-700" : shortageAmount > 0 ? "text-amber-700" : "text-slate-950",
                  )}
                >
                  ${(changeAmount > 0 ? changeAmount : shortageAmount).toFixed(2)}
                </span>
              </span>
            </div>
            <div className="text-sm sm:text-right">
              {paymentStatusMessage}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] flex-col overflow-hidden bg-white p-0 sm:max-h-[94vh] sm:w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-1.5rem)] lg:max-w-[1500px]">
        <DialogHeader className="shrink-0 border-b border-border bg-white px-4 py-3 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-lg sm:text-xl">
            <span className="min-w-0">
              {readOnly ? "Consulta de cobro" : "Cobrar"} {order?.order_code ?? `#${order?.order_number}`}
            </span>
            {order && (
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                - {getOrderOriginLabel({
                  orderType: order.order_type,
                  tableName: order.table_name,
                  splitCode: order.split_code,
                  isSpecial: order.is_special,
                })}
              </span>
            )}
          </DialogTitle>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            {isSpecialOrder
              ? "Registra el cobro especial con el monto manual y mantiene visibles los items reales como referencia."
              : "Mueve a la derecha solo lo que vas a cobrar en esta operacion."}
          </p>
        </DialogHeader>

        {order && !isSpecialOrder ? (
          renderModernStandardContent(order)
        ) : order ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-3 py-3 sm:px-6 sm:py-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
                <div className="space-y-4">
                  {readOnly && (
                    <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                      Modo consulta: puedes revisar los montos pendientes, pero no registrar pagos.
                    </div>
                  )}

                  <section className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {isSpecialOrder ? "Cobro especial" : "Seleccion de cantidades a cobrar"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isSpecialOrder
                            ? "El monto manual gobierna este cobro. El total real de items sigue visible como referencia."
                            : "Ajusta solo las cantidades que se van a cobrar en esta operacion."}
                        </p>
                      </div>
                      {!readOnly && !isSpecialOrder && (
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                          <Button type="button" variant="outline" size="sm" onClick={fillAllPending}>
                            Todo pendiente
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={clearAllSelection}>
                            Limpiar
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-sky-700">
                              {isSpecialOrder ? "Total real" : "Items pendientes"}
                            </p>
                            <p className="mt-0.5 text-lg font-black leading-none text-sky-900">
                              {isSpecialOrder ? `$${order.special_real_total.toFixed(2)}` : unpaidItems.length}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-sky-600 shadow-sm">
                            <Clock3 className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-violet-700">
                              {isSpecialOrder ? "Ya pagado" : "Seleccionados"}
                            </p>
                            <p className="mt-0.5 text-lg font-black leading-none text-violet-900">
                              {isSpecialOrder ? `$${order.special_paid_amount.toFixed(2)}` : selectedCount}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-violet-600 shadow-sm">
                            <CreditCard className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-emerald-700">
                              {isSpecialOrder ? "Pendiente especial" : "Total actual"}
                            </p>
                            <p className="mt-0.5 text-lg font-black leading-none text-emerald-900">
                              {isSpecialOrder ? `$${order.special_pending_amount.toFixed(2)}` : `$${currentChargeTotal.toFixed(2)}`}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-emerald-600 shadow-sm">
                            <BadgeDollarSign className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 max-h-[46dvh] overflow-y-auto pr-1 sm:max-h-[48vh]">
                      {isSpecialOrder ? (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <label className="text-sm font-semibold text-foreground">Cobrar ahora</label>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={specialAmountInput}
                                  onChange={(event) => setSpecialAmountInput(event.target.value)}
                                  placeholder="Ingresa el monto a cobrar"
                                  className="h-11 rounded-xl"
                                  disabled={readOnly}
                                />
                              </div>
                              <div className="rounded-2xl border border-orange-300 bg-white/85 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Total especial configurado</p>
                                <p className="mt-1 font-display text-2xl font-black text-orange-900">
                                  {order.special_total_manual != null ? `$${order.special_total_manual.toFixed(2)}` : "Sin definir"}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  El cobro se descuenta de este monto, no del total real de los ítems.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-muted-foreground">Items de referencia</p>
                              <Badge variant="outline" className="text-[10px]">
                                {order.items.length}
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              {order.items.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-foreground">{item.description_snapshot}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {item.quantity} unidad(es) - pagadas {item.quantity_paid} - pendientes {item.quantity_pending}
                                    </p>
                                  </div>
                                  <span className="shrink-0 text-sm font-semibold text-foreground">
                                    ${item.total.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-[600px]">
                            <div className="sticky top-0 z-10 mb-1 grid grid-cols-[28px_minmax(0,2.05fr)_80px_64px_82px_80px] gap-2 rounded-xl border border-border bg-white/95 px-3 py-2 backdrop-blur">
                              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Sel.</p>
                              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Producto</p>
                              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                                <span className="block">Precio</span>
                                <span className="block">unitario</span>
                              </p>
                              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Pendiente</p>
                              <p className="text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                                <span className="block">Cobrar</span>
                                <span className="block">ahora</span>
                              </p>
                              <p className="text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Subtotal</p>
                            </div>

                            <div className="space-y-1.5">
                              {unpaidItems.map((item) => {
                                const qtyToPay = payQuantities[item.id] ?? 0;
                                const isSelected = selectedRows[item.id] ?? false;
                                const lineSubtotal = computeLineAmount(qtyToPay, item.unit_price);

                                return (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      "grid grid-cols-[28px_minmax(0,2.05fr)_80px_64px_82px_80px] items-center gap-2 rounded-lg px-3 py-2 transition-colors",
                                      isSelected && qtyToPay > 0 ? "bg-primary/5" : "bg-transparent",
                                    )}
                                  >
                                    <div className="flex items-center justify-center">
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(checked) => toggleItemSelection(item.id, checked === true, item.quantity_pending)}
                                        disabled={readOnly}
                                        className="h-4 w-4 rounded-md"
                                      />
                                    </div>
                                    <p className="truncate text-xs font-semibold leading-tight text-foreground">{item.description_snapshot}</p>
                                    <p className="text-xs font-semibold leading-none text-foreground">${item.unit_price.toFixed(2)}</p>
                                    <p className="text-center text-xs font-semibold leading-none text-foreground">{item.quantity_pending}</p>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={item.quantity_pending}
                                      step={1}
                                      value={qtyToPay}
                                      onChange={(e) => setItemQty(item.id, Number(e.target.value), item.quantity_pending)}
                                      className="h-8 w-[72px] text-xs"
                                      disabled={readOnly}
                                    />
                                    <p className="text-right text-xs font-semibold leading-none text-foreground">${lineSubtotal.toFixed(2)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {paidItems.length > 0 && (
                            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-muted-foreground">Items ya pagados</p>
                                <Badge variant="outline" className="text-[10px]">
                                  {paidItems.length}
                                </Badge>
                              </div>
                              <div className="space-y-2">
                                {paidItems.map((item) => (
                                  <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 opacity-60">
                                    <span className="min-w-0 flex-1 truncate text-sm text-foreground line-through">
                                      {item.description_snapshot} - {item.quantity} unidad(es)
                                    </span>
                                    <Badge variant="outline" className="text-[10px]">
                                      Pagado completo
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                </div>

                <div className="space-y-4">
                  {paymentMethods.length === 0 && (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
                      No hay metodos de pago activos para esta sucursal.
                    </div>
                  )}

                  <section className="rounded-2xl border border-border bg-card p-3 shadow-sm xl:sticky xl:top-0 sm:p-4">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Metodos de pago</p>
                        <p className="text-xs text-muted-foreground">Selecciona los metodos y define el monto de cada uno.</p>
                      </div>

                      <div className="space-y-1.5">
                        {orderedPaymentMethods.map((method) => {
                          const split = paymentSplits.find((row) => row.methodId === method.id) ?? null;
                          const isSelected = !!split;
                          const isCash = isCashPaymentMethodName(method.name);

                          return (
                            <div
                              key={method.id}
                              className={cn(
                                "rounded-2xl border px-3 py-2.5",
                                isSelected ? "border-primary/30 bg-primary/5" : "border-border bg-background",
                              )}
                            >
                              <div
                                className={cn(
                                  "grid items-center gap-2",
                                  isCash
                                    ? "grid-cols-[20px_minmax(0,1fr)] sm:grid-cols-[20px_minmax(0,1fr)_auto_110px]"
                                    : "grid-cols-[20px_minmax(0,1fr)] sm:grid-cols-[20px_minmax(0,1fr)_110px]",
                                )}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => toggleMethodSelection(method.id, checked === true)}
                                  disabled={readOnly}
                                  className="h-5 w-5 rounded-md"
                                />

                                <p className="min-w-0 truncate text-sm font-semibold text-foreground">{method.name}</p>

                                {isCash ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="col-span-full h-9 shrink-0 rounded-xl px-2.5 text-[11px] sm:col-auto sm:h-9 sm:px-3 sm:text-xs"
                                    onClick={() => openCashDetail(method.id, isSelected)}
                                  >
                                    Monedas y billetes
                                  </Button>
                                ) : null}

                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={(split?.amount ?? 0).toFixed(2)}
                                  onChange={(e) => split && setSplitAmount(split.id, parseMoneyInput(e.target.value))}
                                  className={cn("h-9 w-full shrink-0 rounded-xl pl-3 text-left [appearance:textfield] sm:h-10", isCash && "col-span-full sm:col-auto")}
                                  readOnly={isCash}
                                  disabled={readOnly || !isSelected || isCash}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-white px-3 py-3 sm:px-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-[620px]">
                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-sky-700">
                        {isSpecialOrder ? "Cobro actual" : "Total seleccionado"}
                      </p>
                      <p className="mt-0.5 text-lg font-black leading-none text-sky-900">${currentChargeTotal.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-violet-700">Total recibido</p>
                      <p className="mt-0.5 text-lg font-black leading-none text-violet-900">${receivedSplitTotal.toFixed(2)}</p>
                    </div>
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-1.5",
                        changeAmount > 0
                          ? "border-emerald-200 bg-emerald-50"
                          : shortageAmount > 0
                            ? "border-amber-200 bg-amber-50"
                            : "border-sky-200 bg-sky-50",
                      )}
                    >
                      <p className={cn(
                        "text-[10px] uppercase tracking-wide",
                        changeAmount > 0
                          ? "text-emerald-700"
                          : shortageAmount > 0
                            ? "text-amber-700"
                            : "text-sky-700",
                      )}>
                        {changeAmount > 0 ? "Cambio" : shortageAmount > 0 ? "Faltante" : "Cuadre"}
                      </p>
                      <p className={cn(
                        "mt-0.5 text-lg font-black leading-none",
                        changeAmount > 0
                          ? "text-emerald-900"
                          : shortageAmount > 0
                            ? "text-amber-900"
                            : "text-sky-900",
                      )}>
                        ${(changeAmount > 0 ? changeAmount : shortageAmount > 0 ? shortageAmount : 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {!readOnly ? (
                    <Button
                      onClick={() => setConfirmOpen(true)}
                      disabled={!canPay}
                      className="h-14 w-full gap-2 rounded-2xl px-4 font-display text-base font-semibold lg:w-[280px]"
                    >
                      {paying ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <CreditCard className="h-5 w-5" />
                          Cobrar ${currentChargeTotal.toFixed(2)}
                        </>
                      )}
                    </Button>
                  ) : (
                    <div className="rounded-2xl bg-muted px-4 py-3 text-center text-xs text-muted-foreground lg:w-[280px]">
                      Esta cuenta no puede registrar cobros.
                    </div>
                  )}
                </div>


                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm font-medium",
                    canPay
                      ? "border border-green-500/20 bg-green-500/10 text-green-700"
                      : "border border-amber-500/20 bg-amber-500/10 text-amber-700",
                  )}
                >
                  {paymentStatusMessage}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>

      <Dialog
        open={cashDetailOpen && !!cashSplit}
        onOpenChange={(open) => {
          if (!open) {
            cancelCashDetail();
            return;
          }
          setCashDetailOpen(true);
        }}
      >
      <DialogContent className="flex max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] flex-col overflow-hidden p-0 sm:max-h-[94vh] sm:w-[96vw] sm:max-w-6xl">
          <DialogHeader className="border-b border-border px-4 py-2.5">
            <DialogTitle className="font-display text-lg">Monedas y billetes</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden px-3 py-2.5 sm:px-4">
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                title="Aplicado"
                value={`$${draftCashAppliedAmount.toFixed(2)}`}
                description="Lo que se usa en este cobro"
                icon={<HandCoins className="h-5 w-5" />}
                tone="sky"
              />
              <MetricCard
                title="Recibido"
                value={`$${draftTotalReceived.toFixed(2)}`}
                description="Todo lo entregado por el cliente"
                icon={<Wallet className="h-5 w-5" />}
                tone="violet"
              />
              <MetricCard
                title="Cambio"
                value={`$${draftChangeAmount.toFixed(2)}`}
                description="Lo que debe volver al cliente"
                icon={<BadgeDollarSign className="h-5 w-5" />}
                tone="emerald"
              />
            </div>

            <div className="grid h-[calc(100dvh-15rem)] min-h-0 gap-3 lg:h-[calc(94vh-152px)] lg:grid-cols-[minmax(0,1.55fr)_380px]">
              <div className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-card p-3">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 rounded-2xl border border-amber-200/70 bg-gradient-to-b from-amber-50/80 to-background p-3 shadow-sm">
                    <div className="flex items-center justify-between border-b border-amber-200/80 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                          <Coins className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">Monedas</p>
                          <p className="text-[11px] text-muted-foreground">Cambio menudo y efectivo fraccionado</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{coinDenoms.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {coinDenoms.map(renderDenominationButton)}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/80 to-background p-3 shadow-sm">
                    <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
                          <WalletCards className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">Billetes</p>
                          <p className="text-[11px] text-muted-foreground">Montos altos y pagos de valor completo</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{billDenoms.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {billDenoms.map(renderDenominationButton)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Detalle seleccionado</p>
                    <p className="text-xs text-muted-foreground">Lo recibido en efectivo</p>
                  </div>
                  {!readOnly && draftHasReceivedDenoms && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2 text-destructive"
                      onClick={() => setCashDraftReceived({})}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Limpiar
                    </Button>
                  )}
                </div>

                {draftHasReceivedDenoms && (
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <span className="text-sm font-semibold text-emerald-800">Total de items</span>
                    <span className="font-display text-lg font-bold text-emerald-700">${draftTotalReceived.toFixed(2)}</span>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {draftHasReceivedDenoms ? (
                    <div className="space-y-1">
                      {sortedDenoms
                        .filter((denomination) => (cashDraftReceived[denomination.denomination_id] || 0) > 0)
                        .map((denomination) => (
                          <div key={denomination.denomination_id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-xl border border-border px-2 py-2 text-sm sm:flex sm:items-center sm:px-3 sm:py-1.5">
                            {!readOnly && (
                              <button
                                onClick={() =>
                                  setCashDraftReceived((prev) => {
                                    const next = { ...prev };
                                    delete next[denomination.denomination_id];
                                    return next;
                                  })
                                }
                                className="flex h-8 shrink-0 items-center justify-center px-1 text-destructive transition-colors hover:text-red-700"
                                title="Quitar denominacion"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <DenominationVisual
                              label={denomination.label}
                              imageUrl={denomination.image_url}
                              className="h-8 w-8 shrink-0 rounded-lg"
                              iconClassName="h-4 w-4"
                            />
                            <span className="min-w-[58px] font-medium text-foreground">${denomination.value.toFixed(2)}</span>
                            {!readOnly && (
                              <button
                                onClick={() =>
                                  setCashDraftReceived((prev) => {
                                    const value = (prev[denomination.denomination_id] || 0) - 1;
                                    if (value <= 0) {
                                      const next = { ...prev };
                                      delete next[denomination.denomination_id];
                                      return next;
                                    }
                                    return { ...prev, [denomination.denomination_id]: value };
                                  })
                                }
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 shadow-sm transition-all hover:scale-105 hover:bg-red-100 hover:text-red-700"
                                title="Restar una unidad"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <div className="flex min-w-[58px] items-center gap-1">
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={cashDraftReceived[denomination.denomination_id] || 0}
                                onChange={(event) => setDraftDenominationQty(denomination.denomination_id, Number.parseInt(event.target.value || "0", 10))}
                                onBlur={(event) => setDraftDenominationQty(denomination.denomination_id, Number.parseInt(event.target.value || "0", 10))}
                                className="h-8 w-14 rounded-lg px-2 text-center text-sm font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                disabled={readOnly}
                              />
                            </div>
                            {!readOnly && (
                              <button
                                onClick={() => addDraftDenomination(denomination.denomination_id)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm transition-all hover:scale-105 hover:bg-emerald-100 hover:text-emerald-700"
                                title="Sumar una unidad"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <span className="col-span-full text-right font-semibold text-foreground sm:col-auto sm:text-left">
                              ${((cashDraftReceived[denomination.denomination_id] || 0) * denomination.value).toFixed(2)}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                      Selecciona monedas o billetes para ver el detalle aqui.
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="flex items-center gap-1 text-foreground">
                      <ArrowDown className="h-3.5 w-3.5 text-green-500" /> Recibido
                    </span>
                    <span className="text-foreground">${draftTotalReceived.toFixed(2)}</span>
                  </div>

                  {draftHasReceivedDenoms && draftTotalReceived < cashAppliedAmount && (
                    <p className="text-xs font-medium text-destructive">
                      Recibido insuficiente. Faltan ${(cashAppliedAmount - draftTotalReceived).toFixed(2)}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 flex shrink-0 flex-col gap-2 border-t border-border bg-background px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] sm:flex-row sm:justify-end sm:px-4">
            <Button type="button" variant="outline" onClick={cancelCashDetail} className="w-full sm:w-auto">
              Cancelar
            </Button>
            <Button type="button" onClick={acceptCashDetail} className="w-full sm:w-auto">
              Aceptar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Confirmar cobro</AlertDialogTitle>
            <AlertDialogDescription>
              Revisa como quedara aplicado el cobro antes de registrarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-muted/50 p-2.5 sm:p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total a cobrar</p>
                <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">${currentChargeTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 p-2.5 sm:p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total recibido</p>
                <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">${receivedSplitTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-primary/10 p-2.5 sm:p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cambio</p>
                <p className="mt-1 font-display text-base font-bold text-primary sm:text-xl">${changeAmount.toFixed(2)}</p>
              </div>
            </div>

            {isSpecialOrder && order ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">Resumen especial</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total real</p>
                    <p className="mt-1 font-semibold text-foreground">${order.special_real_total.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total especial</p>
                    <p className="mt-1 font-semibold text-foreground">${(order.special_total_manual ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo luego del cobro</p>
                    <p className="mt-1 font-semibold text-foreground">
                      ${Math.max(0, order.special_pending_amount - currentChargeTotal).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-border p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">Metodos utilizados</p>
              <div className="space-y-2">
                {paymentAllocationPreview.map((split) => (
                  <div key={split.id} className="grid grid-cols-1 gap-1 rounded-xl bg-muted/40 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_96px_96px] sm:gap-2">
                    <span className="truncate text-foreground">{split.methodName}</span>
                    <span className="text-right text-foreground">Recibido ${split.receivedAmount.toFixed(2)}</span>
                    <span className="text-right font-medium text-foreground">Aplica ${split.appliedAmount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {changeAmount > 0 && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">Cambio a entregar desde caja</p>
                  <p className="font-display text-xl font-bold text-emerald-700">${changeAmount.toFixed(2)}</p>
                </div>
                {changeDenomBreakdown.length > 0 ? (
                  <div className="space-y-1">
                    {changeDenomBreakdown.map((denomination) => (
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
                        <span className="font-medium text-foreground">${(denomination.qty * denomination.value).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay detalle de cambio disponible todavia.</p>
                )}
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handlePay} disabled={!canPay || paying}>
              {paying ? "Procesando..." : "Confirmar cobro"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cashOverpayConfirmOpen}
        onOpenChange={(open) => {
          setCashOverpayConfirmOpen(open);
          if (!open) {
            setPendingCashDenominationId(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Ya se cubrio el valor a pagar</AlertDialogTitle>
            <AlertDialogDescription>
              El efectivo recibido ya es igual o mayor al monto aplicado. Si agregas otra moneda o billete, se tomara como excedente para cambio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setCashOverpayConfirmOpen(false);
                setPendingCashDenominationId(null);
              }}
            >
              Descartar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCashDenominationId) {
                  commitDraftDenomination(pendingCashDenominationId);
                }
                setCashOverpayConfirmOpen(false);
                setPendingCashDenominationId(null);
              }}
            >
              Agregar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}







































