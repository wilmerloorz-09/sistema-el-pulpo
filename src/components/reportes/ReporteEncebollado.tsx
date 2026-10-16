import {
  useReportesEncebollado,
  ENCEBOLLADO_TAMANO_KEYS,
  ENCEBOLLADO_TAMANO_LABELS,
  type ReportesFilters,
} from '@/hooks/useReportesOnlineData';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, FileDown, Fish, Printer, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface ReporteEncebolladoProps {
  filters: ReportesFilters;
}

function formatCantidad(value: number): string {
  return Number(value ?? 0).toLocaleString('es-EC', {
    maximumFractionDigits: 0,
  });
}

export default function ReporteEncebollado({ filters }: ReporteEncebolladoProps) {
  const { data, isLoading, error, refetch } = useReportesEncebollado(filters);

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const grandTotal = data?.grandTotal ?? 0;

  const handleExportCSV = () => {
    if (rows.length === 0) return;

    const headers = [
      'Sucursal',
      ...ENCEBOLLADO_TAMANO_KEYS.map((key) => ENCEBOLLADO_TAMANO_LABELS[key]),
      'Total',
    ];

    const body = rows.map((row) => [
      row.branchName,
      ...ENCEBOLLADO_TAMANO_KEYS.map((key) => row.counts[key]),
      row.total,
    ]);

    if (totals) {
      body.push([
        'Total',
        ...ENCEBOLLADO_TAMANO_KEYS.map((key) => totals[key]),
        grandTotal,
      ]);
    }

    const csvRows = [
      headers.join(';'),
      ...body.map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(';')),
    ];
    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_encebollados_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Cargando encebollados vendidos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-3xl border-destructive/30 bg-destructive/5">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            {(error as Error)?.message || 'No se pudo cargar el reporte de encebollados.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-800">
            <Fish className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-black text-foreground">Encebollados vendidos</h2>
            <p className="text-xs text-muted-foreground">
              Cantidad de platos cobrados por sucursal y tamaño (pequeño, grande, JR, lleno, sin tamaño y solo líquido).
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={rows.length === 0} className="rounded-xl">
            <FileDown className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="rounded-xl">
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <Card className="rounded-3xl border-border/80 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No hay encebollados vendidos en el rango seleccionado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/70 hover:bg-muted/70">
                    <TableHead className="font-bold text-foreground">Sucursal</TableHead>
                    {ENCEBOLLADO_TAMANO_KEYS.map((key) => (
                      <TableHead key={key} className="font-bold text-foreground text-right">
                        {ENCEBOLLADO_TAMANO_LABELS[key]}
                      </TableHead>
                    ))}
                    <TableHead className="font-bold text-foreground text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.branchId}>
                      <TableCell className="font-medium text-foreground">{row.branchName}</TableCell>
                      {ENCEBOLLADO_TAMANO_KEYS.map((key) => (
                        <TableCell key={key} className="text-right tabular-nums">
                          {formatCantidad(row.counts[key])}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold tabular-nums">
                        {formatCantidad(row.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {totals ? (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell className="font-bold text-foreground">Total</TableCell>
                      {ENCEBOLLADO_TAMANO_KEYS.map((key) => (
                        <TableCell key={key} className="text-right font-bold tabular-nums">
                          {formatCantidad(totals[key])}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-black tabular-nums">
                        {formatCantidad(grandTotal)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
