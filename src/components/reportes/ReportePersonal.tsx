import React, { useEffect, useMemo, useState } from 'react';
import { useReportesPersonal, type ReportesFilters } from '@/hooks/useReportesOnlineData';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  CalendarDays,
  FileDown,
  Printer,
  RefreshCw,
  ShieldCheck,
  Users,
  UserCheck,
} from 'lucide-react';
import { format } from 'date-fns';

interface ReportePersonalProps {
  filters: ReportesFilters;
}

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'dd/MM/yyyy HH:mm');
  } catch {
    return '—';
  }
}

function shiftLabel(row: { shiftNumber: number | null; shiftCode: string | null; shiftId: string }) {
  if (row.shiftNumber != null) return `Turno #${row.shiftNumber}`;
  if (row.shiftCode) return row.shiftCode;
  return `Turno ${row.shiftId.slice(0, 6)}`;
}

export default function ReportePersonal({ filters }: ReportePersonalProps) {
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const { data, isLoading, error, refetch } = useReportesPersonal(filters);

  const rows = data?.rows || [];
  const kpis = data?.kpis || { personas: 0, turnos: 0, dias: 0, habilitados: 0 };
  const hasRows = rows.length > 0;

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageRows = useMemo(() => rows.slice(startIndex, endIndex), [rows, startIndex, endIndex]);
  const showingFrom = rows.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(endIndex, rows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleExportCSV = () => {
    if (!hasRows) return;

    const headers = [
      'Día',
      'Sucursal',
      'Turno',
      'Apertura turno',
      'Cierre turno',
      'Estado turno',
      'Usuario',
      'Nombre',
      'Habilitado',
      'Roles',
      'Apertura caja',
      'Cierre caja',
      'Estado caja',
    ];

    const csvRows = rows.map((row) => [
      row.dayLabel,
      row.branchName,
      shiftLabel(row),
      formatDateTime(row.shiftOpenedAt),
      formatDateTime(row.shiftClosedAt),
      row.shiftStatus === 'OPEN' ? 'Abierto' : 'Cerrado',
      row.userAlias,
      row.userRealName,
      row.isEnabled ? 'Sí' : 'No',
      row.roles.join(' | '),
      formatDateTime(row.cajaOpenedAt),
      formatDateTime(row.cajaClosedAt),
      row.cajaStatus || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...csvRows.map((cols) =>
        cols.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-personal-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pagination = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground font-medium">
          Mostrando {showingFrom}-{showingTo} de {rows.length}
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="personal-page-size" className="text-xs font-bold whitespace-nowrap">
            Filas por página
          </Label>
          <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
            <SelectTrigger id="personal-page-size" className="h-8 w-[88px] rounded-xl text-xs font-bold">
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
        <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={safeCurrentPage <= 1} className="rounded-xl h-8 text-xs font-bold">
          Primera
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage <= 1} className="rounded-xl h-8 text-xs font-bold">
          Anterior
        </Button>
        <span className="min-w-[88px] text-center text-xs font-bold text-foreground">
          Página {safeCurrentPage} de {totalPages}
        </span>
        <Button variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safeCurrentPage >= totalPages} className="rounded-xl h-8 text-xs font-bold">
          Siguiente
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={safeCurrentPage >= totalPages} className="rounded-xl h-8 text-xs font-bold">
          Última
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Cargando reporte de personal...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-destructive/20 bg-destructive/10 p-6 text-center max-w-lg mx-auto my-8">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="font-display text-base font-bold text-destructive">Error al cargar datos</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {(error as any)?.message || 'Ha ocurrido un error inesperado al consultar Supabase.'}
        </p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4 rounded-xl text-xs font-bold border-destructive/20 hover:bg-destructive/10">
          Reintentar consulta
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-sky-500/10 to-cyan-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-sky-500/15 p-2.5 text-sky-700">
                <Users className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Personas</p>
            <p className="mt-1 font-display text-2xl font-black text-foreground">{kpis.personas}</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-amber-500/10 to-orange-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-amber-500/15 p-2.5 text-amber-700">
                <CalendarDays className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Días</p>
            <p className="mt-1 font-display text-2xl font-black text-foreground">{kpis.dias}</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-violet-500/10 to-indigo-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-violet-500/15 p-2.5 text-violet-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Turnos</p>
            <p className="mt-1 font-display text-2xl font-black text-foreground">{kpis.turnos}</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-700">
                <UserCheck className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Asignaciones habilitadas</p>
            <p className="mt-1 font-display text-2xl font-black text-foreground">{kpis.habilitados}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Personal asignado a turnos del rango seleccionado. El día corresponde a la apertura del turno.
          No es un reloj de asistencia minuto a minuto.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-xl h-9 text-xs font-bold gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!hasRows} className="rounded-xl h-9 text-xs font-bold gap-1.5">
            <FileDown className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!hasRows} className="rounded-xl h-9 text-xs font-bold gap-1.5">
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </Button>
        </div>
      </div>

      {pagination}

      {!hasRows ? (
        <div className="rounded-3xl border border-dashed border-orange-200 bg-orange-50/40 px-4 py-12 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Sin personal en el rango</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No hay turnos con usuarios asignados para los filtros aplicados.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border/80 bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-bold">Día</TableHead>
                  <TableHead className="text-xs font-bold">Turno</TableHead>
                  <TableHead className="text-xs font-bold">Usuario</TableHead>
                  <TableHead className="text-xs font-bold">Nombre</TableHead>
                  <TableHead className="text-xs font-bold">Estado</TableHead>
                  <TableHead className="text-xs font-bold">Roles</TableHead>
                  <TableHead className="text-xs font-bold">Caja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow key={row.rowKey}>
                    <TableCell className="text-xs font-semibold whitespace-nowrap">
                      <div>{row.dayLabel}</div>
                      <div className="text-[10px] text-muted-foreground font-medium">
                        {formatDateTime(row.shiftOpenedAt)}
                        {row.shiftClosedAt ? ` → ${format(new Date(row.shiftClosedAt), 'HH:mm')}` : ' → abierto'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-semibold whitespace-nowrap">
                      <div>{shiftLabel(row)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {row.shiftStatus === 'OPEN' ? 'Abierto' : 'Cerrado'} · {row.branchName}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-bold">{row.userAlias}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.userRealName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.isEnabled
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-bold'
                            : 'border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold'
                        }
                      >
                        {row.isEnabled ? 'Habilitado' : 'Deshabilitado'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {row.roles.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">Sin roles</span>
                        ) : (
                          row.roles.map((role) => (
                            <Badge key={`${row.rowKey}-${role}`} variant="secondary" className="text-[10px] font-bold rounded-lg">
                              {role}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {row.cajaOpenedAt ? (
                        <div>
                          <div className="font-semibold">{formatDateTime(row.cajaOpenedAt)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {row.cajaClosedAt ? `Cierre ${format(new Date(row.cajaClosedAt), 'HH:mm')}` : 'Caja abierta'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Sin apertura</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {pagination}
    </div>
  );
}
