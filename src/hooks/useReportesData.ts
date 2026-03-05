import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dbSelect } from '@/services/DatabaseService';
import { localDb } from '@/services/localDb';
import { processSyncQueue, getPendingSyncCount } from '@/services/SyncService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OrderWithStatus {
  id: string;
  order_number: number;
  order_code: string | null;
  status: string;
  created_at: string;
  total: number;
  items_count: number;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
  source: 'local' | 'supabase';
}

/**
 * Hook para obtener datos de órdenes tanto locales como remotas
 */
export function useReportesData() {
  const qc = useQueryClient();

  // Órdenes locales (IndexedDB)
  const localOrders = useQuery({
    queryKey: ['reports-local-orders'],
    queryFn: async () => {
      const orders = await localDb.orders.toArray();
      const result: OrderWithStatus[] = [];

      for (const order of orders) {
        const items = await localDb.order_items
          .where('order_id')
          .equals(order.id)
          .toArray();

        const total = items.reduce((sum, item) => sum + item.total, 0);

        result.push({
          id: order.id,
          order_number: order.order_number,
          order_code: order.order_code,
          status: order.status,
          created_at: order.created_at,
          total,
          items_count: items.length,
          sync_status: order._sync_status,
          source: 'local',
        });
      }

      return result.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    refetchInterval: 5000, // Actualizar cada 5s
  });

  // Órdenes remotas (Supabase)
  const remoteOrders = useQuery({
    queryKey: ['reports-remote-orders'],
    queryFn: async () => {
      if (!navigator.onLine) {
        return [];
      }

      try {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('id, order_number, order_code, status, created_at')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const result: OrderWithStatus[] = [];

        for (const order of orders || []) {
          const { data: items } = await supabase
            .from('order_items')
            .select('total')
            .eq('order_id', order.id);

          const total = items?.reduce((sum, item) => sum + item.total, 0) || 0;

          result.push({
            id: order.id,
            order_number: order.order_number,
            order_code: order.order_code,
            status: order.status,
            created_at: order.created_at,
            total,
            items_count: items?.length || 0,
            sync_status: 'synced',
            source: 'supabase',
          });
        }

        return result;
      } catch (error) {
        console.error('Error fetching remote orders:', error);
        return [];
      }
    },
    refetchInterval: 10000, // Actualizar cada 10s
    enabled: navigator.onLine,
  });

  // Contador de pendientes
  const pendingCount = useQuery({
    queryKey: ['sync-pending-count'],
    queryFn: async () => {
      return await getPendingSyncCount();
    },
    refetchInterval: 5000,
  });

  // Mutación para sincronizar
  const syncMutation = useMutation({
    mutationFn: async () => {
      const result = await processSyncQueue();
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Sincronización completada: ${result.processed} registros`);
      qc.invalidateQueries({ queryKey: ['reports-local-orders'] });
      qc.invalidateQueries({ queryKey: ['reports-remote-orders'] });
      qc.invalidateQueries({ queryKey: ['sync-pending-count'] });
    },
    onError: (error: any) => {
      toast.error('Error en sincronización: ' + error.message);
    },
  });

  return {
    localOrders,
    remoteOrders,
    pendingCount,
    syncMutation,
    isOnline: navigator.onLine,
  };
}
