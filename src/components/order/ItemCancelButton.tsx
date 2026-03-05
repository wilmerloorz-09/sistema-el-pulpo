import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { CancelItemDialog } from './CancelItemDialog';
import { CANCELLABLE_ITEM_STATUSES, type OrderItemStatus } from '@/types/cancellation';

interface ItemCancelButtonProps {
  itemId: string;
  orderId: string;
  status: OrderItemStatus;
  quantity: number;
  description: string;
  total: number;
  userId: string;
}

export function ItemCancelButton({
  itemId,
  orderId,
  status,
  quantity,
  description,
  total,
  userId,
}: ItemCancelButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const canCancel = CANCELLABLE_ITEM_STATUSES.includes(status);

  if (!canCancel) {
    return null;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDialogOpen(true)}
        className="text-red-600 hover:text-red-700 hover:bg-red-50"
      >
        <X className="w-4 h-4" />
      </Button>

      <CancelItemDialog
        itemId={itemId}
        orderId={orderId}
        status={status}
        quantity={quantity}
        description={description}
        total={total}
        userId={userId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
