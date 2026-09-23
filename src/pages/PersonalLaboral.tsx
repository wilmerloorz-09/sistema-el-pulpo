import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronsUpDown, FileSpreadsheet, Wallet, Users } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { filterBranchesForAdminReports } from "@/lib/adminReportBranchScope";
import { usePersonalLaboral, useSueldosPersonal, useDiasEspecialesPersonal } from "@/hooks/usePersonalLaboral";
import { resumirPersonal } from "@/lib/personalLaboral";
import { downloadXlsx } from "@/lib/exportXlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const ALL_BRANCHES = "__ALL__";
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const money = (value: number | null) =>
  value == null ? "Sin configurar" : new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
const selectClass =
  "flex h-10 w-full rounded-2xl border border-orange-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-orange-300";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

const NONE_SELECTED = "__NONE__";

function normalizeMultiSelectIds(selectedIds: string[], allIds: string[]) {
  const cleaned = selectedIds.filter((id) => id !== NONE_SELECTED);
  if (cleaned.length === 0) {
    // "__NONE__" solo, o vacío explícito tras desmarcar Todas → sin filtro (todas)
    if (selectedIds.includes(NONE_SELECTED)) return [NONE_SELECTED];
    return [];
  }
  if (allIds.length > 0 && allIds.every((id) => cleaned.includes(id))) return [];
  return cleaned;
}

