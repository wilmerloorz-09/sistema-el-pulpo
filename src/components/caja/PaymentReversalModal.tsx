import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import type { CompletedPaymentStatus } from "@/hooks/useCaja";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface ReversalPaymentItem {
  id: string;
  paymentEntryId: string;
  productName: string;
  quantity: number;
  amount: number;
  methodName: string;
  status: CompletedPaymentStatus;
}

export interface ReversalPaymentData {
  paymentId: string;
  orderId: string;
  orderCode: string | null;
  orderNumber: number;
  tableLabel: string;
  createdAt: string;
  cashierName: string;
  amount: number;
  status: CompletedPaymentStatus;
  notes: string | null;
  methodsSummary: string;
  items: ReversalPaymentItem[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "request" | "execute";
  payment: ReversalPaymentData | null;
  loading?: boolean;
  allowPartial?: boolean;
  titleOverride?: string;
  onSubmit: (params: {
    paymentId: string;
    reason: string;
    paymentEntryIds: string[];
  }) => Promise<void>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentReversalModal({
  open,
  onOpenChange,
  mode,
  payment,
  loading = false,
  allowPartial = true,
  titleOverride,
  onSubmit,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payment || !open) return;
    setSelectedIds(new Set(payment.items.map((item) => item.paymentEntryId)));
    setReason("");
    setError(null);
    setConfirmOpen(false);
  }, [payment?.paymentId, open]);

  const selectableItems = payment?.items ?? [];

  const selectedAmount = useMemo(() => {
    if (!payment) return 0;
    return payment.items
      .filter((item) => selectedIds.has(item.paymentEntryId))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [payment, selectedIds]);

  const toggleItem = (entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!payment) return;
    if (selectedIds.size === payment.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(payment.items.map((item) => item.paymentEntryId)));
    }
  };

  const canSubmit = reason.trim().length > 0 && selectedIds.size > 0 && !loading;

  const openConfirmation = () => {
    if (!canSubmit) {
      if (!reason.trim()) setError("Debes ingresar un motivo de reverso.");
      else if (selectedIds.size === 0) setError("Debes seleccionar al menos un item para reversar.");
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const executeSubmit = async () => {
    if (!payment) return;
    try {
      await onSubmit({
        paymentId: payment.paymentId,
        reason: reason.trim(),
        paymentEntryIds: [...selectedIds],
      });
      setConfirmOpen(false);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la accion.");
      setConfirmOpen(false);
    }
  };

  const title = titleOverride ?? (mode === "request" ? "Solicitar reverso" : "Reversar pago");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          {!payment ? (
            <p className="text-sm text-muted-foreground">No hay datos del pago seleccionado.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Orden</p>
                  <p className="font-semibold">{payment.orderCode ?? `#${payment.orderNumber}`}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mesa</p>
                  <p className="font-semibold">{payment.tableLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pago #</p>
                  <p className="font-semibold">{payment.paymentId.slice(0, 8)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fecha y hora</p>
                  <p className="font-semibold">{formatDateTime(payment.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cajero</p>
                  <p className="font-semibold">{payment.cashierName}</p>
                </div>
                <div className="flex items-end">
                  <PaymentStatusBadge status={payment.status} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Monto total del pago</p>
                  <p className="font-semibold">${payment.amount.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Metodo(s)</p>
                  <p className="font-semibold">{payment.methodsSummary}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Monto a reversar</p>
                  <p className="font-semibold text-destructive">${selectedAmount.toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Detalle de items del pago</p>
                  {allowPartial && (
                    <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                      {selectedIds.size === selectableItems.length ? "Ninguno" : "Todos"}
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-border p-2 space-y-1 max-h-56 overflow-y-auto">
                  {selectableItems.map((item) => (
                    <label
                      key={item.id + item.paymentEntryId}
                      className="grid grid-cols-1 md:grid-cols-[auto,1fr,100px,120px,120px] gap-2 p-2 rounded-lg border border-transparent hover:border-border cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(item.paymentEntryId)}
                        onCheckedChange={() => toggleItem(item.paymentEntryId)}
                        disabled={!allowPartial && selectableItems.length > 1}
                      />
                      <span className="text-sm text-foreground truncate">
                        {item.quantity}x {item.productName}
                      </span>
                      <span className="text-sm text-muted-foreground">{item.methodName}</span>
                      <span className="text-sm text-muted-foreground">{item.status}</span>
                      <span className="text-sm font-semibold text-right">${item.amount.toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Motivo del reverso *</p>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: error en metodo de pago, cobro duplicado, cliente cambio metodo de pago, error de cajero"
                  rows={3}
                />
              </div>

              {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            </div>
          )}

          <DialogFooter>
            <button
              className="h-9 px-3 rounded-lg border border-border text-sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
              onClick={openConfirmation}
              disabled={!payment || !canSubmit}
            >
              {mode === "request" ? "Enviar solicitud" : "Continuar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar reverso</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
            <p className="font-medium flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> Esta accion reversara el pago seleccionado.
            </p>
            <p>El monto dejara de contar como pagado y los items volveran a estado pendiente.</p>
          </div>
          <DialogFooter>
            <button
              className="h-9 px-3 rounded-lg border border-border text-sm"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              className="h-9 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm flex items-center gap-2 disabled:opacity-50"
              onClick={executeSubmit}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar reverso
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

