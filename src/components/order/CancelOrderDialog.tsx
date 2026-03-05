import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCancellation } from '@/hooks/useCancellation';
import {
  CANCELLATION_REASONS,
  type CancellationReason,
  type OrderItem,
} from '@/types/cancellation';

interface CancelOrderDialogProps {
  orderId: string;
  orderNumber: number;
  items: OrderItem[];
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CancelOrderDialog({
  orderId,
  orderNumber,
  items,
  userId,
  open,
  onOpenChange,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [notes, setNotes] = useState('');
  const { cancelOrderMutation } = useCancellation();

  const cancelableItems = items.filter((item) => item.status !== 'PAID' && item.status !== 'CANCELLED');
  const dispatchedItems = cancelableItems.filter((item) => item.status === 'DISPATCHED');
  const sentItems = cancelableItems.filter((item) => item.status === 'SENT');
  const totalToLose = dispatchedItems.reduce((sum, item) => sum + item.total, 0);

  const hasDispatchedItems = dispatchedItems.length > 0;

  const handleConfirm = async () => {
    if (!reason) {
      alert('Por favor selecciona un motivo');
      return;
    }

    cancelOrderMutation.mutate(
      {
        orderId,
        items: cancelableItems,
        userId,
        cancellationData: {
          reason,
          notes,
          cancelledBy: userId,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason('');
          setNotes('');
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Cancelar Orden Completa</DialogTitle>
          <DialogDescription>Orden #{orderNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alertas importantes */}
          {hasDispatchedItems && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                ⚠️ {dispatchedItems.length} ítem(s) ya fue(ron) despachado(s). Se registrará(n) como pérdida(s) operacional(es).
              </AlertDescription>
            </Alert>
          )}

          {sentItems.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                ℹ️ Cocina será notificada de la cancelación de {sentItems.length} ítem(s).
              </AlertDescription>
            </Alert>
          )}

          {/* Ítems a cancelar */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Ítems a cancelar:</Label>
            <div className="bg-muted rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
              {cancelableItems.map((item) => (
                <div key={item.id} className="text-sm flex justify-between">
                  <span>
                    {item.quantity}x {item.description_snapshot}
                  </span>
                  <span className="font-medium">${item.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Motivo obligatorio */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Motivo de cancelación *</Label>
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

          {/* Campo de notas */}
          <div className="space-y-2">
            <Label htmlFor="order-notes" className="text-sm font-medium">
              Notas adicionales (opcional)
            </Label>
            <Textarea
              id="order-notes"
              placeholder="Agrega más detalles si es necesario..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-20"
            />
          </div>

          {/* Resumen financiero */}
          {hasDispatchedItems && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-sm">
                <p className="text-red-600 font-medium">Pérdida operacional:</p>
                <p className="font-bold text-red-700 text-lg">${totalToLose.toFixed(2)}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={cancelOrderMutation.isPending || !reason}
          >
            {cancelOrderMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelando orden...
              </>
            ) : (
              'Confirmar cancelación'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}