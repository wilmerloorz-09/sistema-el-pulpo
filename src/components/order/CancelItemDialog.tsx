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
  REQUIRES_REASON_ITEM_STATUSES,
  type CancellationReason,
  type OrderItemStatus,
} from '@/types/cancellation';

interface CancelItemDialogProps {
  itemId: string;
  orderId: string;
  status: OrderItemStatus;
  quantity: number;
  description: string;
  total: number;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelItemDialog({
  itemId,
  orderId,
  status,
  quantity,
  description,
  total,
  userId,
  open,
  onOpenChange,
}: CancelItemDialogProps) {
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [notes, setNotes] = useState('');
  const { cancelItemMutation } = useCancellation();

  const requiresReason = REQUIRES_REASON_ITEM_STATUSES.includes(status);
  const isDispatched = status === 'DISPATCHED';
  const isDraft = status === 'DRAFT';

  const handleConfirm = async () => {
    if (requiresReason && !reason) {
      alert('Por favor selecciona un motivo');
      return;
    }

    cancelItemMutation.mutate(
      {
        itemId,
        orderId,
        currentStatus: status,
        quantity,
        unitPrice: quantity > 0 ? total / quantity : 0,
        userId,
        cancellationData: {
          reason: reason as CancellationReason,
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
          <DialogTitle>Cancelar Item</DialogTitle>
          <DialogDescription>
            {quantity}x {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Advertencia si es DISPATCHED */}
          {isDispatched && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                ⚠️ Este item ya fue despachado. Se registrara como perdida operacional.
              </AlertDescription>
            </Alert>
          )}

          {/* Mostrar motivos si es necesario */}
          {requiresReason && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Motivo de cancelacion *</Label>
              <RadioGroup value={reason} onValueChange={(value) => setReason(value as CancellationReason)}>
                {Object.entries(CANCELLATION_REASONS).map(([key, label]) => (
                  <div key={key} className="flex items-center space-x-2">
                    <RadioGroupItem value={key} id={key} />
                    <Label htmlFor={key} className="font-normal cursor-pointer">
                      {label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Campo de notas (opcional) */}
          {requiresReason && (
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm font-medium">
                Notas adicionales (opcional)
              </Label>
              <Textarea
                id="notes"
                placeholder="Agrega mas detalles si es necesario..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-20"
              />
            </div>
          )}

          {/* Resumen */}
          <div className="bg-muted rounded-lg p-3 space-y-2">
            <div className="text-sm">
              <p className="text-muted-foreground">Cantidad:</p>
              <p className="font-semibold">{quantity} unidades</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Total a perder:</p>
              <p className="font-semibold text-red-600">${total.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={cancelItemMutation.isPending || (requiresReason && !reason)}
          >
            {cancelItemMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelando...
              </>
            ) : (
              'Confirmar cancelacion'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