function CheckMultiSelect({
  items,
  selectedIds,
  onChange,
  emptyLabel = "Todas",
}: {
  items: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const allIds = useMemo(() => items.map((item) => item.id), [items]);
  const noneSelected = selectedIds.length === 1 && selectedIds[0] === NONE_SELECTED;
  const allSelected =
    !noneSelected
    && (
      selectedIds.length === 0
      || (allIds.length > 0 && allIds.every((id) => selectedIds.includes(id)))
    );
  const label = noneSelected
    ? "Ninguna"
    : allSelected
      ? emptyLabel
      : selectedIds.length === 1
        ? (items.find((item) => item.id === selectedIds[0])?.name ?? "1 seleccionado")
        : `${selectedIds.length} seleccionados`;

  const toggleItem = (itemId: string, checked: boolean) => {
    if (checked) {
      const base = noneSelected || selectedIds.length === 0 ? [] : selectedIds.filter((id) => id !== NONE_SELECTED);
      const next = Array.from(new Set([...base, itemId]));
      if (allIds.length > 0 && allIds.every((id) => next.includes(id))) {
        onChange([]);
        return;
      }
      onChange(next);
      return;
    }

    if (allSelected) {
      onChange(allIds.filter((id) => id !== itemId));
      return;
    }
    const next = selectedIds.filter((id) => id !== itemId && id !== NONE_SELECTED);
    onChange(next.length === 0 ? [NONE_SELECTED] : next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(selectClass, "items-center justify-between text-left font-medium")}
          aria-expanded={open}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] rounded-2xl p-2" align="start">
        <div className="max-h-64 space-y-1 overflow-y-auto">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-muted/60">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => {
                onChange(checked === true ? allIds : [NONE_SELECTED]);
              }}
            />
            <span className="font-medium">{emptyLabel}</span>
          </label>
          {items.map((item) => {
            const checked = allSelected || selectedIds.includes(item.id);
            return (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => toggleItem(item.id, value === true)}
                />
                <span>{item.name}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PersonalLaboral() {
  const { branches, activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const reportBranches = useMemo(() => filterBranchesForAdminReports(branches), [branches]);
  const reportBranchIds = useMemo(() => reportBranches.map((b) => b.id), [reportBranches]);
  const canConfigure = isGlobalAdmin
    || canManage(permissions, "jornadas_personal")
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  const resolveInitialSucursalIds = (branchIds: string[]) => {
    if (activeBranchId && branchIds.includes(activeBranchId)) return [activeBranchId];
    // "Todas" = solo sucursales permitidas (nunca vacío sin filtro, para excluir las temporalmente fuera).
    return [...branchIds];
  };

  const initialFilters = {
    desde: new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }),
    hasta: today(),
    sucursalIds: resolveInitialSucursalIds(reportBranchIds),
    personaIds: [] as string[],
  };
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const personal = usePersonalLaboral(appliedFilters);
  const sueldos = useSueldosPersonal();
  const diasEspeciales = useDiasEspecialesPersonal();
  const allowedConfigBranchId =
    activeBranchId && reportBranchIds.includes(activeBranchId)
      ? activeBranchId
      : (isGlobalAdmin ? ALL_BRANCHES : (reportBranchIds[0] ?? ""));
  const [configBranchId, setConfigBranchId] = useState(allowedConfigBranchId);
  const [special, setSpecial] = useState({ fecha: today(), nombre: "", valor: "" });
  const [sueldoDrafts, setSueldoDrafts] = useState<Record<string, { lunesViernes: string; sabado: string; domingo: string; diaEspecial: string }>>({});
  const [isSavingSueldos, setIsSavingSueldos] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const next: Record<string, { lunesViernes: string; sabado: string; domingo: string; diaEspecial: string }> = {};
    for (const row of sueldos.data) {
      next[row.userId] = {
        lunesViernes: String(row.lunesViernes),
        sabado: String(row.sabado),
        domingo: String(row.domingo),
        diaEspecial: String(row.diaEspecial),
      };
    }
    setSueldoDrafts(next);
  }, [sueldos.data]);

  const people = personal.data.peopleOptions;
  const summaries = useMemo(() => resumirPersonal(personal.data.rows), [personal.data.rows]);
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const totalPages = Math.max(1, Math.ceil(personal.data.rows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageRows = personal.data.rows.slice(startIndex, endIndex);
  const showingFrom = personal.data.rows.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(endIndex, personal.data.rows.length);
  const branchSpecials = diasEspeciales.data.filter((item) =>
    configBranchId === ALL_BRANCHES
      ? item.branch_id === null
      : item.branch_id === configBranchId || item.branch_id === null,
  );
  const filtersDirty = useMemo(
    () => JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters),
    [draftFilters, appliedFilters],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters.desde, appliedFilters.hasta, appliedFilters.sucursalIds, appliedFilters.personaIds, pageSize]);

  // Cuando cargan las sucursales (o cambia el alcance), quitar excluidas y expandir "todas".
  useEffect(() => {
    if (reportBranchIds.length === 0) return;

    const sanitize = (ids: string[]) => {
      if (ids.length === 1 && ids[0] === NONE_SELECTED) return [NONE_SELECTED];
      const kept = ids.filter((id) => reportBranchIds.includes(id));
      if (kept.length === 0) return [...reportBranchIds];
      return kept;
    };

    setDraftFilters((prev) => {
      const next = sanitize(prev.sucursalIds);
      if (next.length === prev.sucursalIds.length && next.every((id, i) => id === prev.sucursalIds[i])) {
        return prev;
      }
      return { ...prev, sucursalIds: next };
    });
    setAppliedFilters((prev) => {
      const next = sanitize(prev.sucursalIds);
      if (next.length === prev.sucursalIds.length && next.every((id, i) => id === prev.sucursalIds[i])) {
        return prev;
      }
      return { ...prev, sucursalIds: next };
    });

    setConfigBranchId((prev) => {
      if (prev === ALL_BRANCHES) return prev;
      if (prev && reportBranchIds.includes(prev)) return prev;
      return isGlobalAdmin ? ALL_BRANCHES : (reportBranchIds[0] ?? "");
    });
  }, [reportBranchIds, isGlobalAdmin]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const applyFilters = () => {
    const personIds = people.map((person) => person.id);
    const normalizedBranches = normalizeMultiSelectIds(draftFilters.sucursalIds, reportBranchIds);
    const next = {
      desde: draftFilters.desde,
      hasta: draftFilters.hasta,
      // Vacío en UI = "todas", pero en query usamos solo las permitidas.
      sucursalIds:
        normalizedBranches.length === 0
          ? [...reportBranchIds]
          : normalizedBranches,
      personaIds: normalizeMultiSelectIds(draftFilters.personaIds, personIds),
    };
    setAppliedFilters(next);
    setDraftFilters({
      ...next,
      // Mantener "Todas" visual cuando el alcance es el completo permitido.
      sucursalIds:
        next.sucursalIds.length === reportBranchIds.length
        && reportBranchIds.every((id) => next.sucursalIds.includes(id))
          ? []
          : [...next.sucursalIds],
      personaIds: [...next.personaIds],
    });
    setCurrentPage(1);
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la operación");
    }
  };

  const dirtySueldoRows = useMemo(() => {
    return sueldos.data.filter((row) => {
      const draft = sueldoDrafts[row.userId];
      if (!draft) return false;
      return (
        Number(draft.lunesViernes) !== row.lunesViernes
        || Number(draft.sabado) !== row.sabado
        || Number(draft.domingo) !== row.domingo
        || Number(draft.diaEspecial) !== row.diaEspecial
      );
    });
  }, [sueldoDrafts, sueldos.data]);
  const hasDirtySueldos = dirtySueldoRows.length > 0;

  const saveSueldos = async () => {
    if (dirtySueldoRows.length === 0) return;

    for (const row of dirtySueldoRows) {
      const draft = sueldoDrafts[row.userId];
      if (
        !draft
        || draft.lunesViernes === ""
        || draft.sabado === ""
        || draft.domingo === ""
        || draft.diaEspecial === ""
      ) {
        toast.error(`Completa los cuatro sueldos de ${row.fullName}`);
        return;
      }
    }

    setIsSavingSueldos(true);
    try {
      for (const row of dirtySueldoRows) {
        const draft = sueldoDrafts[row.userId]!;
        await sueldos.saveSueldo({
          userId: row.userId,
          lunesViernes: Number(draft.lunesViernes),
          sabado: Number(draft.sabado),
          domingo: Number(draft.domingo),
          diaEspecial: Number(draft.diaEspecial),
        });
      }
      toast.success(
        dirtySueldoRows.length === 1
          ? "Sueldo guardado"
          : `${dirtySueldoRows.length} sueldos guardados`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar los sueldos");
    } finally {
      setIsSavingSueldos(false);
    }
  };

  const saveSpecial = async () => {
    if (!configBranchId || !special.fecha || !special.nombre.trim()) {
      toast.error("Completa la sucursal, fecha y nombre del día especial");
      return;
    }
    await run(() => personal.runRpc("guardar_precio_fecha_especial_personal", {
      p_id: null,
      p_branch_id: configBranchId === ALL_BRANCHES ? null : configBranchId,
      p_fecha: special.fecha,
      p_nombre: special.nombre,
      p_valor: Number(special.valor || 0),
    }), "Día especial guardado");
    await diasEspeciales.refetch();
    setSpecial((current) => ({ ...current, nombre: "", valor: "" }));
  };

  const removeSpecial = async (id: string) => {
    await run(() => personal.runRpc("eliminar_precio_fecha_especial_personal", { p_id: id }), "Día especial eliminado");
    await diasEspeciales.refetch();
  };

  const exportXlsx = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const decimal = (value: number | null) =>
        value == null ? null : { value, style: "decimal" as const };
      const detailData = [
        ["Fecha", "Sucursal", "Turno", "Persona", "Función / rol", "Sueldo", "Tipo"]
          .map((value) => ({ value, style: "header" as const })),
        ...personal.data.rows.map((row) => [
          row.fecha,
          row.branchName,
          row.shiftCode,
          row.personName,
          row.funciones.join(", ") || "Sin función asignada",
          decimal(row.valor),
          row.tipoPrecioLabel,
        ]),
      ];
      const summaryData = [
        ["Persona", "Días/turnos", "Total"]
          .map((value) => ({ value, style: "header" as const })),
        ...summaries.map((item) => [
          item.personName,
          item.jornadas,
          decimal(item.total),
        ]),
      ];
      downloadXlsx(`personal-${appliedFilters.desde}-${appliedFilters.hasta}.xlsx`, [
        {
          rows: detailData,
          name: "Detalle",
          widths: [14, 24, 24, 34, 30, 14, 18],
        },
        {
          rows: summaryData,
          name: "Total por persona",
          widths: [36, 16, 16],
        },
      ]);
    } catch (error) {
      console.error("No se pudo exportar el reporte de personal", error);
      toast.error(error instanceof Error ? error.message : "No se pudo generar el archivo Excel");
    } finally {
      setIsExporting(false);
    }
  };

  const pagination = (
    <div className="flex flex-col gap-3 px-1 py-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold text-foreground">
          Mostrando {showingFrom}–{showingTo} de {personal.data.rows.length}
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="pago-personal-page-size" className="whitespace-nowrap text-xs font-bold">
            Filas por página
          </Label>
          <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
            <SelectTrigger id="pago-personal-page-size" className="h-8 w-[88px] rounded-xl text-xs font-bold">
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
        <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold" onClick={() => setCurrentPage(1)} disabled={safeCurrentPage <= 1}>
          Primera
        </Button>
        <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage <= 1}>
          Anterior
        </Button>
        <span className="min-w-[88px] text-center text-xs font-bold text-foreground">
          Página {safeCurrentPage} de {totalPages}
        </span>
        <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safeCurrentPage >= totalPages}>
          Siguiente
        </Button>
        <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold" onClick={() => setCurrentPage(totalPages)} disabled={safeCurrentPage >= totalPages}>
          Última
        </Button>
      </div>
    </div>
  );

  if (personal.isLoading) return <div className="flex min-h-[50vh] items-center justify-center">Cargando reporte…</div>;
  if (personal.error) return <Card className="mx-auto mt-10 max-w-xl"><CardContent className="space-y-4 pt-6">
    <p className="text-sm text-destructive">{personal.error.message}</p>
    <Button onClick={() => void personal.refetch()}>Reintentar</Button>
  </CardContent></Card>;

  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <div>
      <h1 className="font-display text-2xl font-black">Pago del personal</h1>
      <p className="text-sm text-muted-foreground">Personas agregadas a los turnos y valor correspondiente a cada día.</p>
    </div>

    <Tabs defaultValue="reporte">
      <TabsList className="grid h-auto grid-cols-3">
        <TabsTrigger value="reporte"><Users className="mr-2 h-4 w-4" />Reporte</TabsTrigger>
        <TabsTrigger value="sueldos"><Wallet className="mr-2 h-4 w-4" />Sueldo de Personal</TabsTrigger>
        <TabsTrigger value="especiales"><CalendarDays className="mr-2 h-4 w-4" />Días especiales</TabsTrigger>
      </TabsList>

      <TabsContent value="reporte" className="space-y-4">
        <Card><CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-6">
            <Field label="Desde"><Input type="date" value={draftFilters.desde} onChange={(e) => setDraftFilters({ ...draftFilters, desde: e.target.value })} /></Field>
            <Field label="Hasta"><Input type="date" value={draftFilters.hasta} onChange={(e) => setDraftFilters({ ...draftFilters, hasta: e.target.value })} /></Field>
            <Field label="Sucursal">
              <CheckMultiSelect
                items={reportBranches}
                selectedIds={draftFilters.sucursalIds}
                onChange={(sucursalIds) => setDraftFilters({ ...draftFilters, sucursalIds })}
              />
            </Field>
            <Field label="Persona">
              <CheckMultiSelect
                items={people}
                selectedIds={draftFilters.personaIds}
                onChange={(personaIds) => setDraftFilters({ ...draftFilters, personaIds })}
              />
            </Field>
            <div className="flex items-end">
              <Button className="w-full" disabled={!filtersDirty || personal.isFetching} onClick={applyFilters}>
                {personal.isFetching ? "Consultando…" : "Aplicar"}
              </Button>
            </div>
            <div className="flex items-end"><Button variant="outline" className="w-full" disabled={isExporting} onClick={() => void exportXlsx()}><FileSpreadsheet className="mr-2 h-4 w-4" />{isExporting ? "Generando…" : "Exportar Excel"}</Button></div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Personas</p><p className="text-2xl font-black">{summaries.length}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Registros de trabajo</p><p className="text-2xl font-black">{personal.data.rows.length}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-black">{money(total)}</p></CardContent></Card>
        </div>

        {pagination}

        <Card><CardHeader><CardTitle>Personal que trabajó</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Sucursal</TableHead>
            <TableHead>Turno</TableHead><TableHead>Persona</TableHead><TableHead>Función / rol</TableHead>
            <TableHead>Tipo de sueldo</TableHead><TableHead>Sueldo</TableHead>
          </TableRow></TableHeader><TableBody>
            {personal.data.rows.length === 0
              ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No hay personal en turnos para este rango.</TableCell></TableRow>
              : pageRows.map((row) => <TableRow key={row.rowId}>
                <TableCell>{row.fecha}</TableCell><TableCell>{row.branchName}</TableCell>
                <TableCell>{row.shiftCode}<div className="text-xs text-muted-foreground">{row.shiftStatus === "OPEN" ? "Abierto" : "Cerrado"}</div></TableCell>
                <TableCell>{row.personName}</TableCell>
                <TableCell>{row.funciones.join(", ") || "Sin función asignada"}</TableCell>
                <TableCell>
                  {row.tipoPrecioLabel}
                  {row.tipoPrecio === "ESPECIAL" && <Badge className="ml-2" variant="secondary">Especial</Badge>}
                </TableCell>
                <TableCell>{money(row.valor)}</TableCell>
              </TableRow>)}
          </TableBody></Table>
        </CardContent></Card>

        {pagination}

        <Card><CardHeader><CardTitle>Total por persona</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Persona</TableHead><TableHead>Días/turnos</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
            <TableBody>{summaries.map((item) => <TableRow key={item.userId}>
              <TableCell>{item.personName}</TableCell><TableCell>{item.jornadas}</TableCell><TableCell>{money(item.total)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="sueldos" className="space-y-4">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Sueldo de Personal</CardTitle>
              <p className="text-sm font-normal text-muted-foreground">
                Listado de todo el personal activo con sueldo de lunes a viernes, sábado, domingo y día especial.
              </p>
            </div>
            {canConfigure ? (
              <Button
                className="shrink-0 self-end sm:self-start"
                disabled={!hasDirtySueldos || isSavingSueldos || sueldos.isSaving}
                onClick={() => void saveSueldos()}
              >
                {isSavingSueldos ? "Guardando…" : "Guardar"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {sueldos.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Cargando personal…</p>
            ) : sueldos.error ? (
              <div className="space-y-3 py-4 text-center">
                <p className="text-sm text-destructive">{sueldos.error.message}</p>
                <Button onClick={() => void sueldos.refetch()}>Reintentar</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Lunes a Viernes</TableHead>
                    <TableHead>Sábado</TableHead>
                    <TableHead>Domingo</TableHead>
                    <TableHead>Día especial</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sueldos.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        No hay personal activo para configurar.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sueldos.data.map((row) => {
                      const draft = sueldoDrafts[row.userId] ?? {
                        lunesViernes: String(row.lunesViernes),
                        sabado: String(row.sabado),
                        domingo: String(row.domingo),
                        diaEspecial: String(row.diaEspecial),
                      };
                      return (
                        <TableRow key={row.userId}>
                          <TableCell>
                            <div className="font-medium">{row.fullName}</div>
                            {row.username ? (
                              <div className="text-xs text-muted-foreground">{row.username}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {canConfigure ? (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9 w-28"
                                value={draft.lunesViernes}
                                onChange={(e) =>
                                  setSueldoDrafts((current) => ({
                                    ...current,
                                    [row.userId]: { ...draft, lunesViernes: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              money(row.lunesViernes)
                            )}
                          </TableCell>
                          <TableCell>
                            {canConfigure ? (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9 w-28"
                                value={draft.sabado}
                                onChange={(e) =>
                                  setSueldoDrafts((current) => ({
                                    ...current,
                                    [row.userId]: { ...draft, sabado: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              money(row.sabado)
                            )}
                          </TableCell>
                          <TableCell>
                            {canConfigure ? (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9 w-28"
                                value={draft.domingo}
                                onChange={(e) =>
                                  setSueldoDrafts((current) => ({
                                    ...current,
                                    [row.userId]: { ...draft, domingo: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              money(row.domingo)
                            )}
                          </TableCell>
                          <TableCell>
                            {canConfigure ? (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9 w-28"
                                value={draft.diaEspecial}
                                onChange={(e) =>
                                  setSueldoDrafts((current) => ({
                                    ...current,
                                    [row.userId]: { ...draft, diaEspecial: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              money(row.diaEspecial)
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="especiales" className="space-y-4">
        {!canConfigure ? (
          <Card>
            <CardContent className="pt-6">
              No tienes permiso para modificar los días especiales.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <CalendarDays className="mr-2 inline h-5 w-5" />
                Precio para un día especial
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Field label="Sucursal">
                <select className={selectClass} value={configBranchId} onChange={(e) => setConfigBranchId(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {isGlobalAdmin && <option value={ALL_BRANCHES}>Todas las sucursales</option>}
                  {reportBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha">
                <Input type="date" value={special.fecha} onChange={(e) => setSpecial({ ...special, fecha: e.target.value })} />
              </Field>
              <Field label="Nombre">
                <Input placeholder="Ej. Feriado local" value={special.nombre} onChange={(e) => setSpecial({ ...special, nombre: e.target.value })} />
              </Field>
              <div className="md:col-span-4 space-y-2 text-right">
                <p className="text-left text-xs text-muted-foreground">
                  Solo marca la fecha como día especial. El monto lo toma del sueldo “Día especial” de cada empleado.
                </p>
                <Button disabled={personal.isMutating} onClick={() => void saveSpecial()}>
                  Guardar día especial
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Días especiales configurados</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Nombre</TableHead>
                  {canConfigure && <TableHead>Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {branchSpecials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canConfigure ? 4 : 3} className="py-10 text-center text-muted-foreground">
                      No hay días especiales configurados.
                    </TableCell>
                  </TableRow>
                ) : (
                  branchSpecials.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.fecha}</TableCell>
                      <TableCell>
                        {item.branch_id === null
                          ? "Todas las sucursales"
                          : branches.find((branch) => branch.id === item.branch_id)?.name ?? "Sucursal"}
                      </TableCell>
                      <TableCell>{item.nombre}</TableCell>
                      {canConfigure && (
                        <TableCell>
                          <Button size="sm" variant="destructive" onClick={() => void removeSpecial(item.id)}>
                            Eliminar
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </div>;
}
