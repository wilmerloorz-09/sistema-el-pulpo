import React from 'react';
import { useReportesPagos } from '@/hooks/useReportesOnlineData';
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
import { FileDown, Printer, Wallet, ArrowUpRight, TrendingUp, ReceiptText, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ReportePagosProps {
  filters: any;
}

export default function ReportePagos({ filters }: ReportePagosProps) {
  const { data, isLoading, error, refetch } = useReportesPagos(filters);

  const payments = data?.payments || [];
  const kpis = data?.kpis || { totalNeto: 0, desglose: {}, ticketPromedio: 0, transacciones: 0 };

  // Exportar a CSV UTF-8 con BOM para correcta codificación en Excel
  const handleExportCSV = () => {
    if (payments.length === 0) return;

    const headers = [
      'Orden Code',
      'Orden Nro',
      'Referencia Orden',
      'Tipo de Orden',
      'Fecha y Hora',
      'Cajero',
      'Usuario Creador',
      'Metodo de Pago',
      'Monto Recibido ($)',
      'Cambio ($)',
      'Total Neto Aplicado ($)'
    ];

    const rows = payments.map((p) => {
      const typeName = p.orderType === 'DINE_IN' ? 'Mesa' : p.orderType === 'TAKEOUT' ? 'Para Llevar' : p.orderType === 'EXPRESS' ? 'Express' : 'Extra/General';
      return [
        p.orderCode || '',
        p.orderNumber || '',
        getOrderRef(p.orderCode, p.orderNumber),
        typeName,
        format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm:ss'),
        p.cashierName,
        p.creatorName,
        p.methodName,
        p.amount.toFixed(2),
        p.change.toFixed(2),
        p.netApplied.toFixed(2)
      ];
    });

    // Usamos ';' como separador y comillas para evitar problemas de formato regional
    const csvRows = [headers.join(';'), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))];
    const csvContent = '\uFEFF' + csvRows.join('\n'); // \uFEFF es el BOM de UTF-8
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_pagos_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
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
        <p className="text-sm text-muted-foreground font-medium">Cargando reporte de pagos...</p>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        {/* KPI: Total Neto */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-600 dark:text-emerald-400">
                <Wallet className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5">
                <TrendingUp className="h-3 w-3" />
                Ingresos Reales
              </div>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total General Recaudado</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                ${kpis.totalNeto.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* KPI: Ticket Promedio */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-blue-500/10 to-sky-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-600 dark:text-blue-400">
                <ArrowUpRight className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-500/10 rounded-full px-2 py-0.5">
                Promedio
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Ticket Promedio por Orden</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                ${kpis.ticketPromedio.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* KPI: Transacciones */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-indigo-500/10 to-violet-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-indigo-500/15 p-2.5 text-indigo-600 dark:text-indigo-400">
                <ReceiptText className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-500/10 rounded-full px-2 py-0.5">
                Ventas
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Transacciones Cobradas</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.transacciones} <span className="text-xs font-normal text-muted-foreground">pagos</span>
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* KPI: Desglose Métodos */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 shadow-none">
          <CardContent className="p-4 space-y-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Métodos de Pago</span>
            <div className="space-y-1.5 pt-0.5">
              {Object.keys(kpis.desglose).length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">Sin transacciones</p>
              ) : (
                Object.entries(kpis.desglose).map(([method, amount]) => (
                  <div key={method} className="flex justify-between items-center text-xs font-bold">
                    <span className="text-muted-foreground">{method}:</span>
                    <span className="text-foreground">${(amount as number).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acciones y Tabla */}
      <div className="space-y-4">
        <div className="flex justify-between items-center print:hidden">
          <h4 className="font-display text-sm font-bold text-foreground">Listado Detallado de Transacciones</h4>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <Printer className="h-4 w-4" />
              Imprimir Reporte
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={payments.length === 0}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {payments.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center">
            <ReceiptText className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
            <h4 className="font-display text-sm font-bold text-foreground">No se encontraron pagos</h4>
            <p className="text-xs text-muted-foreground mt-1">Ajusta los criterios de búsqueda en el panel de filtros superior.</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/80 bg-card overflow-hidden shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-bold text-foreground py-3">Código/Orden</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Tipo</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Fecha y Hora</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Cajero</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Creador Orden</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-center">Método Pago</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right">Monto Recibido</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right">Cambio</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right">Total Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono font-bold text-xs">
                      {getOrderRef(p.orderCode, p.orderNumber)}
                    </TableCell>
                    <TableCell className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                      {p.orderType === 'DINE_IN' ? 'Mesa' : p.orderType === 'TAKEOUT' ? 'Para Llevar' : p.orderType === 'EXPRESS' ? 'Express' : 'Extra'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-foreground">
                      {p.cashierName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.creatorName}
                    </TableCell>
                    <TableCell className="text-xs text-center font-bold">
                      <span className="inline-block rounded-lg px-2 py-0.5 bg-muted border border-border/40 text-[10px]">
                        {p.methodName}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right font-medium text-muted-foreground">
                      ${p.amount.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-medium text-muted-foreground">
                      ${p.change.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-foreground">
                      ${p.netApplied.toFixed(2)}
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
