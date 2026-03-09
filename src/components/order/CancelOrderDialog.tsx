import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCancellation } from "@/hooks/useCancellation";
import { supabase } from "@/integrations/supabase/client";
import { CANCELLATION_REASONS, type CancellationReason } from "@/types/cancellation";

interface CancelOrderDialogProps {
  orderId: string;
  orderNumber: number;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SnapshotItem {
  order_item_id: string;
  description_snapshot: string;
  status: string;
  quantity_ordered: number;
  quantity_paid: number;
  quantity_cancelled: number;
  quantity_pending_active: number;
  unit_price: number;
}

function parsePaymentNotes(notes: string | null): { reversed: boolean; voided: boolean } {
  const text = notes ?? "";
  return {
    reversed: text.includes("REVERSED:"),
    voided: text.includes("VOIDED:"),
  };
}

export default function CancelOrderDialog({ orderId, orderNumber, userId, open, onOpenChange }: CancelOrderDialogProps) {
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [notes, setNotes] = useState("");
  const [cancellationType, setCancellationType] = useState<"partial" | "total">("partial");
  const [items, setItems] = useState<SnapshotItem[]>([]);
  const [cancelQtyByItem, setCancelQtyByItem] = useState<Record<string, number>>({});
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  const { cancelOrderMutation } = useCancellation();

  useEffect(() => {
    if (!open) return;

    const loadSnapshot = async () => {
      setLoadingSnapshot(true);
      try {
        const { data: orderItems, error: orderItemsError } = await supabase
          .from("order_items")
          .select("id, description_snapshot, status, quantity, unit_price")
          .eq("order_id", orderId)
          .neq("status", "CANCELLED");

        if (orderItemsError) throw orderItemsError;

        const itemIds = (orderItems ?? []).map((item) => item.id);
        if (itemIds.length === 0) {
          setItems([]);
          setCancelQtyByItem({});
          return;
        }

        const { data: paymentItems, error: paymentItemsError } = await supabase
          .from("payment_items")
          .select("order_item_id, quantity_paid, payment_id")
          .in("order_item_id", itemIds);
        if (paymentItemsError) throw paymentItemsError;

        const paymentIds = [...new Set((paymentItems ?? []).map((row) => row.payment_id))];
        let blockedPaymentIds = new Set<string>();

        if (paymentIds.length > 0) {
          const { data: payments, error: paymentsError } = await supabase
            .from("payments")
            .select("id, notes")
            .in("id", paymentIds);
          if (paymentsError) throw paymentsError;

          blockedPaymentIds = new Set(
            (payments ?? [])
              .filter((payment) => {
                const meta = parsePaymentNotes(payment.notes);
                return meta.reversed || meta.voided;
              })
              .map((payment) => payment.id)
          );
        }

        const paidMap: Record<string, number> = {};
        for (const row of paymentItems ?? []) {
          if (blockedPaymentIds.has(row.payment_id)) continue;
          paidMap[row.order_item_id] = (paidMap[row.order_item_id] ?? 0) + Number(row.quantity_paid);
        }

        const { data: itemCancellations, error: itemCancellationsError } = await supabase
          .from("order_item_cancellations")
          .select("order_item_id, quantity_cancelled, order_cancellation_id")
          .in("order_item_id", itemIds);

        if (itemCancellationsError && itemCancellationsError.code !== "PGRST205") throw itemCancellationsError;

        const cancellationIds = [...new Set((itemCancellations ?? []).map((row) => row.order_cancellation_id))];
        let activeCancellationIds = new Set<string>();

        if (cancellationIds.length > 0) {
          const { data: cancellationHeaders, error: headersError } = await supabase
            .from("order_cancellations")
            .select("id, status")
            .in("id", cancellationIds);
          if (headersError && headersError.code !== "PGRST205") throw headersError;

          activeCancellationIds = new Set(
            (cancellationHeaders ?? []).filter((header) => header.status === "APPLIED").map((header) => header.id)
          );
        }

        const cancelledMap: Record<string, number> = {};
        for (const row of itemCancellations ?? []) {
          if (!activeCancellationIds.has(row.order_cancellation_id)) continue;
          cancelledMap[row.order_item_id] = (cancelledMap[row.order_item_id] ?? 0) + Number(row.quantity_cancelled);
        }

        const snapshot = (orderItems ?? []).map((item) => {
          const quantityOrdered = Number(item.quantity);
          const quantityPaid = Math.min(quantityOrdered, paidMap[item.id] ?? 0);
          const quantityCancelled = Math.min(quantityOrdered - quantityPaid, cancelledMap[item.id] ?? 0);
          const quantityPendingActive = Math.max(0, quantityOrdered - quantityPaid - quantityCancelled);

          return {
            order_item_id: item.id,
            description_snapshot: item.description_snapshot,
            status: item.status ?? "SENT",
            quantity_ordered: quantityOrdered,
            quantity_paid: quantityPaid,
            quantity_cancelled: quantityCancelled,
            quantity_pending_active: quantityPendingActive,
            unit_price: Number(item.unit_price),
          };
        });

        setItems(snapshot);

        const initialQty: Record<string, number> = {};
        for (const item of snapshot) {
          initialQty[item.order_item_id] = cancellationType === "total" ? item.quantity_pending_active : 0;
        }
        setCancelQtyByItem(initialQty);
      } finally {
        setLoadingSnapshot(false);
      }
    };

    loadSnapshot();
  }, [open, orderId]);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const item of items) {
      next[item.order_item_id] = cancellationType === "total" ? item.quantity_pending_active : cancelQtyByItem[item.order_item_id] ?? 0;
    }
    setCancelQtyByItem(next);
  }, [cancellationType]);

  const selectedItems = useMemo(
    () =>
      items
        .map((item) => ({
          ...item,
          selected_cancel_qty: Math.max(0, Math.min(item.quantity_pending_active, Math.floor(cancelQtyByItem[item.order_item_id] ?? 0))),
        }))
        .filter((item) => item.selected_cancel_qty > 0),
    [items, cancelQtyByItem]
  );

  const totalToCancel = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.selected_cancel_qty * item.unit_price, 0),
    [selectedItems]
  );

  const canSubmit = !!reason && !loadingSnapshot && !cancelOrderMutation.isPending && selectedItems.length > 0;

  const handleChangeQty = (orderItemId: string, rawValue: string, maxQty: number) => {
    const parsed = Number(rawValue);
    const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
    const clamped = Math.max(0, Math.min(maxQty, normalized));
    setCancelQtyByItem((prev) => ({ ...prev, [orderItemId]: clamped }));
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;

    cancelOrderMutation.mutate(
      {
        orderId,
        userId,
        cancellationType,
        items: selectedItems.map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.selected_cancel_qty,
          status: item.status,
          description_snapshot: item.description_snapshot,
          unit_price: item.unit_price,
        })),
        cancellationData: {
          reason,
          notes,
          cancelledBy: userId,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
          setNotes("");
          setCancellationType("partial");
          setCancelQtyByItem({});
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancelar orden</DialogTitle>
          <DialogDescription>Orden #{orderNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border p-2">
            <Button
              type="button"
              variant={cancellationType === "partial" ? "default" : "outline"}
              onClick={() => setCancellationType("partial")}
              className="h-8"
            >
              Cancelacion parcial
            </Button>
            <Button
              type="button"
              variant={cancellationType === "total" ? "default" : "outline"}
              onClick={() => setCancellationType("total")}
              className="h-8"
            >
              Cancelacion total
            </Button>
          </div>

          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando cantidades de la orden...
            </div>
          ) : items.length === 0 ? (
            <Alert>
              <AlertDescription>No hay items activos para cancelar en esta orden.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seleccion de cantidades a cancelar</Label>
              <div className="space-y-2 max-h-72 overflow-y-auto rounded-lg border border-border p-2">
                {items.map((item) => (
                  <div key={item.order_item_id} className="rounded-md border border-border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{item.description_snapshot}</p>
                        <p className="text-xs text-muted-foreground">
                          Ord: {item.quantity_ordered} | Pag: {item.quantity_paid} | Canc: {item.quantity_cancelled} | Activa: {item.quantity_pending_active}
                        </p>
                      </div>
                      <div className="w-24">
                        <Label htmlFor={`qty-${item.order_item_id}`} className="text-[11px] text-muted-foreground">
                          Cant. cancelar
                        </Label>
                        <Input
                          id={`qty-${item.order_item_id}`}
                          type="number"
                          min={0}
                          max={item.quantity_pending_active}
                          step={1}
                          disabled={cancellationType === "total" || item.quantity_pending_active <= 0}
                          value={cancelQtyByItem[item.order_item_id] ?? 0}
                          onChange={(e) => handleChangeQty(item.order_item_id, e.target.value, item.quantity_pending_active)}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-sm font-medium">Motivo de cancelacion *</Label>
            <RadioGroup value={reason} onValueChange={(value) => setReason(value as CancellationReason)}>
              {Object.entries(CANCELLATION_REASONS).map(([key, label]) => (
                <div key={key} className="flex items-center space-x-2">
                  <RadioGroupItem value={key} id={`order-${key}`} />
                  <Label htmlFor={`order-${key}`} className="font-normal cursor-pointer">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-notes" className="text-sm font-medium">
              Notas adicionales (opcional)
            </Label>
            <Textarea
              id="order-notes"
              placeholder="Detalle adicional de la cancelacion..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-20"
            />
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Cancelar no significa cobrar. Esta accion anula cantidades del pedido y no registra pagos.
            </AlertDescription>
          </Alert>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="text-muted-foreground">Items seleccionados: {selectedItems.length}</p>
            <p className="font-semibold">Total a cancelar: ${totalToCancel.toFixed(2)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit}>
            {cancelOrderMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...
              </>
            ) : (
              "Confirmar cancelacion"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
