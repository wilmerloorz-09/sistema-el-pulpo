import { useEffect, useMemo, useRef, useState } from "react";
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
import { NumericInput } from "@/components/ui/numeric-input";
import { MetricCard } from "@/components/ui/metric-card";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import { getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import { computeLineAmount, distributeProportionalAmounts, roundMoney } from "@/lib/paymentQuantity";
import {
  getCashPaymentMethod,
  getDefaultPaymentMethodId,
  isCashPaymentMethodName,
  isTransferPaymentMethodName,
  normalizePaymentMethodName,
  type PaymentMethodOption,
} from "@/lib/paymentMethods";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, BadgeDollarSign, CheckCircle2, Coins, CreditCard, GlassWater, HandCoins, Loader2, Minus, Plus, Printer, RotateCcw, Soup, Trash2, UserRound, Wallet, WalletCards } from "lucide-react";
import type { PayableOrder, PreparedTransferProofSession, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import DenominationVisual from "@/components/caja/DenominationVisual";
import PaymentReceipt from "./PaymentReceipt";
import { printPaymentReceipt } from "@/lib/thermalPrint";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

interface Props {
  order: PayableOrder | null;
  paymentMethods: PaymentMethodOption[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => Promise<any> | void;
  onPrepareTransferProof: (params: {
    orderId: string;
    paymentSplits: PayOrderParams["paymentSplits"];
    tenderedSplits: PayOrderParams["tenderedSplits"];
    isSpecial?: boolean;
  }) => Promise<PreparedTransferProofSession>;
  onDiscardPreparedTransferProof: (session: PreparedTransferProofSession) => Promise<any> | void;
  getTransferProofReadiness: (paymentIds: string[]) => Promise<{ ready: boolean; uploadedCount: number; totalCount: number }>;
  paying: boolean;
  open: boolean;
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
  const normalized = sanitizeDecimalInput(value).trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyInput(value: number) {
  return roundMoney(Math.max(0, Number(value) || 0)).toFixed(2);
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
  onPrepareTransferProof,
  onDiscardPreparedTransferProof,
  getTransferProofReadiness,
  paying,
  onClose,
  open,
  readOnly = false,
}: Props) {
  const unpaidItems = useMemo(() => order?.items.filter((item) => item.quantity_pending > 0) ?? [], [order]);
  const paidItems = useMemo(() => order?.items.filter((item) => item.quantity_pending <= 0) ?? [], [order]);
  const defaultMethodId = useMemo(() => getDefaultPaymentMethodId(paymentMethods), [paymentMethods]);
  const cashMethod = useMemo(() => getCashPaymentMethod(paymentMethods), [paymentMethods]);

  const [payQuantities, setPayQuantities] = useState<Record<string, number>>({});
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitDraft[]>([]);
  const [paymentSplitInputs, setPaymentSplitInputs] = useState<Record<string, string>>({});
  const [received, setReceived] = useState<Record<string, number>>({});
  const [cashDraftReceived, setCashDraftReceived] = useState<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cashDetailOpen, setCashDetailOpen] = useState(false);
  const [cashOverpayConfirmOpen, setCashOverpayConfirmOpen] = useState(false);
  const [pendingCashDenominationId, setPendingCashDenominationId] = useState<string | null>(null);
  const [preparedTransferProofSession, setPreparedTransferProofSession] = useState<PreparedTransferProofSession | null>(null);
  const [preparedTransferProofSignature, setPreparedTransferProofSignature] = useState<string | null>(null);
  const [preparingTransferProof, setPreparingTransferProof] = useState(false);
  const [transferProofReady, setTransferProofReady] = useState(false);
  const [transferProofProgress, setTransferProofProgress] = useState<{ uploadedCount: number; totalCount: number }>({ uploadedCount: 0, totalCount: 0 });
  const activePaymentSplitInputId = useRef<string | null>(null);
  const isSpecialOrder = Boolean(order?.is_special);
  /** Para llevar y orden especial: no reducir líneas desde “a cobrar” hacia pendientes. */
  const restrictMovingBackToPending =
    order?.order_type === "TAKEOUT" || Boolean(order?.is_special);

  const [successView, setSuccessView] = useState(false);
  const [lastTransactionData, setLastTransactionData] = useState<any>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const orderItemHash = useMemo(
    () => order?.items.map((i) => `${i.id}=${i.quantity_pending}`).join("|") ?? "",
    [order?.items],
  );

  const paymentMethodsHash = useMemo(
    () => paymentMethods.map(m => m.id).join("|"),
    [paymentMethods]
  );

  useEffect(() => {
    if (!order) return;

    const nextQuantities: Record<string, number> = {};
    for (const item of order.items) {
      if (item.quantity_pending > 0) {
        nextQuantities[item.id] = item.quantity_pending;
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
    setPaymentSplits(buildInitialPaymentSplits(paymentMethods, cashMethod?.id ?? null, defaultMethodId ?? null, 0));
    setPaymentSplitInputs({});
    setReceived({});
    setCashDraftReceived({});
    setCashDetailOpen(false);
    setCashOverpayConfirmOpen(false);
    setPendingCashDenominationId(null);
    setPreparedTransferProofSession(null);
    setPreparedTransferProofSignature(null);
    setPreparingTransferProof(false);
    setTransferProofReady(false);
    setTransferProofProgress({ uploadedCount: 0, totalCount: 0 });
    setSuccessView(false);
    setLastTransactionData(null);
  }, [order?.id, orderItemHash, defaultMethodId, cashMethod?.id, paymentMethodsHash]);

  useEffect(() => {
    if (!open || !order || readOnly || paying || successView) return;

    const hasPendingBalance = order.is_special
      ? roundMoney(Math.max(0, Number(order.special_pending_amount ?? 0))) > 0.005
      : order.items.some((item) => Number(item.quantity_pending ?? 0) > 0);

    if (!hasPendingBalance) {
      onClose();
    }
  }, [open, order, readOnly, paying, successView, onClose]);

  const selectedItems = useMemo(
    () => unpaidItems.filter((item) => (selectedRows[item.id] ?? false) && (payQuantities[item.id] ?? 0) > 0),
    [unpaidItems, payQuantities, selectedRows],
  );

  const selectedProductsTotal = useMemo(
    () =>
      roundMoney(
        selectedItems.reduce(
          (sum, item) => sum + computeLineAmount(payQuantities[item.id] ?? 0, item.unit_price),
          0,
        ),
      ),
    [selectedItems, payQuantities],
  );
  const selectedContainerTotal = useMemo(
    () =>
      roundMoney(
        selectedItems.reduce((sum, item) => {
          const qty = payQuantities[item.id] ?? 0;
          return sum + (qty > 0 ? Number(item.tray_container_cost ?? 0) : 0);
        }, 0),
      ),
    [selectedItems, payQuantities],
  );
  const selectedCatalogTotal = useMemo(
    () => roundMoney(selectedProductsTotal + selectedContainerTotal),
    [selectedContainerTotal, selectedProductsTotal],
  );

  const specialPendingMoney = useMemo(
    () => roundMoney(Math.max(0, Number(order?.special_pending_amount ?? 0))),
    [order?.special_pending_amount],
  );

  /** En especial el cobro no puede superar el saldo del precio manual; las lineas siguen mostrando precio catálogo. */
  const currentChargeTotal = useMemo(() => {
    if (!isSpecialOrder) return selectedCatalogTotal;
    return roundMoney(Math.min(selectedCatalogTotal, specialPendingMoney));
  }, [isSpecialOrder, selectedCatalogTotal, specialPendingMoney]);
  const hasTrayContainerCosts = selectedContainerTotal > 0;
  const hasChargeSelection = selectedItems.length > 0;
  const selectedCount = selectedItems.length;

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

  useEffect(() => {
    setPaymentSplitInputs((prev) => {
      const next: Record<string, string> = {};

      for (const split of paymentSplits) {
        if (activePaymentSplitInputId.current === split.id && prev[split.id] !== undefined) {
          next[split.id] = prev[split.id];
          continue;
        }

        next[split.id] = formatMoneyInput(split.amount);
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const isSame =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key]);

      return isSame ? prev : next;
    });
  }, [paymentSplits]);

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
    const ordered = !cashMethod
      ? paymentMethods
      : [
      cashMethod,
      ...paymentMethods.filter((method) => method.id !== cashMethod.id),
    ];

    const seenNames = new Set<string>();
    return ordered.filter((method) => {
      const key = normalizePaymentMethodName(method.name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
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
  const hasTransferPayment = useMemo(
    () => paymentAllocationPreview.some((split) => split.appliedAmount > 0 && isTransferPaymentMethodName(split.methodName)),
    [paymentAllocationPreview],
  );
  const transferPreparationSignature = useMemo(
    () =>
      JSON.stringify(
        paymentAllocationPreview
          .filter((split) => split.appliedAmount > 0)
          .map((split) => ({
            methodId: split.methodId,
            receivedAmount: split.receivedAmount,
            appliedAmount: split.appliedAmount,
          })),
      ),
    [paymentAllocationPreview],
  );
  const cashPreview = paymentAllocationPreview.find((split) => split.isCashMethod) ?? null;
  const cashAppliedAmount = roundMoney(cashPreview?.appliedAmount ?? 0);
  const appliedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.appliedAmount, 0));
  const receivedSplitTotal = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.receivedAmount, 0));
  const shortageAmount = roundMoney(Math.max(0, currentChargeTotal - appliedSplitTotal));
  const changeAmount = roundMoney(paymentAllocationPreview.reduce((sum, split) => sum + split.overpayAmount, 0));

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
    let nextQty = clampQty(normalized, 0, maxQty);
    if (restrictMovingBackToPending) {
      const prevQty = payQuantities[itemId] ?? 0;
      if (nextQty < prevQty) nextQty = prevQty;
    }
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
    if (restrictMovingBackToPending) return;
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
    if (restrictMovingBackToPending && !checked) return;
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

  const setGroupQty = (group: typeof unpaidItems, totalQty: number) => {
    if (restrictMovingBackToPending) return;
    let remaining = totalQty;
    setPayQuantities((prev) => {
      const next = { ...prev };
      for (const item of group) {
        const take = Math.min(remaining, item.quantity_pending);
        next[item.id] = take;
        remaining -= take;
      }
      return next;
    });
    setSelectedRows((prev) => {
      const next = { ...prev };
      for (const item of group) {
        next[item.id] = (payQuantities[item.id] ?? 0) > 0 || (totalQty > 0 && group.some(i => i.id === item.id));
      }
      // Re-evaluate selected status for the whole group
      let groupRemaining = totalQty;
      for (const item of group) {
        const take = Math.min(groupRemaining, item.quantity_pending);
        next[item.id] = take > 0;
        groupRemaining -= take;
      }
      return next;
    });
  };

  const moveOneGroupToCharge = (group: typeof unpaidItems) => {
    const target = group.find(item => (item.quantity_pending - (payQuantities[item.id] ?? 0)) > 0);
    if (target) {
      moveOneToCharge(target.id, target.quantity_pending);
    }
  };

  const moveAllGroupToCharge = (group: typeof unpaidItems) => {
    for (const item of group) {
      moveAllToCharge(item.id, item.quantity_pending);
    }
  };

  const moveOneGroupBackToPending = (group: typeof unpaidItems) => {
    const target = [...group].reverse().find(item => (payQuantities[item.id] ?? 0) > 0);
    if (target) {
      moveOneBackToPending(target.id, target.quantity_pending);
    }
  };

  const moveAllGroupBackToPending = (group: typeof unpaidItems) => {
    for (const item of group) {
      moveAllBackToPending(item.id, item.quantity_pending);
    }
  };

  const toggleGroupSelection = (group: typeof unpaidItems, checked: boolean) => {
    if (restrictMovingBackToPending && !checked) return;
    setPayQuantities((prev) => {
      const next = { ...prev };
      for (const item of group) {
        next[item.id] = checked ? item.quantity_pending : 0;
      }
      return next;
    });
    setSelectedRows((prev) => {
      const next = { ...prev };
      for (const item of group) {
        next[item.id] = checked;
      }
      return next;
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
    () => groupedUnpaidItems
      .map((group) => {
        const qty = group.reduce((sum, item) => sum + Math.max(0, item.quantity_pending - (payQuantities[item.id] ?? 0)), 0);
        if (qty <= 0) return null;
        return {
          ...group[0],
          quantity_available_now: qty,
          groupItems: group,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    [groupedUnpaidItems, payQuantities],
  );

  const selectedItemsForNow = useMemo(
    () => groupedUnpaidItems
      .map((group) => {
        const qty = group.reduce((sum, item) => sum + (payQuantities[item.id] ?? 0), 0);
        if (qty <= 0) return null;
        return {
          ...group[0],
          quantity_to_charge_now: qty,
          groupItems: group,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    [groupedUnpaidItems, payQuantities],
  );

  const groupedPaidItems = useMemo(() => {
    const groups: Record<string, typeof paidItems> = {};
    for (const item of paidItems) {
      const key = `${item.description_snapshot}_${item.unit_price}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.values(groups).map(group => ({
      ...group[0],
      quantity: group.reduce((sum, item) => sum + item.quantity, 0),
      quantity_paid: group.reduce((sum, item) => sum + item.quantity_paid, 0),
      quantity_pending: group.reduce((sum, item) => sum + item.quantity_pending, 0),
      total: group.reduce((sum, item) => sum + item.total, 0),
      groupItems: group
    }));
  }, [paidItems]);

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

  const handlePay = async () => {
    if (!order || readOnly) return;
    if (!hasChargeSelection) return;
    if (paymentMethods.length === 0) {
      toast.error("No hay metodos de pago activos configurados");
      return;
    }

    const catalogWeights = selectedItems.map((item) => {
      const quantity = payQuantities[item.id] ?? 0;
      return roundMoney(
        computeLineAmount(quantity, item.unit_price) +
          (quantity > 0 ? Number(item.tray_container_cost ?? 0) : 0),
      );
    });

    const chargeTotalRounded = roundMoney(currentChargeTotal);
    const catalogSum = roundMoney(catalogWeights.reduce((s, w) => s + w, 0));
    const lineChargeAmounts =
      isSpecialOrder && catalogSum > chargeTotalRounded + 0.01
        ? distributeProportionalAmounts(catalogWeights, chargeTotalRounded)
        : catalogWeights;

    const itemSelections = selectedItems.map((item, idx) => {
      const quantity = payQuantities[item.id] ?? 0;
      return {
        itemId: item.id,
        quantity,
        unitPrice: item.unit_price,
        amount: lineChargeAmounts[idx] ?? 0,
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

    if (shortageAmount > 0.005) {
      toast.error("El total recibido es menor al total a cobrar");
      return;
    }

    if (cashSplit && cashAppliedAmount > 0) {
      if (!hasReceivedDenoms) {
        toast.error("Efectivo requiere registrar el monto recibido por denominaciones");
        return;
      }
      if (totalReceived + 0.005 < cashAppliedAmount) {
        toast.error("El monto recibido en efectivo es menor al valor aplicado en efectivo");
        return;
      }
    }

    const cashReceivedDenoms = cashSplit
      ? Object.entries(received)
          .filter(([, quantity]) => quantity > 0)
          .map(([denomination_id, qty]) => ({ denomination_id, qty }))
      : [];

    const cashChangeDenoms = changeDenomBreakdown.map((denomination) => ({
      denomination_id: denomination.denomination_id,
      qty: denomination.qty,
    }));
    const willSettleOrder = isSpecialOrder
      ? roundMoney(Math.max(0, Number(order.special_pending_amount ?? 0) - currentChargeTotal)) <= 0.005
      : unpaidItems.every((item) =>
          Number(payQuantities[item.id] ?? 0) + 0.0001 >= Number(item.quantity_pending ?? 0),
        );

    setConfirmOpen(false);
    
    try {
      // Capturar datos para el recibo antes de realizar el pago
      const receiptItemsMap = new Map<string, { description: string; quantity: number; unitPrice: number; amount: number }>();
      
      for (const sel of itemSelections) {
        const originalItem = order.items.find((i) => i.id === sel.itemId);
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

      const transactionPayments = paymentAllocationPreview
        .filter((sp) => sp.appliedAmount > 0)
        .map((sp) => ({
          methodName: sp.methodName,
          appliedAmount: sp.appliedAmount,
        }));

      const receiptData = {
        orderNumber: getOrderRef(order.order_code, order.order_number),
        tableName: order.table_name,
        orderType: order.order_type,
        isSpecial: isSpecialOrder,
        isTrayOrder: order.is_tray_order,
        items: transactionItems,
        payments: transactionPayments,
        totalAmount: currentChargeTotal,
        totalReceived: roundMoney(receivedSplitTotal),
        changeAmount: changeAmount,
        createdAt: new Date().toISOString(),
      };

        const payPromise = onPay({
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
          preparedTransferProofSession,
        });

        if (payPromise && typeof (payPromise as any).then === "function") {
          await payPromise;
        }

        setPreparedTransferProofSession(null);
        setTransferProofReady(false);
        setTransferProofProgress({ uploadedCount: 0, totalCount: 0 });
        if (willSettleOrder) {
          setLastTransactionData(receiptData);
          setSuccessView(false);
          onClose();
          return;
        }
        setLastTransactionData(receiptData);
        setSuccessView(true);
    } catch (err) {
      console.error("Payment failed", err);
    }
  };

  const canPay =
      !readOnly &&
      hasChargeSelection &&
    paymentMethods.length > 0 &&
    paymentSplits.some((split) => split.amount > 0) &&
    !paying &&
      shortageAmount <= 0.005 &&
      (!cashSplit || (cashAppliedAmount <= 0 || (hasReceivedDenoms && totalReceived + 0.005 >= cashAppliedAmount)));
  const canConfirmPayment = canPay;

  useEffect(() => {
    if (!confirmOpen || !preparedTransferProofSession || !hasTransferPayment) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const readiness = await getTransferProofReadiness(preparedTransferProofSession.paymentIds);
        if (cancelled) return;
        setTransferProofReady(readiness.ready);
        setTransferProofProgress({
          uploadedCount: readiness.uploadedCount,
          totalCount: readiness.totalCount,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Transfer proof readiness failed", error);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [confirmOpen, preparedTransferProofSession, hasTransferPayment, getTransferProofReadiness]);

  const discardPreparedTransferIfNeeded = async () => {
    if (!preparedTransferProofSession) return;
    try {
      await onDiscardPreparedTransferProof(preparedTransferProofSession);
    } catch (error) {
      console.error("Discard prepared transfer proof failed", error);
    } finally {
      setPreparedTransferProofSession(null);
      setPreparedTransferProofSignature(null);
      setTransferProofReady(false);
      setTransferProofProgress({ uploadedCount: 0, totalCount: 0 });
    }
  };

  useEffect(() => {
    if (!preparedTransferProofSession) return;
    if (preparedTransferProofSignature === transferPreparationSignature) return;
    void discardPreparedTransferIfNeeded();
  }, [preparedTransferProofSession, preparedTransferProofSignature, transferPreparationSignature]);

  const handleDialogClose = () => {
    void discardPreparedTransferIfNeeded();
    onClose();
  };

  const handleOpenConfirm = async () => {
    if (!canPay) return;
    setConfirmOpen(true);
  };

  const paymentStatusMessage = useMemo(() => {
    if (readOnly) return "Modo consulta activo";
    if (!hasChargeSelection) return "Selecciona al menos una cantidad para cobrar";
    if (paymentMethods.length === 0) return "No hay metodos de pago activos";
    if (!paymentSplits.some((split) => split.amount > 0)) return "Ingresa al menos un monto de pago";
    if (shortageAmount > 0.005) return `Faltan $${shortageAmount.toFixed(2)} por recibir`;
    if (cashSplit && cashAppliedAmount > 0 && !hasReceivedDenoms) return "Registra el monto recibido en efectivo";
    if (cashSplit && cashAppliedAmount > 0 && totalReceived + 0.005 < cashAppliedAmount) {
      return `Efectivo recibido insuficiente: faltan $${(cashAppliedAmount - totalReceived).toFixed(2)}`;
    }
    if (changeAmount > 0 && cannotMakeChange) return "No hay cambio exacto disponible en caja";
    if (paying) return "Procesando cobro...";
    if (changeAmount > 0) return `Listo para confirmar. Se entregaran $${changeAmount.toFixed(2)} de cambio`;
    return "Cobro listo para confirmar";
  }, [
    readOnly,
    hasChargeSelection,
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
    let shouldAutoConfirm = false;

    if (cashSplit) {
      const nextAmount = roundMoney(
        shiftDenoms.reduce(
          (sum, denomination) => sum + (cashDraftReceived[denomination.denomination_id] || 0) * denomination.value,
          0,
        ),
      );
      setSplitAmount(cashSplit.id, nextAmount);

      if (draftCashAppliedAmount > 0 && nextAmount + 0.001 >= draftCashAppliedAmount) {
        shouldAutoConfirm = true;
      }
    }
    
    setCashDetailOpen(false);
    
    if (shouldAutoConfirm) {
      setTimeout(() => setConfirmOpen(true), 150);
    }
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
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto bg-[#fffdf8] px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
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
                  <p className="text-xs text-slate-500">
                    {restrictMovingBackToPending
                      ? "Todo el pedido esta en la columna derecha listo para cobrar."
                      : "Mueve desde aqui lo que vas a cobrar ahora."}
                  </p>
                </div>
                <div className="w-full sm:w-auto">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-amber-700">Total pendiente</p>
                    <p className="text-base font-semibold text-amber-900">${pendingAmountForNow.toFixed(2)}</p>
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto"
                    onClick={fillAllPending}
                    disabled={pendingItemsForNow.length === 0}
                  >
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
                        <div className="scrollbar-none max-h-[240px] space-y-1.5 overflow-y-auto md:max-h-[320px]">
                          {pendingItemsForNow.map((item) => {
                            const isBulkItem = item.tray_item_type === "C";
                            const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                            return (
                      <div key={groupKey} className="grid grid-cols-[44px_minmax(0,1fr)_64px_78px_78px] items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50/50 px-2 py-2 sm:grid-cols-[52px_minmax(0,1fr)_72px_92px_86px] sm:gap-2.5 sm:px-2.5 sm:py-2.5">
                        <span className="text-center text-sm font-semibold text-slate-900">{isBulkItem ? "AG" : item.quantity_available_now}</span>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} />
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                            <span className="block text-[11px] text-slate-500 sm:hidden">
                              {isBulkItem ? `$${item.unit_price.toFixed(2)}` : `$${item.unit_price.toFixed(2)} c/u`}
                            </span>
                          </div>
                        </div>
                        <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unit_price.toFixed(2)}</span>
                        <span className="text-right text-sm font-semibold text-slate-900">${computeLineAmount(item.quantity_available_now, item.unit_price).toFixed(2)}</span>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveOneGroupToCharge(item.groupItems)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => moveAllGroupToCharge(item.groupItems)}
                            className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
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

            <section className="min-h-[260px] rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)] md:min-h-[300px]">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-950">Items a cobrar ahora</h3>
                  <p className="text-xs text-slate-500">Esto es lo que se registra en esta operacion.</p>
                </div>
                <div className="w-full sm:w-auto">
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-center sm:min-w-[148px]">
                    {isSpecialOrder && selectedCatalogTotal > currentChargeTotal + 0.005 ? (
                      <>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-orange-700">Precio especial</p>
                        <p className="font-display text-2xl font-black tabular-nums leading-tight text-orange-950">
                          ${currentChargeTotal.toFixed(2)}
                        </p>
                        <p className="mt-2 border-t border-orange-200/70 pt-2 text-[11px] leading-tight text-orange-700/85">
                          Subtotal catálogo{" "}
                          <span className="font-semibold text-orange-900">${selectedCatalogTotal.toFixed(2)}</span>
                        </p>
                      </>
                    ) : isSpecialOrder ? (
                      <>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-orange-700">Total a cobrar</p>
                        <p className="font-display text-2xl font-black tabular-nums leading-tight text-orange-950">
                          ${currentChargeTotal.toFixed(2)}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-orange-700">Total seleccionado</p>
                        <p className="text-base font-semibold tabular-nums text-orange-900">
                          ${selectedAmountForNow.toFixed(2)}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {!readOnly && !restrictMovingBackToPending && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto" onClick={clearAllSelection}>
                    <RotateCcw className="h-4 w-4" />
                    Vaciar
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <div className="hidden grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:grid md:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] md:gap-3 md:px-3 md:text-[11px]">
                  <span>{restrictMovingBackToPending ? "" : "Mover"}</span>
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
                  <div className="scrollbar-none max-h-[240px] space-y-1.5 overflow-y-auto md:max-h-[320px]">
                    {selectedItemsForNow.map((item) => {
                      const isBulkItem = item.tray_item_type === "C";
                      const groupKey = `${item.description_snapshot}_${item.unit_price}`;
                      return (
                      <div key={groupKey} className="grid grid-cols-[78px_44px_minmax(0,1fr)_64px_78px] items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/40 px-2 py-2 sm:grid-cols-[86px_52px_minmax(0,1fr)_72px_82px] sm:gap-2.5 sm:px-2.5 sm:py-2.5">
                        <div className="flex justify-start gap-2">
                          {restrictMovingBackToPending ? (
                            <div className="h-8 w-[72px] shrink-0 sm:w-[78px]" aria-hidden />
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveAllGroupBackToPending(item.groupItems)}
                                className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                &lt;&lt;
                              </button>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => moveOneGroupBackToPending(item.groupItems)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <ArrowLeft className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                        <span className="text-center text-sm font-semibold text-slate-900">{isBulkItem ? "AG" : item.quantity_to_charge_now}</span>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProductAvatar description={item.description_snapshot} imageUrl={item.image_url} tone="selected" />
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{item.description_snapshot}</span>
                            <span className="block text-[11px] text-slate-500 sm:hidden">
                              {isBulkItem ? `$${item.unit_price.toFixed(2)}` : `$${item.unit_price.toFixed(2)} c/u`}
                            </span>
                          </div>
                        </div>
                        <span className="hidden text-right text-sm font-semibold text-slate-900 sm:block">${item.unit_price.toFixed(2)}</span>
                        <span className="text-right text-sm font-semibold text-slate-900">${computeLineAmount(item.quantity_to_charge_now, item.unit_price).toFixed(2)}</span>
                      </div>
                      );
                    })}
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
              <div className="flex flex-col gap-3 md:gap-3 xl:flex xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
                {orderedPaymentMethods.map((method) => {
                  const split = paymentSplits.find((row) => row.methodId === method.id) ?? null;
                  const isSelected = !!split;
                  const isCash = isCashPaymentMethodName(method.name);

                  return (
                    <div
                      key={method.id}
                      className={cn(
                        "flex items-center gap-2 sm:gap-3",
                        isCash ? "w-full xl:w-[420px]" : "w-full xl:w-[280px]",
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
                        value={split ? (paymentSplitInputs[split.id] ?? formatMoneyInput(split.amount)) : formatMoneyInput(0)}
                        onChange={(e) => {
                          if (!split) return;
                          const rawValue = sanitizeDecimalInput(e.target.value);
                          setPaymentSplitInputs((prev) => ({ ...prev, [split.id]: rawValue }));
                          setSplitAmount(split.id, parseMoneyInput(rawValue));
                        }}
                        onFocus={(e) => {
                          if (!split) return;
                          activePaymentSplitInputId.current = split.id;
                          window.setTimeout(() => e.currentTarget.select(), 0);
                        }}
                        onBlur={() => {
                          if (!split) return;
                          activePaymentSplitInputId.current = null;
                          setPaymentSplitInputs((prev) => ({
                            ...prev,
                            [split.id]: formatMoneyInput(split.amount),
                          }));
                        }}
                        className="h-10 min-w-[112px] flex-1 rounded-2xl border-stone-200 bg-white sm:w-[126px] sm:flex-none"
                        readOnly={isCash}
                        disabled={readOnly || !isSelected || isCash}
                      />

                      {isCash && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 whitespace-nowrap rounded-full border-stone-200 bg-white px-4 text-slate-700"
                          onClick={() => openCashDetail(method.id, isSelected)}
                          disabled={!isSelected || selectedItemsForNow.length === 0}
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
                onClick={() => void handleOpenConfirm()}
                disabled={!canPay || preparingTransferProof}
                className="h-12 w-full rounded-full border-0 bg-gradient-to-r from-orange-500 to-amber-400 px-6 text-base font-semibold text-white shadow-[0_18px_36px_-24px_rgba(249,115,22,0.55)] hover:translate-y-0 hover:brightness-105 lg:mt-0 lg:w-[250px]"
              >
                {paying || preparingTransferProof ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
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
                {isSpecialOrder ? "Total a cobrar" : "Total seleccionado"}:{" "}
                <span className="font-semibold text-slate-950">${currentChargeTotal.toFixed(2)}</span>
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
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
      {lastTransactionData && (
        <PaymentReceipt
          ref={receiptRef}
          orderNumber={lastTransactionData.orderNumber}
          tableName={lastTransactionData.tableName}
          orderType={lastTransactionData.orderType}
          isSpecial={lastTransactionData.isSpecial}
          isTrayOrder={lastTransactionData.isTrayOrder}
          items={lastTransactionData.items}
          payments={lastTransactionData.payments}
          totalAmount={lastTransactionData.totalAmount}
          totalReceived={lastTransactionData.totalReceived}
          changeAmount={lastTransactionData.changeAmount}
          createdAt={lastTransactionData.createdAt}
        />
      )}
      <DialogContent 
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className="flex max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] flex-col overflow-hidden bg-white p-0 sm:max-h-[94vh] sm:w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-1.5rem)] lg:max-w-[1500px]"
      >
        {successView ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-in fade-in zoom-in duration-300 no-print">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-green-600 shadow-sm">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <h2 className="mb-2 text-2xl font-black text-slate-900">¡Cobro realizado con éxito!</h2>
            <p className="mb-8 max-w-sm text-slate-500">
              La transacción ha sido registrada correctamente. ¿Deseas imprimir el comprobante?
            </p>

            <div className="flex flex-col gap-3 w-full max-w-xs">
              <Button
                variant="outline"
                className="h-12 gap-2 rounded-2xl font-bold shadow-sm border-2 hover:bg-slate-50"
                onClick={() => {
                  if (!lastTransactionData) {
                    window.print();
                    return;
                  }
                  void printPaymentReceipt(lastTransactionData).then((result) => {
                    if (result.mode === "html" && result.error) {
                      toast.warning(
                        "Impresion HTML (puente ESC/POS no disponible). Ejecute: node scripts/thermal-print-bridge.mjs",
                      );
                    }
                  });
                }}
              >
                <Printer className="h-5 w-5" />
                Imprimir Comprobante
              </Button>
              <Button
                className="h-12 gap-2 rounded-2xl font-bold shadow-md"
                  onClick={handleDialogClose}
              >
                Finalizar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0 border-b border-border bg-white px-4 py-3 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-lg sm:text-xl">
            <span className="min-w-0">
              {readOnly ? "Consulta de cobro" : "Cobrar"} {order ? getOrderRef(order.order_code, order.order_number) : ""}
            </span>
            {order && (
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                - {getCajaOrderOriginLabel({
                  orderType: order.order_type,
                  tableName: order.table_name,
                  splitCode: order.split_code,
                  isSpecial: order.is_special,
                  isTrayOrder: order.is_tray_order,
                })}
              </span>
            )}
          </DialogTitle>
          <div className="mt-1 text-xs text-slate-500 sm:text-sm">
            {order?.created_by_name && (
              <span className="mb-1 flex items-center gap-1.5 font-semibold text-slate-600">
                <UserRound className="h-3.5 w-3.5" />
                {order.created_by_name}
              </span>
            )}
            {isSpecialOrder
              ? "Misma pantalla que mesa y para llevar: elige lineas y cantidades a cobrar. Los items muestran precio real; el total a cobrar respeta el saldo pendiente del precio especial (no puedes cobrar mas que ese saldo)."
              : restrictMovingBackToPending
                ? "Todo el saldo pendiente aparece listo para cobrar. En para llevar no puedes devolver lineas a pendientes."
                : "Por defecto todo esta listo para cobrar. Usa las columnas si necesitas un cobro parcial."}
          </div>
        </DialogHeader>

        {order ? renderModernStandardContent(order) : null}
        </>
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
      <DialogContent 
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className="flex max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] flex-col overflow-hidden p-0 sm:max-h-[94vh] sm:w-[96vw] sm:max-w-6xl"
      >
          <DialogHeader className="border-b border-border px-4 py-2.5">
            <DialogTitle className="font-display text-lg">Monedas y billetes</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden px-3 py-2.5 sm:px-4 flex flex-col">
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 shrink-0">
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

            <div className="flex-1 min-h-0 overflow-y-auto">
              {!shiftDenoms || shiftDenoms.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center min-h-[300px]">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                    <AlertTriangle className="h-8 w-8" />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-slate-900">Caja no inicializada</h3>
                  <p className="max-w-xs text-sm text-slate-500">
                    No se han configurado las denominaciones para este turno. Por favor, asegúrate de que la caja esté abierta correctamente en el módulo de Caja.
                  </p>
                </div>
              ) : (
                <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1.55fr)_380px]">
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
                                  <NumericInput
                                    min={0}
                                    value={cashDraftReceived[denomination.denomination_id] || 0}
                                    onValueChange={(value) => setDraftDenominationQty(denomination.denomination_id, value)}
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
              )}
            </div>

            <div className="sticky bottom-0 flex shrink-0 flex-col gap-2 border-t border-border bg-background px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] sm:flex-row sm:justify-end sm:px-4 mt-auto">
              <Button type="button" variant="outline" onClick={cancelCashDetail} className="w-full sm:w-auto">
                Cancelar
              </Button>
              <Button type="button" onClick={acceptCashDetail} className="w-full sm:w-auto">
                Aceptar
              </Button>
            </div>
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
            {/* Transfer proof status hidden as per user request */}
            {/* 
            {hasTransferPayment && (
              <div
                className={cn(
                  "rounded-2xl border p-3 text-sm",
                  transferProofReady
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800",
                )}
              >
                {transferProofReady
                  ? "Foto de transferencia recibida. Ya puedes confirmar el cobro."
                  : `Esperando comprobante de transferencia subido (${transferProofProgress.uploadedCount}/${transferProofProgress.totalCount || preparedTransferProofSession?.paymentIds.length || 0}).`}
              </div>
            )}
            */}

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

            {hasTrayContainerCosts && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-3">
                <div className="flex items-center justify-between text-sm text-slate-700">
                  <span>Subtotal productos</span>
                  <span>${selectedProductsTotal.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm font-medium text-orange-700">
                  <span>Costo tarrinas</span>
                  <span>+ ${selectedContainerTotal.toFixed(2)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-orange-200 pt-2 text-sm font-semibold text-slate-950">
                  <span>Total</span>
                  <span>${currentChargeTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

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
            <AlertDialogAction onClick={handlePay} disabled={!canConfirmPayment || paying}>
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
    </>
  );
}






































