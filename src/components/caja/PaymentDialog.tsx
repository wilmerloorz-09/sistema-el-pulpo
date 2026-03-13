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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import {
  getCashPaymentMethod,
  getDefaultPaymentMethodId,
  isCashPaymentMethodName,
  type PaymentMethodOption,
} from "@/lib/paymentMethods";
import { toast } from "sonner";
import { CreditCard, Loader2, RotateCcw, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitDraft[]>([]);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!order) return;

    const nextQuantities: Record<string, number> = {};
    for (const item of order.items) {
      if (item.quantity_pending > 0) {
        nextQuantities[item.id] = item.quantity_pending;
      }
    }

    const initialMethodId = cashMethod?.id ?? defaultMethodId;
    setPayQuantities(nextQuantities);
    setPaymentSplits(initialMethodId ? [{ id: buildSplitId(), methodId: initialMethodId, amount: 0 }] : []);
    setReceived({});
  }, [order?.id, order?.items, defaultMethodId, cashMethod?.id]);

  const selectedItems = useMemo(
    () => unpaidItems.filter((item) => (payQuantities[item.id] ?? 0) > 0),
    [unpaidItems, payQuantities],
  );

  const selectedTotal = useMemo(
    () => roundMoney(selectedItems.reduce((sum, item) => sum + computeLineAmount(payQuantities[item.id] ?? 0, item.unit_price), 0)),
    [selectedItems, payQuantities],
  );

  useEffect(() => {
    setPaymentSplits((prev) => {
      const validMethods = new Set(paymentMethods.map((method) => method.id));
      const filtered = prev.filter((split) => validMethods.has(split.methodId));
      const base = filtered.length > 0 ? filtered : defaultMethodId ? [{ id: buildSplitId(), methodId: defaultMethodId, amount: 0 }] : [];

      if (base.length === 0) return base;
      if (base.length === 1) {
        return [{ ...base[0], amount: selectedTotal }];
      }

      const next = base.map((split) => ({ ...split }));
      const sumBeforeLast = roundMoney(next.slice(0, -1).reduce((sum, split) => sum + Number(split.amount || 0), 0));
      next[next.length - 1].amount = Math.max(0, roundMoney(selectedTotal - sumBeforeLast));
      return next;
    });
  }, [selectedTotal, defaultMethodId, paymentMethods]);

  const paymentMethodMap = useMemo(
    () => Object.fromEntries(paymentMethods.map((method) => [method.id, method])),
    [paymentMethods],
  );

  const cashSplit = useMemo(
    () => paymentSplits.find((split) => isCashPaymentMethodName(paymentMethodMap[split.methodId]?.name ?? "")) ?? null,
    [paymentSplits, paymentMethodMap],
  );



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
  const selectedMethodIds = useMemo(() => new Set(paymentSplits.map((split) => split.methodId)), [paymentSplits]);

  const setItemQty = (itemId: string, qty: number, maxQty: number) => {
    const normalized = Number.isFinite(qty) ? Math.floor(qty) : 0;
    setPayQuantities((prev) => ({
      ...prev,
      [itemId]: clampQty(normalized, 0, maxQty),
    }));
  };

  const fillAllPending = () => {
    const next: Record<string, number> = {};
    for (const item of unpaidItems) {
      next[item.id] = item.quantity_pending;
    }
    setPayQuantities(next);
  };

  const clearAllSelection = () => {
    const next: Record<string, number> = {};
    for (const item of unpaidItems) {
      next[item.id] = 0;
    }
    setPayQuantities(next);
  };

  const setSplitMethod = (splitId: string, methodId: string) => {
    setPaymentSplits((prev) => {
      const next = prev.map((split) => (split.id === splitId ? { ...split, methodId } : split));
      const cashRows = next.filter((split) => isCashPaymentMethodName(paymentMethodMap[split.methodId]?.name ?? ""));
      if (cashRows.length > 1) {
        toast.error("Solo puede existir una linea de Efectivo por cobro");
        return prev;
      }
      return next;
    });
  };

  const setSplitAmount = (splitId: string, amount: number) => {
    const normalized = Number.isFinite(amount) ? roundMoney(Math.max(0, amount)) : 0;
    setPaymentSplits((prev) => prev.map((split) => (split.id === splitId ? { ...split, amount: normalized } : split)));
  };

  const addSplit = () => {
    const nextMethod = paymentMethods.find((method) => !selectedMethodIds.has(method.id)) ?? paymentMethods[0];
    if (!nextMethod) return;
    setPaymentSplits((prev) => [
      ...prev,
      {
        id: buildSplitId(),
        methodId: nextMethod.id,
        amount: Math.max(0, shortageAmount),
      },
    ]);
  };

  const removeSplit = (splitId: string) => {
    setPaymentSplits((prev) => (prev.length <= 1 ? prev : prev.filter((split) => split.id !== splitId)));
  };

  const addDenom = (denominationId: string) => {
    setReceived((prev) => ({ ...prev, [denominationId]: (prev[denominationId] || 0) + 1 }));
  };

  const removeDenom = (denominationId: string) => {
    setReceived((prev) => {
      const value = (prev[denominationId] || 0) - 1;
      if (value <= 0) {
        const next = { ...prev };
        delete next[denominationId];
        return next;
      }
      return { ...prev, [denominationId]: value };
    });
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

    const cashReceivedDenoms = Object.entries(received)
      .filter(([, quantity]) => quantity > 0)
      .map(([denomination_id, qty]) => ({ denomination_id, qty }));

    const cashChangeDenoms = changeDenomBreakdown.map((denomination) => ({
      denomination_id: denomination.denomination_id,
      qty: denomination.qty,
    }));

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

  const sortedDenoms = useMemo(() => [...shiftDenoms].sort((a, b) => a.value - b.value), [shiftDenoms]);

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-xl">
            <span>
              {readOnly ? "Consulta de cobro" : "Cobrar"} {order?.order_code ?? `#${order?.order_number}`}
            </span>
            {order?.order_type === "DINE_IN" && order?.table_name && (
              <span className="text-sm font-normal text-muted-foreground">- {order.table_name}</span>
            )}
            {order?.split_code && <span className="text-sm font-normal text-muted-foreground">({order.split_code})</span>}
          </DialogTitle>
        </DialogHeader>

        {order && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
                <div className="space-y-4">
                  {readOnly && (
                    <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                      Modo consulta: puedes revisar los montos pendientes, pero no registrar pagos.
                    </div>
                  )}

                  <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Seleccion de cantidades a cobrar</p>
                        <p className="text-xs text-muted-foreground">
                          Ajusta solo las cantidades que se van a cobrar en esta operacion.
                        </p>
                      </div>
                      {!readOnly && (
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={fillAllPending}>
                            Todo pendiente
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={clearAllSelection}>
                            Limpiar
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-muted/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Items pendientes</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{unpaidItems.length}</p>
                      </div>
                      <div className="rounded-xl bg-muted/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Items seleccionados</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{selectedItems.length}</p>
                      </div>
                      <div className="rounded-xl bg-primary/10 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total a cobrar ahora</p>
                        <p className="mt-1 font-display text-2xl font-bold text-primary">${selectedTotal.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {unpaidItems.map((item) => {
                        const qtyToPay = payQuantities[item.id] ?? 0;
                        const lineSubtotal = computeLineAmount(qtyToPay, item.unit_price);

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "rounded-2xl border p-3 transition-colors",
                              qtyToPay > 0 ? "border-primary/40 bg-primary/5 shadow-sm" : "border-border bg-background",
                            )}
                          >
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-foreground">{item.description_snapshot}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Despachado: {item.quantity} - Pagado: {item.quantity_paid} - Pendiente: {item.quantity_pending}
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[420px]">
                                <div className="rounded-xl bg-muted/50 p-2">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Precio unit.</p>
                                  <p className="mt-1 text-sm font-semibold text-foreground">${item.unit_price.toFixed(2)}</p>
                                </div>
                                <div className="rounded-xl bg-muted/50 p-2">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pendiente</p>
                                  <p className="mt-1 text-sm font-semibold text-foreground">{item.quantity_pending}</p>
                                </div>
                                <div className="rounded-xl border border-border p-2">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cobrar ahora</p>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={item.quantity_pending}
                                    step={1}
                                    value={qtyToPay}
                                    onChange={(e) => setItemQty(item.id, Number(e.target.value), item.quantity_pending)}
                                    className="mt-1 h-9"
                                    disabled={readOnly}
                                  />
                                </div>
                                <div className="rounded-xl bg-muted/50 p-2">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Subtotal</p>
                                  <p className="mt-1 text-sm font-semibold text-foreground">${lineSubtotal.toFixed(2)}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

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

                  <section className="rounded-2xl border border-border bg-card p-4 shadow-sm xl:sticky xl:top-0">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Distribucion por metodo de pago</p>
                        <p className="text-xs text-muted-foreground">
                          El metodo aplica al cobro de este momento, no a cada item.
                        </p>
                      </div>
                      {!readOnly && paymentMethods.length > paymentSplits.length && (
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSplit}>
                          <Plus className="h-4 w-4" /> Agregar metodo
                        </Button>
                      )}
                    </div>


                    <div className="space-y-3">
                      {paymentSplits.map((split) => {
                        const method = paymentMethodMap[split.methodId];
                        const isCash = isCashPaymentMethodName(method?.name ?? "");
                        const methodOptions = paymentMethods.filter(
                          (option) =>
                            option.id === split.methodId ||
                            !paymentSplits.some((row) => row.id !== split.id && row.methodId === option.id),
                        );

                        return (
                          <div key={split.id} className="rounded-2xl border border-border bg-background p-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_132px_40px] md:items-end">
                              <div>
                                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Metodo</p>
                                <Select value={split.methodId} onValueChange={(value) => setSplitMethod(split.id, value)} disabled={readOnly}>
                                  <SelectTrigger className="h-10">
                                    <SelectValue placeholder="Metodo" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {methodOptions.map((option) => (
                                      <SelectItem key={option.id} value={option.id}>
                                        {option.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Monto</p>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={split.amount}
                                  onChange={(e) => setSplitAmount(split.id, Number(e.target.value))}
                                  className="h-10"
                                  disabled={readOnly}
                                />
                              </div>

                              <div className="flex justify-end">
                                {!readOnly && paymentSplits.length > 1 && (
                                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => removeSplit(split.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>

                            {isCash && split.amount > 0 && (
                              <div className="mt-3 space-y-3 rounded-2xl bg-muted/40 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">Monto recibido en efectivo</p>
                                    <p className="text-xs text-muted-foreground">
                                      Registra monedas y billetes entregados por el cliente.
                                    </p>
                                  </div>
                                  {!readOnly && hasReceivedDenoms && (
                                    <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => setReceived({})}>
                                      <RotateCcw className="h-3.5 w-3.5" /> Limpiar
                                    </Button>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 xl:grid-cols-2">
                                  {sortedDenoms.map((denomination) => {
                                    const selectedQty = received[denomination.denomination_id] || 0;

                                    return (
                                      <button
                                        key={denomination.denomination_id}
                                        onClick={() => addDenom(denomination.denomination_id)}
                                        className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                                        disabled={readOnly}
                                      >
                                        {selectedQty > 0 && (
                                          <span className="absolute right-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground shadow-sm">
                                            x{selectedQty}
                                          </span>
                                        )}
                                        <DenominationVisual
                                          label={denomination.label}
                                          imageUrl={denomination.image_url}
                                          className="h-20 w-full rounded-none border-0 bg-white"
                                          imageClassName="object-contain bg-white p-0.5"
                                          iconClassName="h-8 w-8"
                                        />
                                        <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-center">
                                            <div className="text-base font-black leading-none text-primary">${denomination.value.toFixed(2)}</div>
                                          </div>
                                      </button>
                                    );
                                  })}
                                </div>

                                {hasReceivedDenoms && (
                                  <div className="space-y-1 rounded-2xl border border-border bg-background p-3">
                                    {sortedDenoms
                                      .filter((denomination) => (received[denomination.denomination_id] || 0) > 0)
                                      .map((denomination) => (
                                        <div key={denomination.denomination_id} className="flex items-center gap-2 text-sm">
                                          {!readOnly && (
                                            <button
                                              onClick={() => removeDenom(denomination.denomination_id)}
                                              className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"
                                            >
                                              -
                                            </button>
                                          )}
                                          <DenominationVisual
                                            label={denomination.label}
                                            imageUrl={denomination.image_url}
                                            className="h-9 w-9 rounded-xl"
                                            iconClassName="h-4 w-4"
                                          />
                                          <span className="flex-1 text-foreground">
                                            {received[denomination.denomination_id]}x {denomination.label}
                                          </span>
                                          <span className="font-medium text-foreground">
                                            ${(received[denomination.denomination_id] * denomination.value).toFixed(2)}
                                          </span>
                                          {!readOnly && (
                                            <button
                                              onClick={() => addDenom(denomination.denomination_id)}
                                              className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"
                                            >
                                              +
                                            </button>
                                          )}
                                        </div>
                                      ))}

                                    <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-bold">
                                      <span className="flex items-center gap-1 text-foreground">
                                        <ArrowDown className="h-3.5 w-3.5 text-green-500" /> Recibido
                                      </span>
                                      <span className="text-foreground">${totalReceived.toFixed(2)}</span>
                                    </div>
                                  </div>
                                )}

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  <div className="rounded-xl bg-background p-3">
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Efectivo aplicado</p>
                                    <p className="mt-1 font-semibold text-foreground">${cashAppliedAmount.toFixed(2)}</p>
                                  </div>
                                  <div className="rounded-xl bg-background p-3">
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recibido</p>
                                    <p className="mt-1 font-semibold text-foreground">${totalReceived.toFixed(2)}</p>
                                  </div>
                                  <div className="rounded-xl bg-background p-3">
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estado</p>
                                    <p className={cn("mt-1 font-semibold", cannotMakeChange ? "text-destructive" : "text-foreground")}>
                                      {changeAmount > 0 ? "Cambio pendiente" : "Sin cambio"}
                                    </p>
                                  </div>
                                </div>

                                {hasReceivedDenoms && totalReceived < cashAppliedAmount && (
                                  <p className="text-center text-xs font-medium text-destructive">
                                    El monto recibido en efectivo (${totalReceived.toFixed(2)}) es menor al valor aplicado (${cashAppliedAmount.toFixed(2)}).
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl bg-muted/50 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total seleccionado</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">${selectedTotal.toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/50 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total recibido</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">${receivedSplitTotal.toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/50 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {changeAmount > 0 ? "Cambio" : shortageAmount > 0 ? "Faltante" : "Cuadre"}
                      </p>
                      <p className={cn(
                        "mt-1 text-lg font-semibold",
                        shortageAmount > 0 ? "text-destructive" : changeAmount > 0 ? "text-emerald-700" : "text-green-600",
                      )}>
                        ${(changeAmount > 0 ? changeAmount : shortageAmount > 0 ? shortageAmount : 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {!readOnly ? (
                    <Button
                      onClick={() => setConfirmOpen(true)}
                      disabled={!canPay}
                      className="h-14 w-full gap-2 rounded-2xl px-6 font-display text-base font-semibold lg:w-[280px]"
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Confirmar cobro</AlertDialogTitle>
            <AlertDialogDescription>
              Revisa como quedara aplicado el cobro antes de registrarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total a cobrar</p>
                <p className="mt-1 text-lg font-semibold text-foreground">${selectedTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total recibido</p>
                <p className="mt-1 text-lg font-semibold text-foreground">${receivedSplitTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-primary/10 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cambio</p>
                <p className="mt-1 font-display text-xl font-bold text-primary">${changeAmount.toFixed(2)}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">Metodos utilizados</p>
              <div className="space-y-2">
                {paymentAllocationPreview.map((split) => (
                  <div key={split.id} className="grid grid-cols-[minmax(0,1fr)_96px_96px] gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
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
    </Dialog>
  );
}







































