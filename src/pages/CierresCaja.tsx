import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { toast } from "sonner";
import { FileText, Loader2, Lock, Printer, Search } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { hasPermission } from "@/lib/permissions";
import {
  listClosedCashOpenings,
  listShiftsForBranchInRange,
  openClosedOpeningCashReport,
  type ClosedOpeningListRow,
} from "@/lib/openingCashReport";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function toLocalInputValue(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value: number) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function shiftLabel(row: {
  shift_number: number | null;
  shift_code: string | null;
  shift_opened_at: string;
  id?: string;
  shift_id?: string;
}) {
  const num = row.shift_number ?? (row.shift_code ? null : (row.shift_id ?? row.id ?? "").slice(0, 5));
  const when = formatDateTime(row.shift_opened_at);
  if (row.shift_code) return `${row.shift_code} · ${when}`;
  return `Turno #${num} · ${when}`;
}

const CierresCaja = () => {
  const { permissions, isGlobalAdmin, activeBranchId, activeBranch } = useBranch();

  const canAccessAdmin =
    Boolean(isGlobalAdmin)
    || hasPermission(permissions, "admin_sucursal", "VIEW")
    || hasPermission(permissions, "admin_global", "VIEW");

  const now = new Date();
  const [desde, setDesde] = useState(() => toLocalInputValue(startOfDay(subDays(now, 7))));
  const [hasta, setHasta] = useState(() => toLocalInputValue(endOfDay(now)));
  const [shiftId, setShiftId] = useState<string>("ALL");
  const [cashierId, setCashierId] = useState<string>("ALL");
  const [printingId, setPrintingId] = useState<string | null>(null);

  const desdeIso = useMemo(() => new Date(desde).toISOString(), [desde]);
  const hastaIso = useMemo(() => new Date(hasta).toISOString(), [hasta]);

  const shiftsQuery = useQuery({
    queryKey: ["cierres-caja-shifts", activeBranchId, desdeIso, hastaIso],
    enabled: Boolean(activeBranchId) && canAccessAdmin,
    queryFn: () => listShiftsForBranchInRange({
      branchId: activeBranchId!,
      desdeIso,
      hastaIso,
    }),
  });

  const openingsQuery = useQuery({
    queryKey: ["cierres-caja-openings", activeBranchId, desdeIso, hastaIso, shiftId, cashierId],
    enabled: Boolean(activeBranchId) && canAccessAdmin,
    queryFn: () => listClosedCashOpenings({
      branchId: activeBranchId!,
      desdeIso,
      hastaIso,
      shiftId: shiftId === "ALL" ? null : shiftId,
      cashierId: cashierId === "ALL" ? null : cashierId,
    }),
  });

  const cashiersQuery = useQuery({
    queryKey: ["cierres-caja-cashiers", activeBranchId, desdeIso, hastaIso, shiftId],
    enabled: Boolean(activeBranchId) && canAccessAdmin,
    queryFn: () => listClosedCashOpenings({
      branchId: activeBranchId!,
      desdeIso,
      hastaIso,
      shiftId: shiftId === "ALL" ? null : shiftId,
      cashierId: null,
      limit: 200,
    }),
  });

  const cashierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of cashiersQuery.data ?? []) {
      if (!map.has(row.cashier_id)) {
        map.set(row.cashier_id, row.cashier_username || row.cashier_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [cashiersQuery.data]);

  const handleReprint = async (row: ClosedOpeningListRow) => {
    if (!activeBranchId) return;
    setPrintingId(row.id);
    const toastId = `cierre-${row.id}`;
    toast.loading("Generando reporte de cierre...", { id: toastId });
    try {
      await openClosedOpeningCashReport({
        openingId: row.id,
        branchId: activeBranchId,
        branchName: activeBranch?.name ?? "Sucursal",
      });
      toast.success("Reporte listo", { id: toastId });
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "No se pudo generar el reporte", { id: toastId });
    } finally {
      setPrintingId(null);
    }
  };

  if (!canAccessAdmin) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Solo usuarios administrador pueden consultar y reimprimir cierres de caja históricos.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="p-6">
        <Card className="rounded-[28px] border border-border/80 p-6 text-sm text-muted-foreground">
          Selecciona una sucursal activa para consultar cierres de caja.
        </Card>
      </div>
    );
  }

  const rows = openingsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-2xl">
          Cierres de caja
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Reimprime reportes de cajas ya cerradas (aunque el turno siga abierto) · {activeBranch?.name}
        </p>
      </div>

      <Card className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold text-foreground">Filtros</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Input
              type="datetime-local"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="h-10 rounded-xl text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Input
              type="datetime-local"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="h-10 rounded-xl text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Turno</Label>
            <Select value={shiftId} onValueChange={setShiftId}>
              <SelectTrigger className="h-10 rounded-xl text-xs">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los turnos</SelectItem>
                {(shiftsQuery.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    Turno #{s.shift_number || s.id.slice(0, 5)} ({formatDateTime(s.opened_at)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cajero</Label>
            <Select value={cashierId} onValueChange={setCashierId}>
              <SelectTrigger className="h-10 rounded-xl text-xs">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los cajeros</SelectItem>
                {cashierOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold">Aperturas cerradas</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {openingsQuery.isFetching ? "Buscando..." : `${rows.length} resultado(s)`}
          </span>
        </div>

        {openingsQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando cierres...
          </div>
        ) : openingsQuery.isError ? (
          <div className="p-6 text-sm text-destructive">
            {(openingsQuery.error as Error)?.message || "Error al cargar cierres"}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No hay aperturas cerradas en el rango seleccionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[11px] leading-tight">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold">Apertura</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold">Cierre</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold">Turno</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold">Cajero</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold text-right">Inicial</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold text-right">Monto final</th>
                  <th className="whitespace-nowrap px-2.5 py-2 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-slate-700">
                      {formatDateTime(row.opened_at)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-slate-700">
                      {formatDateTime(row.closed_at)}
                    </td>
                    <td className="max-w-[220px] truncate px-2.5 py-2 text-slate-600" title={shiftLabel(row)}>
                      {shiftLabel(row)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <div className="font-medium text-slate-900">{row.cashier_username || row.cashier_name}</div>
                      {row.cashier_username && row.cashier_name !== row.cashier_username ? (
                        <div className="text-[10px] text-muted-foreground">{row.cashier_name}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums font-medium text-slate-800">
                      {formatMoney(row.initial_total)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums font-medium text-slate-800">
                      {formatMoney(row.final_total)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-md gap-1 px-2 text-[11px]"
                        disabled={printingId === row.id}
                        onClick={() => handleReprint(row)}
                      >
                        {printingId === row.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Printer className="h-3 w-3" />
                        )}
                        Ver reporte
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default CierresCaja;
