import React, { useEffect, useMemo, useState } from 'react';
import { useReportesPagos } from '@/hooks/useReportesOnlineData';
import { getOrderRef } from '@/lib/orderPresentation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { FileDown, Printer, Wallet, ArrowUpRight, TrendingUp, ReceiptText, AlertCircle, RefreshCw, ListTree } from 'lucide-react';
import { format } from 'date-fns';
import { formatReporteMoney, formatReporteNumber } from '@/lib/reportesFormat';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ReportePagosProps {
  filters: any;
}

function orderTypeLabel(orderType: string) {
  if (orderType === 'SPECIAL') return 'Especial';
  if (orderType === 'DINE_IN') return 'Mesa';
  if (orderType === 'TAKEOUT') return 'Para Llevar';
  if (orderType === 'EXPRESS') return 'Express';
  return 'Extra/General';
}

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

function isRowVisibleOnScreen(index: number, startIndex: number, endIndex: number) {
  return index >= startIndex && index < endIndex;
}

export default function ReportePagos({ filters }: ReportePagosProps) {
  const [itemBreakdown, setItemBreakdown] = useState(false);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const { data, isLoading, error, refetch } = useReportesPagos(filters, { itemBreakdown });

  const payments = data?.payments || [];
  const itemRows = data?.itemRows || [];
  const kpis = data?.kpis || { totalNeto: 0, desglose: {}, ticketPromedio: 0, transacciones: 0 };

  const tableRows = useMemo(
    () => (itemBreakdown ? itemRows : payments),
    [itemBreakdown, itemRows, payments],
  );
  const hasRows = tableRows.length > 0;

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const showingFrom = tableRows.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(endIndex, tableRows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, itemBreakdown, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Exportar a CSV UTF-8 con BOM para correcta codificación en Excel
  const handleExportCSV = () => {
    if (!hasRows) return;

    if (itemBreakdown) {
      const headers = [
        'Sucursal',
        'Orden Code',
        'Orden Nro',
        'Referencia Orden',
        'Tipo de Orden',
        'Fecha',
        'Hora',
        'Cajero',
        'Usuario Creador',
        'Metodo de Pago',
        'Codigo Producto',
        'Categoria',
        'Item',
        'Cantidad',
        'Precio Unitario ($)',
        'Total Item ($)',
      ];

      const rows = itemRows.map((row) => [
        row.branchName,
        row.orderCode || '',
        row.orderNumber || '',
        getOrderRef(row.orderCode, row.orderNumber),
        orderTypeLabel(row.orderType),
        format(new Date(row.createdAt), 'dd/MM/yyyy'),
        format(new Date(row.createdAt), 'HH:mm:ss'),
        row.cashierName,
        row.creatorName,
        row.methodName,
        row.itemProductCode,
        row.itemCategory,
        row.itemDescription,
        row.itemQuantity,
        formatReporteNumber(row.itemUnitPrice),
        formatReporteNumber(row.itemTotal),
      ]);

      const csvRows = [headers.join(';'), ...rows.map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(';'))];
      const csvContent = '\uFEFF' + csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `reporte_pagos_items_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      'Sucursal',
      'Orden Code',
      'Orden Nro',
      'Referencia Orden',
      'Tipo de Orden',
      'Fecha',
      'Hora',
      'Cajero',
      'Usuario Creador',
      'Metodo de Pago',
      'Monto Recibido ($)',
      'Cambio ($)',
      'Total Neto Aplicado ($)'
    ];

    const rows = payments.map((p) => {
      return [
        p.branchName,
        p.orderCode || '',
        p.orderNumber || '',
        getOrderRef(p.orderCode, p.orderNumber),
        orderTypeLabel(p.orderType),
        format(new Date(p.createdAt), 'dd/MM/yyyy'),
        format(new Date(p.createdAt), 'HH:mm:ss'),
        p.cashierName,
        p.creatorName,
        p.methodName,
        formatReporteNumber(p.amount),
        formatReporteNumber(p.change),
        formatReporteNumber(p.netApplied)
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

  const paginationBar = (
    <div className="flex flex-col gap-3 border-b border-border/80 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          Mostrando {showingFrom}–{showingTo} de {tableRows.length}
        </span>
        <span className="hidden sm:inline">·</span>
        <div className="flex items-center gap-2">
          <Label htmlFor="pagos-page-size" className="text-xs font-bold whitespace-nowrap">
            Filas por página
          </Label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger id="pagos-page-size" className="h-8 w-[88px] rounded-xl text-xs font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)} className="text-xs font-semibold">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(1)}
          disabled={safeCurrentPage <= 1}
          className="rounded-xl h-8 text-xs font-bold"
        >
          Primera
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={safeCurrentPage <= 1}
          className="rounded-xl h-8 text-xs font-bold"
        >
          Anterior
        </Button>
        <span className="min-w-[88px] text-center text-xs font-bold text-foreground">
          Página {safeCurrentPage} de {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={safeCurrentPage >= totalPages}
          className="rounded-xl h-8 text-xs font-bold"
        >
          Siguiente
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(totalPages)}
          disabled={safeCurrentPage >= totalPages}
          className="rounded-xl h-8 text-xs font-bold"
        >
          Última
        </Button>
      </div>
    </div>
  );

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
                {formatReporteMoney(kpis.totalNeto)}
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
                {formatReporteMoney(kpis.ticketPromedio)}
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
                    <span className="text-foreground">{formatReporteMoney(amount as number)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acciones y Tabla */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center print:hidden">
          <div className="space-y-2">
            <h4 className="font-display text-sm font-bold text-foreground">
              {itemBreakdown ? 'Listado Detallado por Ítem' : 'Listado Detallado de Transacciones'}
            </h4>
            <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 w-fit">
              <ListTree className="h-4 w-4 text-primary" />
              <Label htmlFor="desglose-por-item" className="text-xs font-bold cursor-pointer">
                Desglose por ítem
              </Label>
              <Switch
                id="desglose-por-item"
                checked={itemBreakdown}
                onCheckedChange={setItemBreakdown}
              />
            </div>
          </div>
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
              disabled={!hasRows}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {!hasRows ? (
          <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center">
            <ReceiptText className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
            <h4 className="font-display text-sm font-bold text-foreground">
              {itemBreakdown ? 'No se encontraron ítems' : 'No se encontraron pagos'}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">Ajusta los criterios de búsqueda en el panel de filtros superior.</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/80 bg-card overflow-hidden shadow-none">
            {paginationBar}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-bold text-foreground py-3">Sucursal</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Código/Orden</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Tipo</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Fecha</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Hora</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Cajero</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Creador Orden</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-center">Método Pago</TableHead>
                  {itemBreakdown ? (
                    <>
                      <TableHead className="font-bold text-foreground py-3">Código producto</TableHead>
                      <TableHead className="font-bold text-foreground py-3">Categoría</TableHead>
                      <TableHead className="font-bold text-foreground py-3">Ítem</TableHead>
                      <TableHead className="font-bold text-foreground py-3 text-right">Cant.</TableHead>
                      <TableHead className="font-bold text-foreground py-3 text-right">P. Unit.</TableHead>
                      <TableHead className="font-bold text-foreground py-3 text-right">Total Ítem</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="font-bold text-foreground py-3 text-right">Monto Recibido</TableHead>
                      <TableHead className="font-bold text-foreground py-3 text-right">Cambio</TableHead>
                      <TableHead className="font-bold text-foreground py-3 text-right">Total Neto</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemBreakdown
                  ? itemRows.map((row, index) => (
                      <TableRow
                        key={row.rowKey}
                        className={cn(
                          'hover:bg-muted/30',
                          !isRowVisibleOnScreen(index, startIndex, endIndex) && 'hidden print:table-row',
                        )}
                      >
                        <TableCell className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {row.branchName}
                        </TableCell>
                        <TableCell className="font-mono font-bold text-xs">
                          {getOrderRef(row.orderCode, row.orderNumber)}
                        </TableCell>
                        <TableCell className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                          {orderTypeLabel(row.orderType)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(row.createdAt), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(row.createdAt), 'HH:mm:ss')}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-foreground">
                          {row.cashierName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.creatorName}
                        </TableCell>
                        <TableCell className="text-xs text-center font-bold">
                          <span className="inline-block rounded-lg px-2 py-0.5 bg-muted border border-border/40 text-[10px]">
                            {row.methodName}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold text-foreground whitespace-nowrap">
                          {row.itemProductCode}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {row.itemCategory}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-foreground max-w-[220px]">
                          <span className="line-clamp-2">{row.itemDescription}</span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-muted-foreground">
                          {row.itemQuantity}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-muted-foreground">
                          {formatReporteMoney(row.itemUnitPrice)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-bold text-foreground">
                          {formatReporteMoney(row.itemTotal)}
                        </TableCell>
                      </TableRow>
                    ))
                  : payments.map((p, index) => (
                      <TableRow
                        key={p.id}
                        className={cn(
                          'hover:bg-muted/30',
                          !isRowVisibleOnScreen(index, startIndex, endIndex) && 'hidden print:table-row',
                        )}
                      >
                        <TableCell className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {p.branchName}
                        </TableCell>
                        <TableCell className="font-mono font-bold text-xs">
                          {getOrderRef(p.orderCode, p.orderNumber)}
                        </TableCell>
                        <TableCell className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                          {orderTypeLabel(p.orderType)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(p.createdAt), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(p.createdAt), 'HH:mm:ss')}
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
                          {formatReporteMoney(p.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-muted-foreground">
                          {formatReporteMoney(p.change)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-bold text-foreground">
                          {formatReporteMoney(p.netApplied)}
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
