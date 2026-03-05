import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  dbUpdate,
  dbInsert,
  supabase,
  cancelOrderItem,
  recordOperationalLoss,
  notifyKitchenItemCancelled as notifyKitchenItemCancelledDB,
  notifyKitchenOrderCancelled as notifyKitchenOrderCancelledDB,
  cancelOrderFull,
  recalculateOrderTotal as recalculateOrderTotalDB,
  dbSelect,
} from '@/services/DatabaseService';
import { toast } from 'sonner';
import { useBranch } from '@/contexts/BranchContext';
import type {
  CancellationData,
  CancellationReason,
  OrderItem,
  OperationalLoss,
} from '@/types/cancellation';

interface CancelItemParams {
  itemId: string;
  orderId: string;
  currentStatus: string;
  quantity: number;
  itemTotal: number;
  userId: string;
  cancellationData?: CancellationData;
}

interface CancelOrderParams {
  orderId: string;
  items: OrderItem[];
  userId: string;
  cancellationData?: CancellationData;
}

/**
 * Hook para gestionar la cancelación de ítems y órdenes
 */
export function useCancellation() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  /**
   * Cancela un ítem individual
   */
  const cancelItemMutation = useMutation({
    mutationFn: async (params: CancelItemParams) => {
      const { itemId, orderId, currentStatus, itemTotal, userId, cancellationData } = params;

      if (!activeBranchId) throw new Error('Branch ID not available');

      // Cancelar el ítem usando método del DatabaseService
      await cancelOrderItem(itemId, {
        status: currentStatus,
        reason: cancellationData?.reason || 'Sin especificar',
        notes: cancellationData?.notes,
        cancelledBy: userId,
        fromStatus: currentStatus,
      });

      // Si se cancela desde DISPATCHED, registrar pérdida operacional
      if (currentStatus === 'DISPATCHED') {
        await recordOperationalLoss(
          orderId,
          itemId,
          itemTotal,
          cancellationData?.reason || 'Cancelación manual',
          userId,
          activeBranchId
        );
      }

      // Recalcular total de la orden
      await recalculateOrderTotalDB(orderId);

      // Si se cancela desde SENT, notificar a cocina
      if (currentStatus === 'SENT') {
        // Obtener detalles para la notificación
        const items = await dbSelect('order_items', {
          select: 'description_snapshot, quantity',
          filters: [{ column: 'id', op: 'eq', value: itemId }],
        });

        const item = items[0] as any;
        const orders = await dbSelect('orders', {
          select: 'order_number',
          filters: [{ column: 'id', op: 'eq', value: orderId }],
        });

        const order = orders[0] as any;

        await notifyKitchenItemCancelledDB(
          orderId,
          order.order_number,
          itemId,
          item.description_snapshot,
          item.quantity,
          cancellationData?.reason || 'Sin especificar',
          activeBranchId
        );
      }

      return { itemId, orderId };
    },
    onSuccess: (data) => {
      toast.success('Ítem cancelado');
      qc.invalidateQueries({ queryKey: ['order', data.orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error: any) => {
      console.error('Error cancelando ítem:', error);
      toast.error('Error al cancelar ítem: ' + error.message);
    },
  });

  /**
   * Cancela una orden completa
   */
  const cancelOrderMutation = useMutation({
    mutationFn: async (params: CancelOrderParams) => {
      const { orderId, items, userId, cancellationData } = params;

      if (!activeBranchId) throw new Error('Branch ID not available');

      let hasDispatchedItems = false;
      let hasSentItems = false;
      let totalDispatched = 0;

      // Cancelar todos los ítems cancelables
      for (const item of items) {
        if (item.status === 'CANCELLED' || item.status === 'PAID') {
          continue; // Omitir ítems ya cancelados o pagados
        }

        // Cancelar el ítem
        await cancelOrderItem(item.id, {
          status: item.status,
          reason: cancellationData?.reason || 'Sin especificar',
          notes: cancellationData?.notes,
          cancelledBy: userId,
          fromStatus: item.status,
        });

        // Registrar pérdida si estaba despachado
        if (item.status === 'DISPATCHED') {
          hasDispatchedItems = true;
          totalDispatched += item.total;
          await recordOperationalLoss(
            orderId,
            item.id,
            item.total,
            cancellationData?.reason || 'Cancelación de orden',
            userId,
            activeBranchId
          );
        }

        if (item.status === 'SENT') {
          hasSentItems = true;
        }
      }

      // Actualizar estado de la orden
      await cancelOrderFull(orderId, {
        reason: cancellationData?.reason || 'Sin especificar',
        notes: cancellationData?.notes,
        cancelledBy: userId,
        fromStatus: 'SENT_TO_KITCHEN',
      });

      // Notificar a cocina si hay ítems SENT
      if (hasSentItems) {
        const orders = await dbSelect('orders', {
          select: 'order_number',
          filters: [{ column: 'id', op: 'eq', value: orderId }],
        });

        const order = orders[0] as any;

        await notifyKitchenOrderCancelledDB(
          orderId,
          order.order_number,
          items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'PAID').length,
          cancellationData?.reason || 'Sin especificar',
          activeBranchId
        );
      }

      return { orderId, hasDispatchedItems, totalDispatched };
    },
    onSuccess: (data) => {
      toast.success('Orden cancelada');
      qc.invalidateQueries({ queryKey: ['order', data.orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error: any) => {
      console.error('Error cancelando orden:', error);
      toast.error('Error al cancelar orden: ' + error.message);
    },
  });

  return {
    cancelItemMutation,
    cancelOrderMutation,
  };
}

/**
 * Recalcula el total de una orden basado en sus ítems
 */
async function recalculateOrderTotal(orderId: string) {
  try {
    await recalculateOrderTotalDB(orderId);
  } catch (error) {
    console.error('Error recalculando total:', error);
    throw error;
  }
}

/**
 * Notifica a cocina que un ítem fue cancelado
 */
async function notifyKitchenItemCancelled(
  orderId: string,
  itemId: string,
  description: string,
  quantity: number,
  reason: string,
  branchId: string
) {
  try {
    const orders = await dbSelect('orders', {
      select: 'order_number',
      filters: [{ column: 'id', op: 'eq', value: orderId }],
    });

    const order = orders[0] as any;

    await notifyKitchenItemCancelledDB(
      orderId,
      order.order_number,
      itemId,
      description,
      quantity,
      reason,
      branchId
    );
  } catch (error) {
    console.error('Error notificando a cocina:', error);
    // No fallar la cancelación por error en notificación
  }
}

/**
 * Notifica a cocina que una orden fue cancelada
 */
async function notifyKitchenOrderCancelled(
  orderId: string,
  itemCount: number,
  reason: string,
  branchId: string
) {
  try {
    const orders = await dbSelect('orders', {
      select: 'order_number',
      filters: [{ column: 'id', op: 'eq', value: orderId }],
    });

    const order = orders[0] as any;

    await notifyKitchenOrderCancelledDB(
      orderId,
      order.order_number,
      itemCount,
      reason,
      branchId
    );
  } catch (error) {
    console.error('Error notificando cancelación de orden:', error);
  }
}
