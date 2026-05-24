import React from 'react';
import { useReportesProductos } from '@/hooks/useReportesOnlineData';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import { FileDown, Printer, Award, Soup, TrendingUp, BarChart3, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface ReporteProductosProps {
  filters: any;
}

export default function ReporteProductos({ filters }: ReporteProductosProps) {
  const { data, isLoading, error, refetch } = useReportesProductos(filters);

  const productsSold = data?.productsSold || [];
  const kpis = data?.kpis || { top3: [], totalUnidades: 0 };
  const trendData = data?.rawTimeData || [];

  // Traducir tipos de orden para display
  const ORDER_TYPE_LABELS: Record<string, string> = {
    DINE_IN: '🍽️ Mesas',
    TAKEOUT: '🛍️ Para Llevar',
    EXPRESS: '🚀 Express',
    EXTRA: '📋 Extra',
    SPECIAL: '🌟 Especial',
  };

  const handleExportCSV = () => {
    if (productsSold.length === 0) return;

    const headers = [
      'ID Producto',
      'Producto',
      'Categoria',
      'Cantidad Vendida',
      'Tipo de Orden Predominante',
      'Precio Unitario Promedio ($)',
      'Total Recaudado ($)'
    ];

    const rows = productsSold.map((p) => [
      p.productId,
      p.name,
      p.category,
      p.quantityTotal,
      ORDER_TYPE_LABELS[p.orderTypePredominante] || p.orderTypePredominante,
      p.unitPriceAverage.toFixed(2),
      p.totalRecaudado.toFixed(2)
    ]);

    const csvRows = [headers.join(';'), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))];
    const csvContent = '\uFEFF' + csvRows.join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_productos_vendidos_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
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
        <p className="text-sm text-muted-foreground font-medium">Cargando métricas de productos...</p>
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
        {/* KPI: Total Unidades */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-violet-500/10 to-indigo-500/5 shadow-none">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-violet-500/15 p-2.5 text-violet-600 dark:text-violet-400">
                <Soup className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-violet-600 bg-violet-500/10 rounded-full px-2 py-0.5">
                Volumen
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Total Unidades Despachadas</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.totalUnidades} <span className="text-xs font-normal text-muted-foreground">platos/ítems</span>
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* Top 1, 2, 3 Platos Estrella */}
        {kpis.top3.map((p: any, idx: number) => {
          const cardColors = [
            'from-amber-500/10 to-yellow-500/5 border-amber-200/60',
            'from-slate-400/10 to-zinc-400/5 border-slate-200/60',
            'from-amber-700/10 to-orange-700/5 border-amber-700/20'
          ];
          const badgeLabels = ['🥇 Top 1', '🥈 Top 2', '🥉 Top 3'];
          const textColors = ['text-amber-600', 'text-slate-500', 'text-amber-800'];

          return (
            <Card key={p.name} className={`overflow-hidden rounded-3xl border bg-gradient-to-br shadow-none ${cardColors[idx] || 'from-muted/50 to-muted/30'}`}>
              <CardContent className="p-5 flex flex-col justify-between h-full">
                <div className="flex justify-between items-start">
                  <div className={`rounded-2xl p-2 bg-background/50 ${textColors[idx] || 'text-foreground'}`}>
                    <Award className="h-5 w-5" />
                  </div>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 bg-background/60 ${textColors[idx] || 'text-foreground'}`}>
                    {badgeLabels[idx] || `Top ${idx + 1}`}
                  </span>
                </div>
                <div className="mt-4">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block truncate" title={p.name}>
                    {p.name}
                  </span>
                  <h3 className="font-display text-base font-black text-foreground mt-0.5 truncate">
                    {p.qty} vendidos <span className="text-xs font-normal text-muted-foreground">(${p.total.toFixed(2)})</span>
                  </h3>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Fallbacks si no hay suficientes Top items */}
        {Array.from({ length: Math.max(0, 3 - kpis.top3.length) }).map((_, i) => (
          <Card key={i} className="overflow-hidden rounded-3xl border border-dashed border-border/80 shadow-none">
            <CardContent className="p-5 flex items-center justify-center h-full text-center">
              <span className="text-xs text-muted-foreground italic">Sin plato estrella disponible</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Accordion Gráfico de Tendencias */}
      {trendData.length > 0 && (
        <div className="print:hidden">
          <Accordion type="single" collapsible defaultValue="grafico" className="w-full">
            <AccordionItem value="grafico" className="border-none rounded-3xl bg-card border border-border/80 px-5 shadow-none">
              <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <span className="font-display text-sm font-bold text-foreground">Visualización de Tendencia de Venta</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-5 pt-2">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          borderRadius: '16px',
                          border: '1px solid hsl(var(--border))',
                          fontSize: '11px',
                        }}
                        formatter={(value: any, name: string) => {
                          if (name === 'ventas') return [`$${value.toFixed(2)}`, 'Ventas Netas'];
                          if (name === 'ordenes') return [value, 'Cant. Órdenes'];
                          return [value, name];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="ventas"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorVentas)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Acciones y Tabla */}
      <div className="space-y-4">
        <div className="flex justify-between items-center print:hidden">
          <h4 className="font-display text-sm font-bold text-foreground">Rendimiento de Productos en Cocina y Cajas</h4>
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
              disabled={productsSold.length === 0}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {productsSold.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center">
            <Soup className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
            <h4 className="font-display text-sm font-bold text-foreground">No se registraron ventas</h4>
            <p className="text-xs text-muted-foreground mt-1">Ajusta los filtros o comprueba que se hayan despachado/cobrado órdenes.</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/80 bg-card overflow-hidden shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-bold text-foreground py-3">Nombre del Producto</TableHead>
                  <TableHead className="font-bold text-foreground py-3">Categoría</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-center">Cantidad Vendida</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-center">Orden Predominante</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right">Precio Unitario</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-right font-black">Total Recaudado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsSold.map((p, idx) => (
                  <TableRow key={`${p.productId}-${p.unitPriceAverage}`} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-bold text-foreground">
                      <div className="flex items-center gap-2">
                        {idx < 3 && <span className="text-amber-500 font-bold">★</span>}
                        {p.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.category}
                    </TableCell>
                    <TableCell className="text-xs text-center font-bold text-foreground">
                      {p.quantityTotal}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      <span className="inline-block rounded-lg px-2 py-0.5 bg-muted text-[10px] font-semibold text-foreground/80">
                        {ORDER_TYPE_LABELS[p.orderTypePredominante] || p.orderTypePredominante}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">
                      ${p.unitPriceAverage.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-black text-foreground">
                      ${p.totalRecaudado.toFixed(2)}
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
