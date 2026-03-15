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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface OperationItem {
  id: string;
  description_snapshot: string;
  quantity_ordered: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatched: number;
  quantity_cancelled: number;
}

interface OperationOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  items: OperationItem[];
}

interface OperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OperationOrder | null;
  mode: "ready" | "dispatch";
  processing?: boolean;
  onConfirm: (payload: {
    orderId: string;
    operationType: "partial" | "total";
    items: Array<Record<string, unknown>>;
  }) => void;
}

function getAvailable(item: OperationItem, mode: "ready" | "dispatch") {
  return mode === "ready" ? item.quantity_pending_prepare : item.quantity_ready_available;
}

export default function OperationDialog({ open, onOpenChange, order, mode, processing = false, onConfirm }: OperationDialogProps) {
  const [operationType, setOperationType] = useState<"partial" | "total">("total");
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!order) return;
    const next: Record<string, number> = {};
    for (const item of order.items) {
      const available = getAvailable(item, mode);
      if (available > 0) next[item.id] = available;
    }
    setQtyByItem(next);
    setOperationType("total");
  }, [order, mode, open]);

  const actionLabel = mode === "ready" ? "Listo" : "Despacho";
  const buttonLabel = mode === "ready" ? "Confirmar listo" : "Confirmar despacho";
  const availableLabel = mode === "ready" ? "Pendiente" : "Listo";

  const items = useMemo(() => {
    if (!order) return [];
    return order.items
      .map((item) => {
        const available = getAvailable(item, mode);
        const selectedQty = operationType === "total" ? available : Math.max(0, Math.min(available, Math.floor(qtyByItem[item.id] ?? 0)));
        return { ...item, available, selectedQty };
      })
      .filter((item) => item.available > 0);
  }, [order, mode, operationType, qtyByItem]);

  const selectedItems = items.filter((item) => item.selectedQty > 0);
  const totalUnits = selectedItems.reduce((sum, item) => sum + item.selectedQty, 0);
  const canSubmit = !!order && !processing && selectedItems.length > 0;

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl bg-background shadow-xl rounded-[24px]">
        <DialogHeader>
          <DialogTitle>{actionLabel} de orden</DialogTitle>
          <DialogDescription>{order.order_code ?? `#${order.order_number}`}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border p-2">
            <Button type="button" variant={operationType === "total" ? "default" : "outline"} className="h-8" onClick={() => setOperationType("total")}>Todo</Button>
            <Button type="button" variant={operationType === "partial" ? "default" : "outline"} className="h-8" onClick={() => setOperationType("partial")}>Parcial</Button>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Seleccion de cantidades</Label>
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{item.description_snapshot}</p>
                      <p className="text-xs text-muted-foreground">
                        Ord: {item.quantity_ordered} | {availableLabel}: {item.available} | Desp: {item.quantity_dispatched} | Canc: {item.quantity_cancelled}
                      </p>
                    </div>
                    <div className="w-24">
                      <Label htmlFor={`${mode}-${item.id}`} className="text-[11px] text-muted-foreground">Cantidad</Label>
                      <Input
                        id={`${mode}-${item.id}`}
                        type="number"
                        min={0}
                        max={item.available}
                        step={1}
                        disabled={operationType === "total" || item.available <= 0}
                        value={operationType === "total" ? item.available : qtyByItem[item.id] ?? 0}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const next = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
                          const clamped = Math.max(0, Math.min(item.available, next));
                          setQtyByItem((prev) => ({ ...prev, [item.id]: clamped }));
                        }}
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="text-muted-foreground">Items seleccionados: {selectedItems.length}</p>
            <p className="font-semibold">Unidades a procesar: {totalUnits}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button
            onClick={() =>
              onConfirm({
                orderId: order.id,
                operationType: "partial",
                items: selectedItems.map((item) =>
                  mode === "ready"
                    ? { order_item_id: item.id, quantity_ready: item.selectedQty }
                    : { order_item_id: item.id, quantity_dispatched: item.selectedQty },
                ),
              })
            }
            disabled={!canSubmit}
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

