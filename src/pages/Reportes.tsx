import { useState } from 'react';
import { useReportesData } from '@/hooks/useReportesData';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const Reportes = () => {
  const getOrderRef = (orderCode: string | null | undefined, orderNumber: number | null | undefined) => {
    if (orderCode && orderCode.trim().length > 0) return orderCode;
    if (typeof orderNumber === "number") return String(orderNumber);
    return "SIN-CODIGO";
  };
  const {
    localOrders,
    remoteOrders,
    pendingCount,
    syncMutation,
    isOnline,
  } = useReportesData();

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      DRAFT: 'secondary',
      SENT_TO_KITCHEN: 'outline',
      READY: 'outline',
      KITCHEN_DISPATCHED: 'outline',
      PAID: 'default',
      CANCELLED: 'destructive',
    };
    return variants[status] || 'default';
  };

  const getSyncStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      synced: 'default',
      pending_create: 'secondary',
      pending_update: 'secondary',
      pending_delete: 'destructive',
    };
    return variants[status] || 'secondary';
  };

  const formatDate = (date: string) => {
    return formatDistanceToNow(new Date(date), {
      addSuffix: true,
      locale: es,
    });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            Reportes de Ordenes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ver todas las ordenes (locales y sincronizadas)
          </p>
        </div>

        {/* Estado de conexion */}
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Badge className="bg-green-600">🟢 Online</Badge>
          ) : (
            <Badge variant="destructive">🔴 Offline</Badge>
          )}
          
          {pendingCount.data !== undefined && pendingCount.data > 0 && (
            <Badge variant="secondary">
              ⏳ {pendingCount.data} pendientes
            </Badge>
          )}
        </div>
      </div>

      {/* Boton de sincronizacion */}
      {pendingCount.data !== undefined && pendingCount.data > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <p className="text-sm text-yellow-800">
              Tienes {pendingCount.data} operaciones pendientes de sincronizar
            </p>
          </div>
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !isOnline}
            size="sm"
          >
            {syncMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Sincronizar ahora
              </>
            )}
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="local" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="local">
            📱 Locales ({localOrders.data?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="remote">
            ☁️ Sincronizadas ({remoteOrders.data?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Tab: Ordenes Locales */}
        <TabsContent value="local" className="mt-4">
          {localOrders.isLoading ? (
            <div className="flex justify-center items-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : localOrders.data?.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              <p className="text-sm">No hay ordenes locales</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Orden #</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Sincronizacion</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localOrders.data?.map((order) => (
                    <TableRow key={order.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono font-semibold">
                        {getOrderRef(order.order_code, order.order_number)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadge(order.status)}>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {order.items_count}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ${order.total.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getSyncStatusBadge(order.sync_status)}>
                          {order.sync_status === 'synced'
                            ? '✅ Sincronizado'
                            : '⏳ Pendiente'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(order.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Tab: Ordenes Sincronizadas */}
        <TabsContent value="remote" className="mt-4">
          {!isOnline ? (
            <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-8 text-center">
              <AlertCircle className="w-6 h-6 text-yellow-600 mx-auto mb-2" />
              <p className="text-sm text-yellow-800">
                No estas conectado. Activa tu conexion para ver ordenes sincronizadas.
              </p>
            </div>
          ) : remoteOrders.isLoading ? (
            <div className="flex justify-center items-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : remoteOrders.data?.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              <p className="text-sm">No hay ordenes sincronizadas en Supabase</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Orden #</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-center">Fuente</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remoteOrders.data?.map((order) => (
                    <TableRow key={order.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono font-semibold">
                        {getOrderRef(order.order_code, order.order_number)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadge(order.status)}>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {order.items_count}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ${order.total.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="default">Supabase</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(order.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-600 font-semibold">Ordenes Locales</p>
          <p className="text-2xl font-bold text-blue-900 mt-2">
            {localOrders.data?.length || 0}
          </p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-600 font-semibold">Sincronizadas</p>
          <p className="text-2xl font-bold text-green-900 mt-2">
            {remoteOrders.data?.length || 0}
          </p>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <p className="text-sm text-orange-600 font-semibold">Pendientes</p>
          <p className="text-2xl font-bold text-orange-900 mt-2">
            {pendingCount.data || 0}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Reportes;


