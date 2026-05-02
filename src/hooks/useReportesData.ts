import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dbSelect } from '@/services/DatabaseService';
import { localDb } from '@/services/localDb';
import { processSyncQueue, getPendingSyncCount } from '@/services/SyncService';
import { useBranch } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildUserDisplayMap } from '@/lib/userDisplay';

export interface OrderWithStatus {
  id: string;
  order_number: number | null;
  order_code: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  total: number;
  items_count: number;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
  source: 'local' | 'supabase';
}

/**
 * Hook para obtener datos de ordenes tanto locales como remotas
 */
export function useReportesData() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  // Ordenes locales (IndexedDB)
  const localOrders = useQuery({
    queryKey: ['reports-local-orders'],
    queryFn: async () => {
      const orders = await localDb.orders.toArray();
      const creatorIds = Array.from(new Set(orders.map((order) => order.created_by).filter(Boolean))) as string[];
      const creatorProfiles = navigator.onLine && creatorIds.length > 0
        ? (await dbSelect<any>('profiles', {
          select: 'id, first_name, full_name, username, email',
          filters: [{ column: 'id', op: 'in', value: creatorIds }],
        }))
        : [];
      const creatorNameMap = buildUserDisplayMap(creatorProfiles);
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
          created_by: order.created_by ?? null,
          created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? 'Usuario') : null,
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

  // Ordenes remotas (Supabase)
  const remoteOrders = useQuery({
    queryKey: ['reports-remote-orders', activeBranchId],
    queryFn: async () => {
      if (!navigator.onLine || !activeBranchId) {
        return [];
      }

      try {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('id, order_number, order_code, status, created_by, created_at, order_items(total)')
          .eq('branch_id', activeBranchId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        const creatorIds = Array.from(new Set((orders || []).map((order: any) => order.created_by).filter(Boolean))) as string[];
        const creatorProfiles = creatorIds.length > 0
          ? await dbSelect<any>('profiles', {
            select: 'id, first_name, full_name, username, email',
            filters: [{ column: 'id', op: 'in', value: creatorIds }],
          })
          : [];
        const creatorNameMap = buildUserDisplayMap(creatorProfiles);

        return (orders || []).map((order: any) => ({
          id: order.id,
          order_number: order.order_number,
          order_code: order.order_code,
          status: order.status,
          created_at: order.created_at,
          created_by: order.created_by ?? null,
          created_by_name: order.created_by ? (creatorNameMap[order.created_by] ?? 'Usuario') : null,
          total: order.order_items?.reduce((sum: number, item: any) => sum + (item.total || 0), 0) || 0,
          items_count: order.order_items?.length || 0,
          sync_status: 'synced' as const,
          source: 'supabase' as const,
        }));
      } catch (error) {
        console.error('Error fetching remote orders:', error);
        return [];
      }
    },
    refetchInterval: 60000, // Reduced frequency (1 min) for performance
    enabled: navigator.onLine && !!activeBranchId,
  });

  // Contador de pendientes
  const pendingCount = useQuery({
    queryKey: ['sync-pending-count'],
    queryFn: async () => {
      return await getPendingSyncCount();
    },
    refetchInterval: 5000,
  });

  // Mutacion para sincronizar
  const syncMutation = useMutation({
    mutationFn: async () => {
      const result = await processSyncQueue();
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Sincronizacion completada: ${result.processed} registros`);
      qc.invalidateQueries({ queryKey: ['reports-local-orders'] });
      qc.invalidateQueries({ queryKey: ['reports-remote-orders'] });
      qc.invalidateQueries({ queryKey: ['sync-pending-count'] });
    },
    onError: (error: any) => {
      toast.error('Error en sincronizacion: ' + error.message);
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
