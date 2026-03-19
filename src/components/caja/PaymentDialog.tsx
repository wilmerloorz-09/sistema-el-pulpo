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
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import {
  getCashPaymentMethod,
  getDefaultPaymentMethodId,
  isCashPaymentMethodName,
  type PaymentMethodOption,
} from "@/lib/paymentMethods";
import { toast } from "sonner";
import { ArrowDown, CreditCard, Loader2, RotateCcw, Trash2, Coins, WalletCards, Minus, Plus, HandCoins, Wallet, BadgeDollarSign, Clock3 } from "lucide-react";
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cashDetailOpen, setCashDetailOpen] = useState(false);
  const [cashOverpayConfirmOpen, setCashOverpayConfirmOpen] = useState(false);
  const [pendingCashDenominationId, setPendingCashDenominationId] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;

    const nextQuantities: Record<string, number> = {};
    let initialTotal = 0;
    for (const item of order.items) {
      if (item.quantity_pending > 0) {
        nextQuantities[item.id] = item.quantity_pending;
        initialTotal = roundMoney(initialTotal + computeLineAmount(item.quantity_pending, item.unit_price));
      }
    }

    setPayQuantities(nextQuantities);
    setSelectedRows(
      Object.fromEntries(
        order.items
          .filter((item) => item.quantity_pending > 0)
          .map((item) => [item.id, true]),
      ),
    );
    setPaymentSplits(buildInitialPaymentSplits(paymentMethods, cashMethod?.id ?? null, defaultMethodId ?? null, initialTotal));
    setReceived({});
    setCashDraftReceived({});
    setCashDetailOpen(false);
    setCashOverpayConfirmOpen(false);
    setPendingCashDenominationId(null);
  }, [order?.id, order?.items, defaultMethodId, cashMethod?.id, paymentMethods]);

  const selectedItems = useMemo(
    () => unpaidItems.filter((item) => (selectedRows[item.id] ?? false) && (payQuantities[item.id] ?? 0) > 0),
    [unpaidItems, payQuantities, selectedRows],
  );

  const selectedTotal = useMemo(
    () => roundMoney(selectedItems.reduce((sum, item) => sum + computeLineAmount(payQuantities[item.id] ?? 0, item.unit_price), 0)),
    [selectedItems, payQuantities],
  );

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
        return [{ ...base[0], amount: isCashOnly ? 0 : selectedTotal }];
      }

      const next = base.map((split) => ({ ...split }));
      const sumBeforeLast = roundMoney(next.slice(0, -1).reduce((sum, split) => sum + Number(split.amount || 0), 0));
      next[next.length - 1].amount = Math.max(0, roundMoney(selectedTotal - sumBeforeLast));
      return next;
    });
  }, [selectedTotal, defaultMethodId, paymentMethods, paymentMethodMap]);

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
    let remainingToApply = selectedTotal;

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
  }, [paymentSplits, paymentMethodMap, selectedTotal, hasReceivedDenoms, totalReceived]);
  const cashPreview = paymentAllocationPreview.find((split) => split.isCashMethod) ?? null;
  const cashAppliedAmount = roundMoney(cashPreview?.appliedAmount ?? 0);
  const appliedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.appliedAmount, 0));
  const receivedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.receivedAmount, 0));
  const shortageAmount = roundMoney(Math.max(0, selectedTotal - appliedSplitTotal));
  const changeAmount = roundMoney(Math.max(0, receivedSplitTotal - selectedTotal));

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
            amount: prev.length === 0 ? selectedTotal : Math.max(0, shortageAmount),
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
    if (selectedItems.length === 0) return;
    if (paymentMethods.length === 0) {
      toast.error("No hay metodos de pago activos configurados");
      return;
    }

    const itemSelections = selectedItems.map((item) => {
      const quantity = payQuantities[item.id] ?? 0;
      const amount = computeLineAmount(quantity, item.unit_price);
      return {
        itemId: item.id,
        quantity,
        unitPrice: item.unit_price,
        amount,
      };
    });

    if (itemSelections.some((item) => item.quantity <= 0)) {
      toast.error("Debes seleccionar al menos una cantidad valida para cobrar");
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
      receivedTotal: roundMoney(receivedSplitTotal),
      totalAmount: roundMoney(selectedTotal),
      cashReceivedDenoms,
      cashChangeDenoms,
    });
  };

  const canPay =
    !readOnly &&
    selectedItems.length > 0 &&
    paymentMethods.length > 0 &&
    paymentSplits.some((split) => split.amount > 0) &&
    !paying &&
    shortageAmount <= 0.01 &&
    (!cashSplit || (cashAppliedAmount <= 0 || (hasReceivedDenoms && totalReceived + 0.001 >= cashAppliedAmount))) &&
    !(changeAmount > 0 && cannotMakeChange);

  const paymentStatusMessage = useMemo(() => {
    if (readOnly) return "Modo consulta activo";
    if (selectedItems.length === 0) return "Selecciona al menos una cantidad para cobrar";
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
    selectedItems.length,
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
  const draftCashAppliedAmount = roundMoney(Math.max(0, selectedTotal - nonCashAppliedAmount));
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

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-0.75rem)] flex-col overflow-hidden bg-white p-0 sm:max-h-[92vh] sm:max-w-7xl">
        <DialogHeader className="shrink-0 border-b border-border bg-white px-4 py-3 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-xl">
            <span>
              {readOnly ? "Consulta de cobro" : "Cobrar"} {order?.order_code ?? `#${order?.order_number}`}
            </span>
            {order?.order_type === "DINE_IN" && order?.table_name && (
              <span className="text-lg font-semibold text-muted-foreground">- {order.table_name}</span>
            )}
            {order?.split_code && <span className="text-sm font-normal text-muted-foreground">({order.split_code})</span>}
          </DialogTitle>
        </DialogHeader>

        {order && (
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
                        <p className="text-sm font-semibold text-foreground">Seleccion de cantidades a cobrar</p>
                        <p className="text-xs text-muted-foreground">
                          Ajusta solo las cantidades que se van a cobrar en esta operacion.
                        </p>
                      </div>
                      {!readOnly && (
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
                            <p className="text-[10px] uppercase tracking-wide text-sky-700">Items pendientes</p>
                            <p className="mt-0.5 text-lg font-black leading-none text-sky-900">{unpaidItems.length}</p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-sky-600 shadow-sm">
                            <Clock3 className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-violet-700">Seleccionados</p>
                            <p className="mt-0.5 text-lg font-black leading-none text-violet-900">{selectedItems.length}</p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-violet-600 shadow-sm">
                            <CreditCard className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-emerald-700">Total actual</p>
                            <p className="mt-0.5 text-lg font-black leading-none text-emerald-900">${selectedTotal.toFixed(2)}</p>
                          </div>
                          <div className="rounded-lg bg-white p-1 text-emerald-600 shadow-sm">
                            <BadgeDollarSign className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 max-h-[46dvh] overflow-y-auto pr-1 sm:max-h-[48vh]">
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
                      <p className="text-[10px] uppercase tracking-wide text-sky-700">Total seleccionado</p>
                      <p className="mt-0.5 text-lg font-black leading-none text-sky-900">${selectedTotal.toFixed(2)}</p>
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
                          Cobrar ${selectedTotal.toFixed(2)}
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
        )}
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
                <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">${selectedTotal.toFixed(2)}</p>
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







































