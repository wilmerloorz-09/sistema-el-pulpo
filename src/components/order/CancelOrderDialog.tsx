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
import type { OrderItemSummary } from "@/hooks/useOrdersByStatus";

interface CancelOrderDialogProps {
  orderId: string;
  orderNumber: number;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAuthorizeCancel?: boolean;
  isCancelRequested?: boolean;
  visibleItems?: OrderItemSummary[];
}

interface SnapshotItem {
  order_item_id: string;
  description_snapshot: string;
  item_status: string;
  quantity_ordered: number;
  quantity_paid: number;
  quantity_ready_available: number;
  quantity_dispatched_total: number;
  quantity_dispatched_available: number;
  quantity_cancelled_total: number;
  quantity_cancelled_dispatched: number;
  quantity_pending_prepare: number;
  quantity_cancellable: number;
  unit_price: number;
}

export default function CancelOrderDialog({
  orderId,
  orderNumber,
  userId,
  open,
  onOpenChange,
  canAuthorizeCancel = true,
  isCancelRequested = false,
  visibleItems = [],
}: CancelOrderDialogProps) {
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
        const { data, error } = await (supabase as any).rpc("get_order_operational_snapshot", {
          p_order_id: orderId,
        });

        if (error) throw error;

        const visibleItemsById = new Map(
          visibleItems.map((item) => [
            item.id,
            {
              quantity: Number(item.quantity ?? 0),
              description: item.description_snapshot,
            },
          ]),
        );

        const snapshot = ((data ?? []) as any[])
          .map((item) => ({
            order_item_id: item.order_item_id,
            description_snapshot: item.description_snapshot,
            item_status: item.item_status ?? "SENT",
            quantity_ordered: Number(item.quantity_ordered ?? 0),
            quantity_paid: Number(item.quantity_paid ?? 0),
            quantity_ready_available: Number(item.quantity_ready_available ?? 0),
            quantity_dispatched_total: Number(item.quantity_dispatched_total ?? item.quantity_dispatched ?? 0),
            quantity_dispatched_available: Number(item.quantity_dispatched_available ?? item.quantity_dispatched ?? 0),
            quantity_cancelled_total: Number(item.quantity_cancelled_total ?? 0),
            quantity_cancelled_dispatched: Number(item.quantity_cancelled_dispatched ?? 0),
            quantity_pending_prepare: Number(item.quantity_pending_prepare ?? 0),
            quantity_cancellable:
              Number(item.quantity_pending_prepare ?? 0)
              + Number(item.quantity_ready_available ?? 0)
              + Number(item.quantity_dispatched_available ?? item.quantity_dispatched ?? 0),
            unit_price: Number(item.unit_price ?? 0),
          }))
          .filter((item) => visibleItemsById.size === 0 || visibleItemsById.has(item.order_item_id))
          .map((item) => {
            const visibleItem = visibleItemsById.get(item.order_item_id);
            if (!visibleItem) return item;

            return {
              ...item,
              description_snapshot: visibleItem.description || item.description_snapshot,
              quantity_cancellable: Math.max(0, Math.min(item.quantity_cancellable, visibleItem.quantity)),
            };
          })
          .filter((item) => item.quantity_cancellable > 0);

        setItems(snapshot);

        const initialQty: Record<string, number> = {};
        for (const item of snapshot) {
          initialQty[item.order_item_id] = cancellationType === "total" ? item.quantity_cancellable : 0;
        }
        setCancelQtyByItem(initialQty);
      } finally {
        setLoadingSnapshot(false);
      }
    };

    loadSnapshot();
  }, [open, orderId, cancellationType, visibleItems]);

  const selectedItems = useMemo(
    () =>
      items
        .map((item) => {
          const selectedCancelQty = Math.max(
            0,
            Math.min(item.quantity_cancellable, Math.floor(cancelQtyByItem[item.order_item_id] ?? 0)),
          );
          const quantityCancelledPending = Math.min(selectedCancelQty, item.quantity_pending_prepare);
          const remainingAfterPending = Math.max(0, selectedCancelQty - quantityCancelledPending);
          const quantityCancelledReady = Math.min(remainingAfterPending, item.quantity_ready_available);
          const quantityCancelledDispatched = Math.max(0, remainingAfterPending - quantityCancelledReady);

          return {
            ...item,
            selected_cancel_qty: selectedCancelQty,
            quantity_cancelled_pending: quantityCancelledPending,
            quantity_cancelled_ready: quantityCancelledReady,
            quantity_cancelled_dispatched: quantityCancelledDispatched,
          };
        })
        .filter((item) => item.selected_cancel_qty > 0),
    [items, cancelQtyByItem],
  );

  const totalToCancel = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.selected_cancel_qty * item.unit_price, 0),
    [selectedItems],
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
          status: item.item_status,
          description_snapshot: item.description_snapshot,
          unit_price: item.unit_price,
          quantity_cancelled_pending: item.quantity_cancelled_pending,
          quantity_cancelled_ready: item.quantity_cancelled_ready,
          quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
        })),
        cancellationData: {
          reason,
          notes,
          cancelledBy: userId,
        },
        requiresAuthorization: !canAuthorizeCancel && !isCancelRequested,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
          setNotes("");
          setCancellationType("partial");
          setCancelQtyByItem({});
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cancelar orden</DialogTitle>
          <DialogDescription>Orden #{orderNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant={cancellationType === "partial" ? "default" : "outline"}
              onClick={() => setCancellationType("partial")}
              className="h-9 w-full sm:h-8 sm:w-auto"
            >
              Cancelacion parcial
            </Button>
            <Button
              type="button"
              variant={cancellationType === "total" ? "default" : "outline"}
              onClick={() => setCancellationType("total")}
              className="h-9 w-full sm:h-8 sm:w-auto"
            >
              Cancelacion total
            </Button>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Aqui aparecen las cantidades que todavia se pueden anular. Si una linea ya fue despachada pero aun no esta pagada, tambien se mostrara como anulable.
            </AlertDescription>
          </Alert>

          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando cantidades operativas de la orden...
            </div>
          ) : items.length === 0 ? (
            <Alert>
              <AlertDescription>
                Esta orden ya no tiene cantidades anulables. Si todo ya fue pagado o ya no queda cantidad disponible, no puede anularse desde aqui.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seleccion de cantidades a cancelar</Label>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                {items.map((item) => (
                  <div key={item.order_item_id} className="rounded-md border border-border p-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.description_snapshot}</p>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Ord: {item.quantity_ordered} | Pend: {item.quantity_pending_prepare} | Listo: {item.quantity_ready_available} | Desp: {item.quantity_dispatched_available} | Canc: {item.quantity_cancelled_total} | Pag: {item.quantity_paid}
                        </p>
                      </div>
                      <div className="w-full sm:w-24">
                        <Label htmlFor={`qty-${item.order_item_id}`} className="text-[11px] text-muted-foreground">
                          Cant. cancelar
                        </Label>
                        <Input
                          id={`qty-${item.order_item_id}`}
                          type="number"
                          min={0}
                          max={item.quantity_cancellable}
                          step={1}
                          disabled={cancellationType === "total" || item.quantity_cancellable <= 0}
                          value={cancelQtyByItem[item.order_item_id] ?? 0}
                          onChange={(e) => handleChangeQty(item.order_item_id, e.target.value, item.quantity_cancellable)}
                          className="h-9"
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
                  <Label htmlFor={`order-${key}`} className="cursor-pointer font-normal">
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
              Se cancela primero la cantidad pendiente, luego la cantidad lista y, si todavia hace falta, la cantidad ya despachada que siga sin pagarse. Las cantidades pagadas nunca se cancelan.
            </AlertDescription>
          </Alert>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="text-muted-foreground">Items seleccionados: {selectedItems.length}</p>
            <p className="font-semibold">Total a cancelar: ${totalToCancel.toFixed(2)}</p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Cerrar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit} className="w-full sm:w-auto">
            {cancelOrderMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...
              </>
            ) : isCancelRequested && canAuthorizeCancel ? (
              "Autorizar anulación"
            ) : !canAuthorizeCancel ? (
              "Solicitar anulación"
            ) : (
              "Confirmar cancelacion"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
