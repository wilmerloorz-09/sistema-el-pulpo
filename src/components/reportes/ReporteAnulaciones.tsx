import React from 'react';
import { useReportesAnulaciones } from '@/hooks/useReportesOnlineData';
import { getOrderRef } from '@/lib/orderPresentation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { FileDown, Printer, AlertTriangle, ShieldCheck, ClipboardX, ShieldAlert, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { formatReporteMoney, formatReporteNumber } from '@/lib/reportesFormat';

interface ReporteAnulacionesProps {
  filters: any;
}

export default function ReporteAnulaciones({ filters }: ReporteAnulacionesProps) {
  const { data, isLoading, error, refetch } = useReportesAnulaciones(filters);

  const voids = data?.voids || [];
  const kpis = data?.kpis || { totalAnulado: 0, incidentes: 0, topSupervisor: 'Ninguno' };

  // Exportar a CSV UTF-8 con BOM
  const handleExportCSV = () => {
    if (voids.length === 0) return;

    const headers = [
      'Orden Historica Ref',
      'Orden Sucesora Ref',
      'Fecha Solicitud',
      'Fecha Aprobacion',
      'Cajero Solicitante',
      'Supervisor Autorizante',
      'Motivo Anulacion',
      'Monto Devuelto ($)',
      'ID Re-emision'
    ];

    const rows = voids.map((v) => [
      getOrderRef(v.orderCode, v.orderNumber),
      v.successorId ? getOrderRef(v.successorCode, v.successorNumber) : 'Ninguna (Total)',
      format(new Date(v.createdAt), 'dd/MM/yyyy HH:mm:ss'),
      v.approvedAt ? format(new Date(v.approvedAt), 'dd/MM/yyyy HH:mm:ss') : 'N/A',
      v.cashierName,
      v.supervisorName,
      v.reason,
      formatReporteNumber(v.refundAmount),
      v.replacementPaymentId || 'N/A'
    ]);

    const csvRows = [headers.join(';'), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))];
    const csvContent = '\uFEFF' + csvRows.join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_anulaciones_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Cargando reporte de auditoría...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-destructive/20 bg-destructive/10 p-6 text-center max-w-lg mx-auto my-8">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="font-display text-base font-bold text-destructive">Error al cargar datos</h3>
        <p className="text-xs text-muted-foreground mt-1">{(error as any)?.message || 'Ha ocurrido un error inesperado al consultar Supabase.'}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4 rounded-xl text-xs font-bold border-destructive/20 hover:bg-destructive/10">
          Reintentar consulta
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        {/* KPI: Total Anulado */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-rose-500/10 to-pink-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-rose-500/15 p-2.5 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 rounded-full px-2 py-0.5">
                Fuga Dinero / Contra-cargo
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Monto Anulado</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {formatReporteMoney(kpis.totalAnulado)}
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* KPI: Incidentes */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-amber-500/10 to-yellow-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
                <ClipboardX className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 rounded-full px-2 py-0.5">
                Auditoría
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cantidad de Incidentes</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.incidentes} <span className="text-xs font-normal text-muted-foreground">anulaciones</span>
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* KPI: Top Supervisor */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-indigo-500/10 to-violet-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-indigo-500/15 p-2.5 text-indigo-600 dark:text-indigo-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-500/10 rounded-full px-2 py-0.5">
                Top Autorizante
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Supervisor Principal</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5 truncate" title={kpis.topSupervisor}>
                {kpis.topSupervisor}
              </h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acciones y Tabla */}
      <div className="space-y-4">
        <div className="flex justify-between items-center print:hidden">
          <h4 className="font-display text-sm font-bold text-foreground">Bitácora de Anulaciones y Devoluciones</h4>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <Printer className="h-4 w-4" />
              Imprimir Bitácora
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={voids.length === 0}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {voids.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
            <h4 className="font-display text-sm font-bold text-foreground">No se registraron anulaciones</h4>
            <p className="text-xs text-muted-foreground mt-1">No existen solicitudes aprobadas en el rango y criterios especificados.</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/80 bg-card overflow-hidden shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-bold text-foreground py-3">Orden Histórica</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Orden Sucesora</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Fecha Solicitud</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Fecha Aprobación</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Cajero Solicitante</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Supervisor</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Motivo Anulación</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right">Monto Devuelto</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-center">ID Re-emisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voids.map((v) => (
                  <TableRow key={v.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono font-bold text-xs text-rose-700 dark:text-rose-400">
                      {getOrderRef(v.orderCode, v.orderNumber)}
                    </TableCell>
                    <TableCell className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">
                      {v.successorId ? getOrderRef(v.successorCode, v.successorNumber) : (
                        <span className="text-muted-foreground font-normal italic">Ninguna (Total)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(v.createdAt), 'dd/MM/yy HH:mm')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {v.approvedAt ? format(new Date(v.approvedAt), 'dd/MM/yy HH:mm') : 'N/A'}
                    </TableCell>
                    <TableCell className="text-xs text-foreground font-semibold">
                      {v.cashierName}
                    </TableCell>
                    <TableCell className="text-xs text-foreground font-semibold">
                      {v.supervisorName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={v.reason}>
                      {v.reason}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-rose-600">
                      {formatReporteMoney(v.refundAmount)}
                    </TableCell>
                    <TableCell className="text-xs text-center font-mono text-[10px] text-muted-foreground">
                      {v.replacementPaymentId ? (
                        <span className="inline-block rounded-lg px-2 py-0.5 bg-muted border border-border/40 truncate max-w-[80px]" title={v.replacementPaymentId}>
                          {v.replacementPaymentId.substring(0, 8)}...
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
