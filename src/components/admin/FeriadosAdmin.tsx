import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import {
  expandirRangoFechas,
  fechaActualEcuador,
  feriadosNacionalesEcuador,
} from "@/lib/feriadosBancarios";
import type { FeriadoBancario } from "@/hooks/useFeriadosBancarios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ALL_BRANCHES = "__todas__";

type FeriadoForm = {
  id: string | null;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  sucursalId: string;
  activo: boolean;
};

function currentYear(): number {
  return Number(fechaActualEcuador().slice(0, 4));
}

function emptyForm(year: number): FeriadoForm {
  return {
    id: null,
    nombre: "",
    fechaInicio: `${year}-01-01`,
    fechaFin: `${year}-01-01`,
    sucursalId: ALL_BRANCHES,
    activo: true,
  };
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "23505") return "Ya existe un feriado en esa fecha para el mismo alcance.";
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "").trim() : "";
    if (message) return message;
  }
  return "No se pudo guardar el feriado.";
}

function formatFecha(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toLocaleDateString("es-EC", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function FeriadosAdmin() {
  const { isGlobalAdmin, branches } = useBranch();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(currentYear);
  const [form, setForm] = useState<FeriadoForm>(() => emptyForm(currentYear()));
  const [showForm, setShowForm] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [infoMensaje, setInfoMensaje] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const feriadosQuery = useQuery({
    queryKey: ["admin-feriados", year],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("feriados")
        .select("id, fecha, nombre, sucursal_id, activo, origen")
        .gte("fecha", `${year}-01-01`)
        .lte("fecha", `${year}-12-31`)
        .order("fecha", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as FeriadoBancario[]).map((row) => ({
        ...row,
        fecha: String(row.fecha).slice(0, 10),
      }));
    },
    enabled: isGlobalAdmin,
  });

  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const years = useMemo(() => [year - 1, year, year + 1], [year]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nombre = form.nombre.trim();
      if (nombre.length < 3) throw new Error("Ingresa un nombre de al menos 3 caracteres.");
      if (!form.fechaInicio) throw new Error("Selecciona la fecha de inicio.");
      const fechaFin = form.fechaFin || form.fechaInicio;
      if (fechaFin < form.fechaInicio) throw new Error("La fecha final no puede ser anterior al inicio.");

      const sucursalId = form.sucursalId === ALL_BRANCHES ? null : form.sucursalId;

      if (form.id) {
        const { error } = await (supabase as any)
          .from("feriados")
          .update({
            fecha: form.fechaInicio,
            nombre,
            sucursal_id: sucursalId,
            activo: form.activo,
            origen: "manual",
          })
          .eq("id", form.id);
        if (error) throw error;
        return;
      }

      const fechas = expandirRangoFechas(form.fechaInicio, fechaFin);
      if (fechas.length === 0) throw new Error("El rango no incluye días hábiles para marcar.");

      const { error } = await (supabase as any).from("feriados").insert(
        fechas.map((fecha) => ({
          fecha,
          nombre,
          sucursal_id: sucursalId,
          activo: form.activo,
          origen: "manual",
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setErrorMensaje(null);
      setInfoMensaje(null);
      setShowForm(false);
      setForm(emptyForm(year));
      void queryClient.invalidateQueries({ queryKey: ["admin-feriados"] });
      void queryClient.invalidateQueries({ queryKey: ["feriados-bancarios-activos"] });
    },
    onError: (error) => setErrorMensaje(getErrorMessage(error)),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const existentes = new Set(
        (feriadosQuery.data ?? [])
          .filter((row) => !row.sucursal_id)
          .map((row) => row.fecha),
      );
      const faltantes = feriadosNacionalesEcuador(year).filter((row) => !existentes.has(row.fecha));
      if (faltantes.length === 0) return 0;
      const { error } = await (supabase as any).from("feriados").insert(
        faltantes.map((row) => ({
          fecha: row.fecha,
          nombre: row.nombre,
          sucursal_id: null,
          activo: true,
          origen: "nacional",
        })),
      );
      if (error) throw error;
      return faltantes.length;
    },
    onSuccess: (count) => {
      setErrorMensaje(null);
      setInfoMensaje(
        count === 0
          ? "Ese año ya tiene los feriados nacionales cargados."
          : `Se cargaron ${count} feriado(s) nacionales.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-feriados"] });
      void queryClient.invalidateQueries({ queryKey: ["feriados-bancarios-activos"] });
    },
    onError: (error) => setErrorMensaje(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("feriados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDeleteId(null);
      setErrorMensaje(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-feriados"] });
      void queryClient.invalidateQueries({ queryKey: ["feriados-bancarios-activos"] });
    },
    onError: (error) => {
      setDeleteId(null);
      setErrorMensaje(getErrorMessage(error));
    },
  });

  const startAdd = () => {
    setForm(emptyForm(year));
    setErrorMensaje(null);
    setShowForm(true);
  };

  const startEdit = (feriado: FeriadoBancario) => {
    setForm({
      id: feriado.id,
      nombre: feriado.nombre,
      fechaInicio: feriado.fecha,
      fechaFin: feriado.fecha,
      sucursalId: feriado.sucursal_id ?? ALL_BRANCHES,
      activo: feriado.activo,
    });
    setErrorMensaje(null);
    setShowForm(true);
  };

  if (!isGlobalAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <Shield className="h-10 w-10 text-destructive" />
        <p className="text-center text-sm font-semibold">
          Solo administradores globales pueden gestionar los feriados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Feriados bancarios</h2>
          <p className="text-sm text-muted-foreground">
            En un feriado o fin de semana, el comprobante puede traer la fecha del siguiente día hábil.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="h-11 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((item) => (
                <SelectItem key={item} value={String(item)}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={seedMutation.isPending}
            onClick={() => seedMutation.mutate()}
          >
            {seedMutation.isPending ? "Cargando..." : "Cargar nacionales"}
          </Button>
          <Button type="button" onClick={startAdd} className="h-11 gap-2">
            <Plus className="h-4 w-4" />
            Agregar feriado
          </Button>
        </div>
      </div>

      {infoMensaje ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-900">
          {infoMensaje}
        </div>
      ) : null}

      {errorMensaje ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
          {errorMensaje}
        </div>
      ) : null}

      {showForm ? (
        <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
          <h3 className="mb-4 font-bold">{form.id ? "Editar feriado" : "Nuevo feriado"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="feriado-nombre">Nombre</Label>
              <Input
                id="feriado-nombre"
                value={form.nombre}
                onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
                placeholder="Ej. Carnaval"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feriado-inicio">{form.id ? "Fecha" : "Desde"}</Label>
              <Input
                id="feriado-inicio"
                type="date"
                value={form.fechaInicio}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  fechaInicio: event.target.value,
                  fechaFin: prev.id ? event.target.value : prev.fechaFin,
                }))}
                className="h-11"
              />
            </div>
            {form.id ? null : (
              <div className="space-y-2">
                <Label htmlFor="feriado-fin">Hasta (opcional)</Label>
                <Input
                  id="feriado-fin"
                  type="date"
                  value={form.fechaFin}
                  onChange={(event) => setForm((prev) => ({ ...prev, fechaFin: event.target.value }))}
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Aplica a</Label>
              <Select value={form.sucursalId} onValueChange={(value) => setForm((prev) => ({ ...prev, sucursalId: value }))}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>Todas las sucursales</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-h-11 items-center justify-between rounded-xl border px-3">
              <Label htmlFor="feriado-activo">Activo</Label>
              <Switch
                id="feriado-activo"
                checked={form.activo}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, activo: checked }))}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button type="button" className="h-11" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {feriadosQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando feriados...</p>
        ) : null}
        {(feriadosQuery.data ?? []).length === 0 && !feriadosQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            No hay feriados en {year}. Carga los nacionales o agrégalos a mano.
          </p>
        ) : null}
        {(feriadosQuery.data ?? []).map((feriado) => (
          <div key={feriado.id} className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold">{feriado.nombre}</p>
                  <p className="text-sm capitalize">{formatFecha(feriado.fecha)}</p>
                </div>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${feriado.activo ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                {feriado.activo ? "Activo" : "Inactivo"}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {feriado.sucursal_id ? branchById.get(feriado.sucursal_id) ?? "Sucursal" : "Todas las sucursales"}
              </p>
              <p>{feriado.origen === "nacional" ? "Calendario nacional" : "Agregado manualmente"}</p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10 gap-1" onClick={() => startEdit(feriado)}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-10 text-destructive" onClick={() => setDeleteId(feriado.id)}>
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar feriado</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará de la validación de comprobantes. Puedes volver a cargarlo si es nacional.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
