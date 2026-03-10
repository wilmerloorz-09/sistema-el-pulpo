import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { computeLineAmount } from "@/lib/paymentQuantity";
import { getDefaultPaymentMethodId, type PaymentMethodOption } from "@/lib/paymentMethods";
import { toast } from "sonner";
import { CreditCard, Loader2, RotateCcw, ArrowDown, ArrowUp } from "lucide-react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";

interface Props {
  order: PayableOrder | null;
  paymentMethods: PaymentMethodOption[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => void;
  paying: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

function clampQty(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

  const [payQuantities, setPayQuantities] = useState<Record<string, number>>({});
  const [itemMethodIds, setItemMethodIds] = useState<Record<string, string>>({});
  const [received, setReceived] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!order) return;

    const nextQuantities: Record<string, number> = {};
    const nextMethods: Record<string, string> = {};

    for (const item of order.items) {
      if (item.quantity_pending > 0) {
        nextQuantities[item.id] = item.quantity_pending;
        nextMethods[item.id] = defaultMethodId;
      }
    }

    setPayQuantities(nextQuantities);
    setItemMethodIds(nextMethods);
    setReceived({});
  }, [order?.id, order?.items, defaultMethodId]);

  const selectedItems = useMemo(
    () => unpaidItems.filter((item) => (payQuantities[item.id] ?? 0) > 0),
    [unpaidItems, payQuantities],
  );

  const selectedTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + computeLineAmount(payQuantities[item.id] ?? 0, item.unit_price), 0),
    [selectedItems, payQuantities],
  );

  const totalReceived = useMemo(
    () => shiftDenoms.reduce((sum, denomination) => sum + (received[denomination.denomination_id] || 0) * denomination.value, 0),
    [received, shiftDenoms],
  );

  const hasReceivedDenoms = Object.values(received).some((quantity) => quantity > 0);
  const changeAmount = hasReceivedDenoms ? Math.round(Math.max(0, totalReceived - selectedTotal) * 100) / 100 : 0;

  const changeDenomBreakdown = useMemo(() => {
    if (changeAmount <= 0) return [];

    const sorted = [...shiftDenoms].filter((denomination) => denomination.value > 0).sort((a, b) => b.value - a.value);
    const result: { denomination_id: string; qty: number; value: number; label: string }[] = [];
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
        });
        remaining = Math.round((remaining - qty * denomination.value) * 100) / 100;
      }
    }

    return result;
  }, [changeAmount, shiftDenoms, received]);

  const changeGiven = changeDenomBreakdown.reduce((sum, denomination) => sum + denomination.qty * denomination.value, 0);
  const cannotMakeChange = changeAmount > 0 && Math.abs(changeGiven - changeAmount) > 0.001;
  const missingMethodCount = useMemo(
    () => selectedItems.filter((item) => !itemMethodIds[item.id]).length,
    [selectedItems, itemMethodIds],
  );

  const setItemQty = (itemId: string, qty: number, maxQty: number) => {
    const normalized = Number.isFinite(qty) ? Math.floor(qty) : 0;
    setPayQuantities((prev) => ({
      ...prev,
      [itemId]: clampQty(normalized, 0, maxQty),
    }));

    setItemMethodIds((prev) => ({
      ...prev,
      [itemId]: prev[itemId] || defaultMethodId,
    }));
  };

  const setItemMethod = (itemId: string, methodId: string) => {
    setItemMethodIds((prev) => ({ ...prev, [itemId]: methodId }));
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

    const itemPayments = selectedItems.map((item) => {
      const quantity = payQuantities[item.id] ?? 0;
      const amount = computeLineAmount(quantity, item.unit_price);
      return {
        itemId: item.id,
        methodId: itemMethodIds[item.id] || defaultMethodId,
        quantity,
        unitPrice: item.unit_price,
        amount,
      };
    });

    if (itemPayments.some((item) => !item.methodId)) {
      toast.error("Todos los items seleccionados deben tener metodo de pago");
      return;
    }

    if (itemPayments.some((item) => item.quantity <= 0)) {
      toast.error("Debes seleccionar al menos una cantidad valida para cobrar");
      return;
    }

    const receivedDenoms = Object.entries(received)
      .filter(([, quantity]) => quantity > 0)
      .map(([denomination_id, qty]) => ({ denomination_id, qty }));

    const changeDenoms = changeDenomBreakdown.map((denomination) => ({
      denomination_id: denomination.denomination_id,
      qty: denomination.qty,
    }));

    onPay({
      orderId: order.id,
      itemPayments,
      totalAmount: Math.round(selectedTotal * 100) / 100,
      receivedDenoms,
      changeDenoms,
    });
  };

  const canPay =
    !readOnly &&
    selectedItems.length > 0 &&
    paymentMethods.length > 0 &&
    missingMethodCount === 0 &&
    !paying &&
    (!hasReceivedDenoms || (totalReceived >= selectedTotal && !cannotMakeChange));

  const sortedDenoms = useMemo(() => [...shiftDenoms].sort((a, b) => a.value - b.value), [shiftDenoms]);

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {readOnly ? "Consulta de cobro" : "Cobrar"} {order?.order_code ?? `#${order?.order_number}`}{" "}
            {order?.order_type === "DINE_IN" && order?.table_name && (
              <span className="font-normal text-muted-foreground">- {order.table_name}</span>
            )}
            {order?.split_code && <span className="font-normal text-muted-foreground"> ({order.split_code})</span>}
          </DialogTitle>
        </DialogHeader>

        {order && (
          <div className="space-y-4">
            {readOnly && (
              <div className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Modo consulta: puedes revisar los montos pendientes, pero no registrar pagos.
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Cobro parcial por cantidad</p>
                {!readOnly && (
                  <div className="flex items-center gap-3">
                    <button onClick={fillAllPending} className="text-xs text-primary hover:underline">
                      Todo pendiente
                    </button>
                    <button onClick={clearAllSelection} className="text-xs text-muted-foreground hover:underline">
                      Limpiar
                    </button>
                  </div>
                )}
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-border p-2">
                {unpaidItems.map((item) => {
                  const qtyToPay = payQuantities[item.id] ?? 0;
                  const lineSubtotal = computeLineAmount(qtyToPay, item.unit_price);

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "grid grid-cols-1 gap-2 rounded-lg border p-2 lg:grid-cols-[1.7fr,120px,120px,120px,120px,180px]",
                        qtyToPay > 0 ? "border-primary/40 bg-primary/5" : "border-border",
                      )}
                    >
                      <div>
                        <p className="truncate text-sm font-medium text-foreground">{item.description_snapshot}</p>
                        <p className="text-xs text-muted-foreground">
                          Total: {item.quantity} · Pagado: {item.quantity_paid} · Pendiente: {item.quantity_pending}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground">Precio unit.</p>
                        <p className="text-sm font-medium text-foreground">${item.unit_price.toFixed(2)}</p>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground">Pendiente</p>
                        <p className="text-sm font-medium text-foreground">{item.quantity_pending}</p>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground">Cobrar ahora</p>
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity_pending}
                          step={1}
                          value={qtyToPay}
                          onChange={(e) => setItemQty(item.id, Number(e.target.value), item.quantity_pending)}
                          className="h-8"
                          disabled={readOnly}
                        />
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground">Subtotal</p>
                        <p className="text-sm font-semibold text-foreground">${lineSubtotal.toFixed(2)}</p>
                      </div>

                      <Select
                        value={itemMethodIds[item.id] || defaultMethodId}
                        onValueChange={(value) => setItemMethod(item.id, value)}
                        disabled={readOnly || qtyToPay <= 0 || paymentMethods.length === 0}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Metodo" />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((method) => (
                            <SelectItem key={method.id} value={method.id}>
                              {method.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                {paidItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-1.5 opacity-50">
                    <span className="flex-1 truncate text-sm text-foreground line-through">
                      {item.description_snapshot} · {item.quantity} unidad(es)
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Pagado completo
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {paymentMethods.length === 0 && (
              <p className="text-xs font-medium text-destructive">No hay metodos de pago activos para esta sucursal.</p>
            )}

            <div className="rounded-xl bg-primary/10 p-3 text-center">
              <p className="text-xs text-muted-foreground">Subtotal a cobrar</p>
              <p className="font-display text-2xl font-bold text-primary">${selectedTotal.toFixed(2)}</p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  Monto recibido <span className="font-normal text-muted-foreground">(opcional)</span>
                </p>
                {!readOnly && hasReceivedDenoms && (
                  <button
                    onClick={() => setReceived({})}
                    className="flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" /> Limpiar
                  </button>
                )}
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {sortedDenoms.map((denomination) => (
                  <button
                    key={denomination.denomination_id}
                    onClick={() => addDenom(denomination.denomination_id)}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                    disabled={readOnly}
                  >
                    {denomination.label}
                  </button>
                ))}
              </div>

              {hasReceivedDenoms && (
                <div className="space-y-1 rounded-xl border border-border p-2">
                  {sortedDenoms
                    .filter((denomination) => (received[denomination.denomination_id] || 0) > 0)
                    .map((denomination) => (
                      <div key={denomination.denomination_id} className="flex items-center gap-2 text-sm">
                        {!readOnly && (
                          <button
                            onClick={() => removeDenom(denomination.denomination_id)}
                            className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground"
                          >
                            -
                          </button>
                        )}
                        <span className="flex-1 text-foreground">
                          {received[denomination.denomination_id]}x {denomination.label}
                        </span>
                        <span className="font-medium text-foreground">
                          ${(received[denomination.denomination_id]! * denomination.value).toFixed(2)}
                        </span>
                        {!readOnly && (
                          <button
                            onClick={() => addDenom(denomination.denomination_id)}
                            className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground"
                          >
                            +
                          </button>
                        )}
                      </div>
                    ))}

                  <div className="flex justify-between border-t border-border pt-1 text-sm font-bold">
                    <span className="flex items-center gap-1 text-foreground">
                      <ArrowDown className="h-3 w-3 text-green-500" /> Recibido
                    </span>
                    <span className="text-foreground">${totalReceived.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {hasReceivedDenoms && changeAmount > 0 && (
              <div className="space-y-2 rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                    <ArrowUp className="h-3.5 w-3.5 text-amber-600" /> Cambio
                  </span>
                  <span className="font-display text-lg font-bold text-amber-600">${changeAmount.toFixed(2)}</span>
                </div>

                {changeDenomBreakdown.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Entregar:</p>
                    {changeDenomBreakdown.map((denomination) => (
                      <div key={denomination.denomination_id} className="flex justify-between text-sm">
                        <span className="text-foreground">
                          {denomination.qty}x {denomination.label}
                        </span>
                        <span className="font-medium text-foreground">${(denomination.qty * denomination.value).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {cannotMakeChange && (
                  <p className="text-xs font-medium text-destructive">
                    No hay suficientes denominaciones en caja para dar el cambio exacto.
                  </p>
                )}
              </div>
            )}

            {hasReceivedDenoms && totalReceived < selectedTotal && (
              <p className="text-center text-xs font-medium text-destructive">
                El monto recibido (${totalReceived.toFixed(2)}) es menor al total (${selectedTotal.toFixed(2)}).
              </p>
            )}

            {!readOnly ? (
              <Button onClick={handlePay} disabled={!canPay} className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold">
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
              <div className="rounded-xl bg-muted p-3 text-center text-xs text-muted-foreground">
                Esta cuenta no puede registrar cobros.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
