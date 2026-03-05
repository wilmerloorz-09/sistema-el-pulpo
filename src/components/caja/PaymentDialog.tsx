import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CreditCard, Loader2, RotateCcw, ArrowDown, ArrowUp } from "lucide-react";
import type { PayableOrder, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";

interface Props {
  order: PayableOrder | null;
  paymentMethods: { id: string; name: string }[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => void;
  paying: boolean;
  onClose: () => void;
}

export default function PaymentDialog({ order, paymentMethods, shiftDenoms, onPay, paying, onClose }: Props) {
  const unpaidItems = useMemo(() => order?.items.filter((i) => !i.paid_at) ?? [], [order]);
  const paidItems = useMemo(() => order?.items.filter((i) => !!i.paid_at) ?? [], [order]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [methodId, setMethodId] = useState("");
  const [received, setReceived] = useState<Record<string, number>>({});

  // Reset state when order changes
  useEffect(() => {
    if (order) {
      setSelectedIds(new Set(unpaidItems.map((i) => i.id)));
      setMethodId("");
      setReceived({});
    }
  }, [order?.id]);

  const selectedTotal = useMemo(
    () =>
      unpaidItems
        .filter((i) => selectedIds.has(i.id))
        .reduce((s, i) => s + i.total, 0),
    [selectedIds, unpaidItems]
  );

  const totalReceived = useMemo(
    () =>
      shiftDenoms.reduce(
        (s, d) => s + (received[d.denomination_id] || 0) * d.value,
        0
      ),
    [received, shiftDenoms]
  );

  const hasReceivedDenoms = Object.values(received).some((q) => q > 0);
  const changeAmount = hasReceivedDenoms
    ? Math.round(Math.max(0, totalReceived - selectedTotal) * 100) / 100
    : 0;

  const changeDenomBreakdown = useMemo(() => {
    if (changeAmount <= 0) return [];
    const sorted = [...shiftDenoms].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const result: { denomination_id: string; qty: number; value: number; label: string }[] = [];
    let remaining = changeAmount;
    for (const d of sorted) {
      if (remaining <= 0.001) break;
      const maxQty = Math.floor(remaining / d.value);
      const available = d.qty_current + (received[d.denomination_id] || 0);
      const qty = Math.min(maxQty, available);
      if (qty > 0) {
        result.push({ denomination_id: d.denomination_id, qty, value: d.value, label: d.label });
        remaining = Math.round((remaining - qty * d.value) * 100) / 100;
      }
    }
    return result;
  }, [changeAmount, shiftDenoms, received]);

  const changeGiven = changeDenomBreakdown.reduce((s, d) => s + d.qty * d.value, 0);
  const cannotMakeChange = changeAmount > 0 && Math.abs(changeGiven - changeAmount) > 0.001;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === unpaidItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unpaidItems.map((i) => i.id)));
    }
  };

  const addDenom = (denomId: string) =>
    setReceived((p) => ({ ...p, [denomId]: (p[denomId] || 0) + 1 }));

  const removeDenom = (denomId: string) =>
    setReceived((p) => {
      const val = (p[denomId] || 0) - 1;
      if (val <= 0) {
        const { [denomId]: _, ...rest } = p;
        return rest;
      }
      return { ...p, [denomId]: val };
    });

  const handlePay = () => {
    if (!methodId || selectedIds.size === 0) return;
    const receivedDenoms = Object.entries(received)
      .filter(([, qty]) => qty > 0)
      .map(([denomination_id, qty]) => ({ denomination_id, qty }));
    const changeDenoms = changeDenomBreakdown.map((d) => ({
      denomination_id: d.denomination_id,
      qty: d.qty,
    }));
    onPay({
      orderId: order!.id,
      methodId,
      itemIds: [...selectedIds],
      amount: selectedTotal,
      receivedDenoms,
      changeDenoms,
    });
  };

  const canPay =
    methodId &&
    selectedIds.size > 0 &&
    !paying &&
    (!hasReceivedDenoms || (totalReceived >= selectedTotal && !cannotMakeChange));

  const sortedDenoms = useMemo(
    () => [...shiftDenoms].sort((a, b) => a.value - b.value),
    [shiftDenoms]
  );

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            Cobrar {order?.order_code ?? `#${order?.order_number}`}{" "}
            {order?.order_type === "DINE_IN" && order?.table_name && (
              <span className="text-muted-foreground font-normal">— {order.table_name}</span>
            )}
            {order?.split_code && (
              <span className="text-muted-foreground font-normal"> ({order.split_code})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {order && (
          <div className="space-y-4">
            {/* Item selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground">Seleccionar ítems</p>
                <button
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedIds.size === unpaidItems.length ? "Ninguno" : "Todos"}
                </button>
              </div>
              <div className="rounded-xl border border-border p-2 space-y-1 max-h-40 overflow-y-auto">
                {unpaidItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={() => toggleItem(item.id)}
                    />
                    <span className="flex-1 text-sm text-foreground truncate">
                      {item.quantity}× {item.description_snapshot}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      ${item.total.toFixed(2)}
                    </span>
                  </label>
                ))}
                {paidItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg opacity-40"
                  >
                    <Checkbox checked disabled />
                    <span className="flex-1 text-sm text-foreground truncate line-through">
                      {item.quantity}× {item.description_snapshot}
                    </span>
                    <Badge variant="outline" className="text-[10px]">Pagado</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Subtotal */}
            <div className="rounded-xl bg-primary/10 p-3 text-center">
              <p className="text-xs text-muted-foreground">Subtotal a cobrar</p>
              <p className="font-display text-2xl font-bold text-primary">
                ${selectedTotal.toFixed(2)}
              </p>
            </div>

            {/* Payment method */}
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Método de pago</p>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethodId(m.id)}
                    className={cn(
                      "rounded-xl border-2 p-2.5 text-sm font-medium transition-all",
                      methodId === m.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/50"
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Denomination input */}
            {methodId && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">
                    Monto recibido{" "}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </p>
                  {hasReceivedDenoms && (
                    <button
                      onClick={() => setReceived({})}
                      className="text-xs text-destructive hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" /> Limpiar
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sortedDenoms.map((d) => (
                    <button
                      key={d.denomination_id}
                      onClick={() => addDenom(d.denomination_id)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                {/* Received summary */}
                {hasReceivedDenoms && (
                  <div className="rounded-xl border border-border p-2 space-y-1">
                    {sortedDenoms
                      .filter((d) => (received[d.denomination_id] || 0) > 0)
                      .map((d) => (
                        <div key={d.denomination_id} className="flex items-center gap-2 text-sm">
                          <button
                            onClick={() => removeDenom(d.denomination_id)}
                            className="h-5 w-5 rounded bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                          >
                            −
                          </button>
                          <span className="flex-1 text-foreground">
                            {received[d.denomination_id]}× {d.label}
                          </span>
                          <span className="font-medium text-foreground">
                            ${(received[d.denomination_id]! * d.value).toFixed(2)}
                          </span>
                          <button
                            onClick={() => addDenom(d.denomination_id)}
                            className="h-5 w-5 rounded bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                          >
                            +
                          </button>
                        </div>
                      ))}
                    <div className="flex justify-between pt-1 border-t border-border text-sm font-bold">
                      <span className="flex items-center gap-1 text-foreground">
                        <ArrowDown className="h-3 w-3 text-green-500" /> Recibido
                      </span>
                      <span className="text-foreground">${totalReceived.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Change section */}
            {hasReceivedDenoms && changeAmount > 0 && (
              <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-foreground flex items-center gap-1">
                    <ArrowUp className="h-3.5 w-3.5 text-amber-600" /> Cambio
                  </span>
                  <span className="font-display text-lg font-bold text-amber-600">
                    ${changeAmount.toFixed(2)}
                  </span>
                </div>
                {changeDenomBreakdown.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Entregar:</p>
                    {changeDenomBreakdown.map((d) => (
                      <div key={d.denomination_id} className="flex justify-between text-sm">
                        <span className="text-foreground">
                          {d.qty}× {d.label}
                        </span>
                        <span className="font-medium text-foreground">
                          ${(d.qty * d.value).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {cannotMakeChange && (
                  <p className="text-xs text-destructive font-medium">
                    ⚠ No hay suficientes denominaciones en caja para dar el cambio exacto
                  </p>
                )}
              </div>
            )}

            {hasReceivedDenoms && totalReceived < selectedTotal && (
              <p className="text-xs text-destructive font-medium text-center">
                El monto recibido (${totalReceived.toFixed(2)}) es menor al total ($
                {selectedTotal.toFixed(2)})
              </p>
            )}

            {/* Pay button */}
            <Button
              onClick={handlePay}
              disabled={!canPay}
              className="w-full h-12 rounded-xl font-display text-base font-semibold gap-2"
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
