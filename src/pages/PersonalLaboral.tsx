import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronsUpDown, FileSpreadsheet, Settings2, Users } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { usePersonalLaboral } from "@/hooks/usePersonalLaboral";
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

function BranchMultiSelect({
  branches,
  selectedIds,
  onChange,
}: {
  branches: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allSelected = selectedIds.length === 0;
  const label = allSelected
    ? "Todas"
    : selectedIds.length === 1
      ? (branches.find((branch) => branch.id === selectedIds[0])?.name ?? "1 sucursal")
      : `${selectedIds.length} sucursales`;

  const toggleBranch = (branchId: string, checked: boolean) => {
    if (checked) {
      onChange(Array.from(new Set([...selectedIds, branchId])));
      return;
    }
    onChange(selectedIds.filter((id) => id !== branchId));
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
                if (checked === true) onChange([]);
              }}
            />
            <span className="font-medium">Todas</span>
          </label>
          {branches.map((branch) => {
            const checked = selectedIds.includes(branch.id);
            return (
              <label
                key={branch.id}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => toggleBranch(branch.id, value === true)}
                />
                <span>{branch.name}</span>
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
  const canConfigure = isGlobalAdmin
    || canManage(permissions, "jornadas_personal")
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const initialFilters = {
    desde: new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }),
    hasta: today(),
    sucursalIds: activeBranchId ? [activeBranchId] : ([] as string[]),
    personaId: "",
  };
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const personal = usePersonalLaboral(appliedFilters);
  const [configBranchId, setConfigBranchId] = useState(activeBranchId ?? (isGlobalAdmin ? ALL_BRANCHES : ""));
  const [weekly, setWeekly] = useState({ lunesViernes: "", sabado: "", domingo: "" });
  const [special, setSpecial] = useState({ fecha: today(), nombre: "", valor: "" });
  const [isExporting, setIsExporting] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const configured = configBranchId === ALL_BRANCHES
      ? personal.data.precioGlobal
      : personal.data.precios.find((item) => item.branch_id === configBranchId);
    setWeekly({
      lunesViernes: configured ? String(configured.lunes_viernes) : "",
      sabado: configured ? String(configured.sabado) : "",
      domingo: configured ? String(configured.domingo) : "",
    });
  }, [configBranchId, personal.data.precios]);

  const people = useMemo(() => {
    const unique = new Map(personal.data.rows.map((row) => [row.userId, row.personName]));
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [personal.data.rows]);
  const summaries = useMemo(() => resumirPersonal(personal.data.rows), [personal.data.rows]);
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const totalPages = Math.max(1, Math.ceil(personal.data.rows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageRows = personal.data.rows.slice(startIndex, endIndex);
  const showingFrom = personal.data.rows.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(endIndex, personal.data.rows.length);
  const branchSpecials = personal.data.especiales.filter((item) =>
    configBranchId === ALL_BRANCHES ? item.branch_id === null : item.branch_id === configBranchId);
  const filtersDirty = useMemo(
    () => JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters),
    [draftFilters, appliedFilters],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters.desde, appliedFilters.hasta, appliedFilters.sucursalIds, appliedFilters.personaId, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const applyFilters = () => {
    setAppliedFilters({
      ...draftFilters,
      sucursalIds: [...draftFilters.sucursalIds],
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

  const saveWeekly = async () => {
    if (!configBranchId || weekly.lunesViernes === "" || weekly.sabado === "" || weekly.domingo === "") {
      toast.error("Selecciona la sucursal y completa los tres precios");
      return;
    }
    await run(() => personal.runRpc("guardar_precios_dia_personal", {
      p_branch_id: configBranchId === ALL_BRANCHES ? null : configBranchId,
      p_lunes_viernes: Number(weekly.lunesViernes),
      p_sabado: Number(weekly.sabado),
      p_domingo: Number(weekly.domingo),
    }), "Precios guardados");
  };

  const saveSpecial = async () => {
    if (!configBranchId || !special.fecha || !special.nombre.trim() || special.valor === "") {
      toast.error("Completa la sucursal, fecha, nombre y precio especial");
      return;
    }
    await run(() => personal.runRpc("guardar_precio_fecha_especial_personal", {
      p_id: null,
      p_branch_id: configBranchId === ALL_BRANCHES ? null : configBranchId,
      p_fecha: special.fecha,
      p_nombre: special.nombre,
      p_valor: Number(special.valor),
    }), "Día especial guardado");
    setSpecial((current) => ({ ...current, nombre: "", valor: "" }));
  };

  const removeSpecial = (id: string) =>
    run(() => personal.runRpc("eliminar_precio_fecha_especial_personal", { p_id: id }), "Día especial eliminado");

  const exportXlsx = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const decimal = (value: number | null) =>
        value == null ? null : { value, style: "decimal" as const };
      const detailData = [
        ["Fecha", "Sucursal", "Turno", "Persona", "Función / rol", "Precio", "Tipo"]
          .map((value) => ({ value, style: "header" as const })),
        ...personal.data.rows.map((row) => [
          row.fecha,
          row.branchName,
          row.shiftCode,
          row.personName,
          row.funciones.join(", ") || "Sin función asignada",
          decimal(row.valor),
          row.tipoPrecio,
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
      <TabsList className="grid h-auto grid-cols-2">
        <TabsTrigger value="reporte"><Users className="mr-2 h-4 w-4" />Reporte</TabsTrigger>
        <TabsTrigger value="precios"><Settings2 className="mr-2 h-4 w-4" />Configurar precios</TabsTrigger>
      </TabsList>

      <TabsContent value="reporte" className="space-y-4">
        <Card><CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-6">
            <Field label="Desde"><Input type="date" value={draftFilters.desde} onChange={(e) => setDraftFilters({ ...draftFilters, desde: e.target.value })} /></Field>
            <Field label="Hasta"><Input type="date" value={draftFilters.hasta} onChange={(e) => setDraftFilters({ ...draftFilters, hasta: e.target.value })} /></Field>
            <Field label="Sucursal">
              <BranchMultiSelect
                branches={branches}
                selectedIds={draftFilters.sucursalIds}
                onChange={(sucursalIds) => setDraftFilters({ ...draftFilters, sucursalIds })}
              />
            </Field>
            <Field label="Persona"><select className={selectClass} value={draftFilters.personaId} onChange={(e) => setDraftFilters({ ...draftFilters, personaId: e.target.value })}>
              <option value="">Todas</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select></Field>
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
            <TableHead>Turno</TableHead><TableHead>Persona</TableHead><TableHead>Función / rol</TableHead><TableHead>Precio del día</TableHead>
          </TableRow></TableHeader><TableBody>
            {personal.data.rows.length === 0
              ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No hay personal en turnos para este rango.</TableCell></TableRow>
              : pageRows.map((row) => <TableRow key={row.rowId}>
                <TableCell>{row.fecha}</TableCell><TableCell>{row.branchName}</TableCell>
                <TableCell>{row.shiftCode}<div className="text-xs text-muted-foreground">{row.shiftStatus === "OPEN" ? "Abierto" : "Cerrado"}</div></TableCell>
                <TableCell>{row.personName}</TableCell>
                <TableCell>{row.funciones.join(", ") || "Sin función asignada"}</TableCell>
                <TableCell>{money(row.valor)}{row.tipoPrecio === "ESPECIAL" && <Badge className="ml-2" variant="secondary">Especial</Badge>}</TableCell>
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

      <TabsContent value="precios" className="space-y-4">
        {!canConfigure ? <Card><CardContent className="pt-6">No tienes permiso para modificar los precios.</CardContent></Card> : <>
          <Card><CardHeader><CardTitle>Precio normal por sucursal</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Field label="Sucursal"><select className={selectClass} value={configBranchId} onChange={(e) => setConfigBranchId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {isGlobalAdmin && <option value={ALL_BRANCHES}>Todas las sucursales</option>}
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select></Field>
              <Field label="Lunes a viernes"><Input type="number" min="0" step="0.01" placeholder="$12.00" value={weekly.lunesViernes} onChange={(e) => setWeekly({ ...weekly, lunesViernes: e.target.value })} /></Field>
              <Field label="Sábado"><Input type="number" min="0" step="0.01" placeholder="$14.00" value={weekly.sabado} onChange={(e) => setWeekly({ ...weekly, sabado: e.target.value })} /></Field>
              <Field label="Domingo"><Input type="number" min="0" step="0.01" placeholder="$15.00" value={weekly.domingo} onChange={(e) => setWeekly({ ...weekly, domingo: e.target.value })} /></Field>
              <div className="md:col-span-4 text-right"><Button disabled={personal.isMutating} onClick={() => void saveWeekly()}>Guardar precios</Button></div>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle><CalendarDays className="mr-2 inline h-5 w-5" />Precio para un día especial</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Field label="Fecha"><Input type="date" value={special.fecha} onChange={(e) => setSpecial({ ...special, fecha: e.target.value })} /></Field>
              <Field label="Nombre"><Input placeholder="Ej. Feriado local" value={special.nombre} onChange={(e) => setSpecial({ ...special, nombre: e.target.value })} /></Field>
              <Field label="Precio"><Input type="number" min="0" step="0.01" value={special.valor} onChange={(e) => setSpecial({ ...special, valor: e.target.value })} /></Field>
              <div className="flex items-end"><Button className="w-full" disabled={personal.isMutating} onClick={() => void saveSpecial()}>Guardar día especial</Button></div>
            </CardContent>
          </Card>
        </>}

        <Card><CardHeader><CardTitle>Días especiales configurados</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Sucursal</TableHead>
            <TableHead>Nombre</TableHead><TableHead>Precio</TableHead>{canConfigure && <TableHead>Acción</TableHead>}
          </TableRow></TableHeader><TableBody>
            {branchSpecials.map((item) => <TableRow key={item.id}><TableCell>{item.fecha}</TableCell>
              <TableCell>{item.branch_id === null ? "Todas las sucursales" : branches.find((branch) => branch.id === item.branch_id)?.name ?? "Sucursal"}</TableCell>
              <TableCell>{item.nombre}</TableCell><TableCell>{money(Number(item.valor))}</TableCell>
              {canConfigure && <TableCell><Button size="sm" variant="destructive" onClick={() => void removeSpecial(item.id)}>Eliminar</Button></TableCell>}
            </TableRow>)}
          </TableBody></Table>
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  </div>;
}
