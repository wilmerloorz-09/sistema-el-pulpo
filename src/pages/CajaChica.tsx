import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, GripVertical, Lock, Pencil, PiggyBank, PlusCircle, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import {
  CAJA_CHICA_CONCEPTO_OTROS,
  CAJA_CHICA_CONCEPTO_OTROS_ID,
  CAJA_CHICA_CONCEPTO_REPOSICION,
  actualizarMovimientoCajaChica,
  eliminarConceptoCajaChica,
  eliminarMovimientoCajaChica,
  guardarConceptoCajaChica,
  listarConceptosCajaChica,
  listarMovimientosCajaChica,
  obtenerEstadoCajaChica,
  registrarMovimientoCajaChica,
  urlFirmadaComprobanteCajaChica,
  type CajaChicaConcepto,
  type CajaChicaMovimiento,
  type CajaChicaTipo,
} from "@/lib/cajaChica";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const money = (value: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);

const fechaSolo = (iso: string) =>
  new Date(iso).toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** YYYY-MM-DD en zona America/Guayaquil (input type=date). */
const isoToDateInput = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

/** Fecha local Ecuador a mediodía para evitar cambio de día por zona horaria. */
const dateInputToIso = (value: string) => new Date(`${value}T12:00:00-05:00`).toISOString();

const nombreCorto = (nombre: string | null | undefined) => {
  const parts = String(nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

type ConceptoLinea = {
  key: string;
  conceptoId: string;
  nombre: string;
  monto: string;
};

type FormState = {
  movimientoId: string | null;
  tipo: CajaChicaTipo;
  /** Solo reposición: un monto único. En egreso se usan lineasConcepto. */
  monto: string;
  lineasConcepto: ConceptoLinea[];
  observacion: string;
  archivo: File | null;
  previewUrl: string | null;
  tieneFotoActual: boolean;
  quitarFoto: boolean;
  /** Fecha del movimiento (alta = ahora; edición = creado_en). */
  creadoEn: string;
  /** Para editar: monto/tipo originales liberan saldo al recalcular. */
  originalTipo: CajaChicaTipo | null;
  originalMonto: number | null;
};

const emptyForm = (tipo: CajaChicaTipo): FormState => ({
  movimientoId: null,
  tipo,
  monto: "",
  lineasConcepto: [],
  observacion: "",
  archivo: null,
  previewUrl: null,
  tieneFotoActual: false,
  quitarFoto: false,
  creadoEn: new Date().toISOString(),
  originalTipo: null,
  originalMonto: null,
});

const parseMonto = (raw: string) => Number(String(raw).replace(",", "."));

function ConceptosDualList({
  conceptos,
  seleccionados,
  onChange,
}: {
  conceptos: CajaChicaConcepto[];
  seleccionados: ConceptoLinea[];
  onChange: (next: ConceptoLinea[]) => void;
}) {
  const selectedIds = new Set(seleccionados.map((l) => l.conceptoId));
  const disponibles: Array<{ id: string; nombre: string }> = [
    ...conceptos
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({ id: c.id, nombre: c.nombre })),
    ...(!selectedIds.has(CAJA_CHICA_CONCEPTO_OTROS_ID)
      ? [{ id: CAJA_CHICA_CONCEPTO_OTROS_ID, nombre: CAJA_CHICA_CONCEPTO_OTROS }]
      : []),
  ];

  const addConcepto = (id: string, nombre: string) => {
    if (selectedIds.has(id)) return;
    onChange([
      ...seleccionados,
      { key: `${id}-${Date.now()}`, conceptoId: id, nombre, monto: "" },
    ]);
  };

  const removeConcepto = (key: string) => {
    onChange(seleccionados.filter((l) => l.key !== key));
  };

  const setMonto = (key: string, monto: string) => {
    onChange(seleccionados.map((l) => (l.key === key ? { ...l, monto } : l)));
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Conceptos disponibles</Label>
        <div
          className="min-h-[180px] rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const key = e.dataTransfer.getData("text/cc-remove-key");
            if (key) removeConcepto(key);
          }}
        >
          {disponibles.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Todos los conceptos ya están seleccionados
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {disponibles.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/cc-concepto-id", c.id);
                      e.dataTransfer.setData("text/cc-concepto-nombre", c.nombre);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => addConcepto(c.id, c.nombre)}
                    className="flex w-full items-center gap-2 rounded-xl border border-transparent bg-white px-2.5 py-2 text-left text-sm shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate font-medium text-slate-800">{c.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 px-1 text-[10px] text-muted-foreground">
            Arrastra o toca para agregar
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Conceptos del gasto</Label>
        <div
          className="min-h-[180px] rounded-2xl border border-emerald-200 bg-emerald-50/40 p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/cc-concepto-id");
            const nombre = e.dataTransfer.getData("text/cc-concepto-nombre");
            if (id && nombre) addConcepto(id, nombre);
          }}
        >
          {seleccionados.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Suelta aquí uno o más conceptos
            </p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {seleccionados.map((l) => (
                <li
                  key={l.key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/cc-remove-key", l.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="rounded-xl border border-emerald-100 bg-white p-2 shadow-sm"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate text-sm font-semibold text-slate-800">{l.nombre}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => removeConcepto(l.key)}
                      aria-label={`Quitar ${l.nombre}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    inputMode="decimal"
                    placeholder="Monto"
                    value={l.monto}
                    onChange={(e) => setMonto(l.key, e.target.value)}
                    className="h-8 rounded-lg text-sm"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CajaChica() {
  const { permissions, isGlobalAdmin, activeBranchId, activeBranch, branches } = useBranch();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("movimientos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm("EGRESO"));
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CajaChicaMovimiento | null>(null);
  const [conceptoDialogOpen, setConceptoDialogOpen] = useState(false);
  const [conceptoEdit, setConceptoEdit] = useState<CajaChicaConcepto | null>(null);
  const [conceptoNombre, setConceptoNombre] = useState("");
  const [deleteConcepto, setDeleteConcepto] = useState<CajaChicaConcepto | null>(null);

  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "caja_chica")
    || canView(permissions, "caja_chica")
    || canView(permissions, "admin_sucursal")
    || canView(permissions, "admin_global");

  const canAdminConceptos =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  const estadoQuery = useQuery({
    queryKey: ["caja-chica-estado", activeBranchId],
    enabled: hasAccess && Boolean(activeBranchId),
    queryFn: () => obtenerEstadoCajaChica(activeBranchId!),
  });

  const movimientosQuery = useQuery({
    queryKey: ["caja-chica-movimientos", activeBranchId],
    enabled: hasAccess && Boolean(activeBranchId),
    queryFn: () => listarMovimientosCajaChica(activeBranchId!, 80, 0),
  });

  const conceptosQuery = useQuery({
    queryKey: ["caja-chica-conceptos", activeBranchId, canAdminConceptos],
    enabled: hasAccess && Boolean(activeBranchId),
    queryFn: () => listarConceptosCajaChica(activeBranchId!, canAdminConceptos),
  });

  const conceptosActivos = useMemo(
    () => (conceptosQuery.data ?? []).filter((c) => c.activo),
    [conceptosQuery.data],
  );

  const compartirLabel = useMemo(() => {
    const lista = estadoQuery.data?.comparten ?? [];
    if (lista.length <= 1) return null;
    return lista.map((b) => b.name).join(" · ");
  }, [estadoQuery.data?.comparten]);

  const saldoActual = Number(estadoQuery.data?.saldo ?? 0);

  /** Al editar un egreso, su monto original vuelve a estar disponible. */
  const saldoDisponibleParaEgreso = useMemo(() => {
    let disponible = saldoActual;
    if (form.originalTipo === "EGRESO" && form.originalMonto != null) {
      disponible += Number(form.originalMonto);
    }
    if (form.originalTipo === "REPOSICION" && form.originalMonto != null && form.tipo === "EGRESO") {
      // Si el movimiento era reposición y ahora será egreso, se pierde ese ingreso.
      disponible -= Number(form.originalMonto);
    }
    return Math.max(0, disponible);
  }, [saldoActual, form.originalTipo, form.originalMonto, form.tipo]);

  const montoFormulario = form.tipo === "EGRESO"
    ? form.lineasConcepto.reduce((sum, linea) => {
        const n = parseMonto(linea.monto);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0)
    : parseMonto(form.monto);
  const gastoExcedeSaldo =
    form.tipo === "EGRESO"
    && Number.isFinite(montoFormulario)
    && montoFormulario > 0
    && montoFormulario > saldoDisponibleParaEgreso;
  const sinSaldoParaGasto = saldoActual <= 0;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["caja-chica-estado", activeBranchId] }),
      queryClient.invalidateQueries({ queryKey: ["caja-chica-movimientos", activeBranchId] }),
      queryClient.invalidateQueries({ queryKey: ["caja-chica-conceptos", activeBranchId] }),
    ]);
  };

  const closeForm = () => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    setForm(emptyForm("EGRESO"));
    setDialogOpen(false);
  };

  const guardar = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !estadoQuery.data?.sucursal_efectiva_id) {
        throw new Error("Selecciona una sucursal activa");
      }
      if (!form.creadoEn) {
        throw new Error("Ingresa la fecha del movimiento");
      }
      const fechaMovimiento = form.creadoEn;
      const sucursalEfectivaId = estadoQuery.data.sucursal_efectiva_id;
      const observacion = form.tipo === "EGRESO" ? form.observacion.trim() || undefined : undefined;

      if (form.tipo === "REPOSICION") {
        const monto = parseMonto(form.monto);
        if (!Number.isFinite(monto) || monto <= 0) {
          throw new Error("Ingresa un monto válido");
        }
        if (!form.movimientoId) {
          return registrarMovimientoCajaChica({
            sucursalId: activeBranchId,
            sucursalEfectivaId,
            tipo: "REPOSICION",
            monto,
            concepto: CAJA_CHICA_CONCEPTO_REPOSICION,
            conceptoId: null,
            fecha: fechaMovimiento,
            archivo: form.archivo,
          });
        }
        const comprobante = form.archivo
          ? "replace"
          : form.quitarFoto
            ? "clear"
            : "keep";
        return actualizarMovimientoCajaChica({
          movimientoId: form.movimientoId,
          sucursalEfectivaId,
          tipo: "REPOSICION",
          monto,
          concepto: CAJA_CHICA_CONCEPTO_REPOSICION,
          conceptoId: null,
          fecha: fechaMovimiento,
          comprobante,
          archivo: form.archivo,
        });
      }

      if (form.lineasConcepto.length === 0) {
        throw new Error("Arrastra al menos un concepto al gasto");
      }

      const lineas = form.lineasConcepto.map((linea) => {
        const monto = parseMonto(linea.monto);
        if (!Number.isFinite(monto) || monto <= 0) {
          throw new Error(`Ingresa un monto válido para “${linea.nombre}”`);
        }
        const isOtros = linea.conceptoId === CAJA_CHICA_CONCEPTO_OTROS_ID;
        const found = conceptosActivos.find((c) => c.id === linea.conceptoId);
        if (!isOtros && !found && !form.movimientoId) {
          throw new Error(`Concepto no válido: ${linea.nombre}`);
        }
        return {
          monto,
          concepto: isOtros ? CAJA_CHICA_CONCEPTO_OTROS : (found?.nombre ?? linea.nombre),
          conceptoId: isOtros ? null : linea.conceptoId,
        };
      });

      const total = lineas.reduce((sum, l) => sum + l.monto, 0);
      const disponible = saldoDisponibleParaEgreso;
      if (disponible <= 0) {
        throw new Error("No hay saldo disponible para registrar un gasto");
      }
      if (total > disponible) {
        throw new Error(`El gasto no puede ser mayor al saldo (disponible: ${money(disponible)})`);
      }

      // Alta: un movimiento por concepto.
      if (!form.movimientoId) {
        for (let i = 0; i < lineas.length; i += 1) {
          const linea = lineas[i];
          await registrarMovimientoCajaChica({
            sucursalId: activeBranchId,
            sucursalEfectivaId,
            tipo: "EGRESO",
            monto: linea.monto,
            concepto: linea.concepto,
            conceptoId: linea.conceptoId,
            observacion,
            fecha: fechaMovimiento,
            // Misma foto en todas las líneas del registro.
            archivo: form.archivo,
          });
        }
        return { count: lineas.length };
      }

      // Edición: actualiza el movimiento actual con la 1ª línea; crea el resto.
      const [primera, ...rest] = lineas;
      const comprobante = form.archivo
        ? "replace"
        : form.quitarFoto
          ? "clear"
          : "keep";
      await actualizarMovimientoCajaChica({
        movimientoId: form.movimientoId,
        sucursalEfectivaId,
        tipo: "EGRESO",
        monto: primera.monto,
        concepto: primera.concepto,
        conceptoId: primera.conceptoId,
        observacion,
        fecha: fechaMovimiento,
        comprobante,
        archivo: form.archivo,
      });
      for (const linea of rest) {
        await registrarMovimientoCajaChica({
          sucursalId: activeBranchId,
          sucursalEfectivaId,
          tipo: "EGRESO",
          monto: linea.monto,
          concepto: linea.concepto,
          conceptoId: linea.conceptoId,
          observacion,
          fecha: fechaMovimiento,
          archivo: form.archivo,
        });
      }
      return { count: lineas.length };
    },
    onSuccess: async (result) => {
      const count = result && typeof result === "object" && "count" in result
        ? Number((result as { count?: number }).count ?? 1)
        : 1;
      toast.success(
        form.movimientoId
          ? "Movimiento actualizado"
          : form.tipo === "EGRESO"
            ? (count > 1 ? `${count} egresos registrados` : "Egreso registrado")
            : "Reposición registrada",
      );
      closeForm();
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo guardar el movimiento");
    },
  });

  const eliminar = useMutation({
    mutationFn: async (movimientoId: string) => eliminarMovimientoCajaChica(movimientoId),
    onSuccess: async () => {
      toast.success("Movimiento eliminado");
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo eliminar el movimiento");
    },
  });

  const guardarConcepto = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");
      const nombre = conceptoNombre.trim();
      if (!nombre) throw new Error("Ingresa el nombre del concepto");
      return guardarConceptoCajaChica({
        sucursalId: activeBranchId,
        nombre,
        conceptoId: conceptoEdit?.id ?? null,
      });
    },
    onSuccess: async () => {
      toast.success(conceptoEdit ? "Concepto actualizado" : "Concepto creado");
      setConceptoDialogOpen(false);
      setConceptoEdit(null);
      setConceptoNombre("");
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo guardar el concepto");
    },
  });

  const borrarConcepto = useMutation({
    mutationFn: async (id: string) => eliminarConceptoCajaChica(id),
    onSuccess: async () => {
      toast.success("Concepto eliminado");
      setDeleteConcepto(null);
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo eliminar el concepto");
    },
  });

  const openCreate = (tipo: CajaChicaTipo) => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    setForm(emptyForm(tipo));
    setDialogOpen(true);
  };

  const openEdit = (m: CajaChicaMovimiento) => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    const isOtros = !m.concepto_id && m.concepto.trim().toLowerCase() === "otros";
    setForm({
      movimientoId: m.id,
      tipo: m.tipo,
      monto: m.tipo === "REPOSICION" ? String(m.monto) : "",
      lineasConcepto: m.tipo === "EGRESO"
        ? [{
            key: m.id,
            conceptoId: isOtros ? CAJA_CHICA_CONCEPTO_OTROS_ID : (m.concepto_id ?? CAJA_CHICA_CONCEPTO_OTROS_ID),
            nombre: m.concepto,
            monto: String(m.monto),
          }]
        : [],
      observacion: m.observacion ?? "",
      archivo: null,
      previewUrl: null,
      tieneFotoActual: Boolean(m.ruta_objeto),
      quitarFoto: false,
      creadoEn: m.creado_en,
      originalTipo: m.tipo,
      originalMonto: Number(m.monto),
    });
    setDialogOpen(true);
  };

  const onPickFile = (file: File | null) => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    if (!file) {
      setForm((prev) => ({ ...prev, archivo: null, previewUrl: null }));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Solo se permiten imágenes");
      return;
    }
    setForm((prev) => ({
      ...prev,
      archivo: file,
      previewUrl: URL.createObjectURL(file),
      quitarFoto: false,
    }));
  };

  const verFoto = async (ruta: string | null, bucket: string | null) => {
    if (!ruta) return;
    setFotoLoading(true);
    setFotoUrl(null);
    try {
      const url = await urlFirmadaComprobanteCajaChica(ruta, bucket ?? undefined);
      setFotoUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el comprobante");
    } finally {
      setFotoLoading(false);
    }
  };

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Caja Chica requiere permiso asignado en el usuario o ser administrador de la sucursal.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="p-6">
        <Card className="rounded-[28px] border border-border/80 p-6 text-sm text-muted-foreground">
          Selecciona una sucursal activa para operar caja chica.
        </Card>
      </div>
    );
  }

  const saldo = saldoActual;
  const sucursalNombre =
    activeBranch?.name
    ?? branches.find((b) => b.id === activeBranchId)?.name
    ?? "Sucursal";
  const isEdit = Boolean(form.movimientoId);
  const saving = guardar.isPending;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight text-slate-900">Caja Chica</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sucursalNombre}
            {compartirLabel ? (
              <span className="block text-xs text-amber-700">Fondo compartido: {compartirLabel}</span>
            ) : null}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => {
            void estadoQuery.refetch();
            void movimientosQuery.refetch();
            void conceptosQuery.refetch();
          }}
          disabled={estadoQuery.isFetching || movimientosQuery.isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", (estadoQuery.isFetching || movimientosQuery.isFetching) && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList
          className={cn(
            "h-11 w-full rounded-2xl bg-slate-100 p-1",
            canAdminConceptos ? "grid max-w-lg grid-cols-2" : "max-w-xs",
          )}
        >
          <TabsTrigger value="movimientos" className="h-9 rounded-xl px-8 text-sm font-semibold">
            Movimientos
          </TabsTrigger>
          {canAdminConceptos ? (
            <TabsTrigger value="conceptos" className="h-9 rounded-xl px-8 text-sm font-semibold">
              Conceptos
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="movimientos" className="space-y-4">
          <Card className="rounded-[28px] border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                  <Wallet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/70">Saldo actual</p>
                  <p className="font-display text-3xl font-black text-emerald-900">
                    {estadoQuery.isLoading ? "…" : money(saldo)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
                  onClick={() => openCreate("EGRESO")}
                  disabled={estadoQuery.isLoading || sinSaldoParaGasto}
                  title={sinSaldoParaGasto ? "No hay saldo para registrar un gasto" : undefined}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Registrar gasto
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                  onClick={() => openCreate("REPOSICION")}
                  disabled={estadoQuery.isLoading}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Reposición
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <PiggyBank className="h-4 w-4 text-emerald-700" />
                Movimientos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {movimientosQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : (movimientosQuery.data?.length ?? 0) === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-muted-foreground">
                  Aún no hay movimientos. Empieza con una reposición para fondear la caja.
                </p>
              ) : (
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px]">
                    <colgroup>
                      <col className="w-[12%]" />
                      <col className="w-[18%]" />
                      <col className="w-[16%]" />
                      <col className="w-[24%]" />
                      <col className="w-[12%]" />
                      <col className="w-[9%]" />
                      <col className="w-[9%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="px-1.5 py-2 sm:px-2">Tipo</th>
                        <th className="px-1.5 py-2 sm:px-2">Concepto</th>
                        <th className="px-1.5 py-2 sm:px-2">Observación</th>
                        <th className="px-1.5 py-2 sm:px-2">
                          <div className="flex items-center justify-between gap-2">
                            <span>Fecha</span>
                            <span className="text-right">Monto</span>
                          </div>
                        </th>
                        <th className="px-1.5 py-2 text-right sm:px-2">Saldo</th>
                        <th className="px-1.5 py-2 sm:px-2">Foto</th>
                        <th className="px-1.5 py-2 text-right sm:px-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(movimientosQuery.data ?? []).map((m) => (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="px-1.5 py-2 align-middle sm:px-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-md px-1.5 py-0 text-[10px] font-semibold",
                                m.tipo === "EGRESO"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
                              )}
                            >
                              {m.tipo === "EGRESO" ? "Egreso" : "Reposición"}
                            </Badge>
                          </td>
                          <td className="px-1.5 py-2 align-middle sm:px-2">
                            <p className="truncate text-[13px] font-medium" title={m.concepto}>{m.concepto}</p>
                            {m.registrado_por_nombre ? (
                              <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={m.registrado_por_nombre}>
                                {nombreCorto(m.registrado_por_nombre)}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-1.5 py-2 align-middle sm:px-2">
                            <p
                              className="truncate text-[11px] text-muted-foreground"
                              title={m.tipo === "EGRESO" ? (m.observacion || undefined) : undefined}
                            >
                              {m.tipo === "EGRESO" ? (m.observacion || "—") : "—"}
                            </p>
                          </td>
                          <td className="px-1.5 py-2 align-middle sm:px-2">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
                                {fechaSolo(m.creado_en)}
                              </span>
                              <span
                                className={cn(
                                  "whitespace-nowrap text-[13px] font-semibold tabular-nums",
                                  m.tipo === "EGRESO" ? "text-rose-700" : "text-emerald-700",
                                )}
                              >
                                {m.tipo === "EGRESO" ? "−" : "+"}
                                {money(m.monto)}
                              </span>
                            </div>
                          </td>
                          <td className="px-1.5 py-2 text-right align-middle text-[13px] tabular-nums sm:px-2">
                            {money(m.saldo_despues)}
                          </td>
                          <td className="px-1.5 py-2 align-middle sm:px-2">
                            {m.ruta_objeto ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 rounded-lg px-1.5 text-[11px]"
                                disabled={fotoLoading}
                                onClick={() => void verFoto(m.ruta_objeto, m.nombre_bucket)}
                              >
                                Ver
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-1.5 py-2 text-right align-middle sm:px-2">
                            <div className="inline-flex justify-end gap-0.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 rounded-lg p-0"
                                title="Editar"
                                onClick={() => openEdit(m)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 rounded-lg p-0 text-rose-700 hover:text-rose-800"
                                title="Eliminar"
                                onClick={() => setDeleteTarget(m)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canAdminConceptos ? (
          <TabsContent value="conceptos" className="space-y-4">
            <Card className="rounded-[28px] border-border/80 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <CardTitle className="text-base font-bold">Conceptos / productos</CardTitle>
                <Button
                  className="rounded-xl"
                  onClick={() => {
                    setConceptoEdit(null);
                    setConceptoNombre("");
                    setConceptoDialogOpen(true);
                  }}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Nuevo concepto
                </Button>
              </CardHeader>
              <CardContent>
                {conceptosQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando…</p>
                ) : conceptosActivos.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-muted-foreground">
                    No hay conceptos. Crea los que usarás al registrar gastos.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conceptosActivos.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.nombre}</TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg p-0"
                                onClick={() => {
                                  setConceptoEdit(c);
                                  setConceptoNombre(c.nombre);
                                  setConceptoDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg p-0 text-rose-700"
                                onClick={() => setDeleteConcepto(c)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
          else setDialogOpen(true);
        }}
      >
        <DialogContent className={cn("rounded-[28px]", form.tipo === "EGRESO" ? "max-w-2xl" : "max-w-md")}>
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? "Editar movimiento"
                : form.tipo === "EGRESO"
                  ? "Registrar gasto"
                  : "Reposición de fondo"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isEdit ? (
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={form.tipo === "EGRESO" ? "default" : "outline"}
                    className={cn("rounded-xl", form.tipo === "EGRESO" && "bg-rose-600 hover:bg-rose-700")}
                    onClick={() => setForm((p) => ({
                      ...p,
                      tipo: "EGRESO",
                      lineasConcepto: p.lineasConcepto.length > 0
                        ? p.lineasConcepto
                        : (p.monto
                            ? [{
                                key: `edit-${Date.now()}`,
                                conceptoId: CAJA_CHICA_CONCEPTO_OTROS_ID,
                                nombre: CAJA_CHICA_CONCEPTO_OTROS,
                                monto: p.monto,
                              }]
                            : []),
                    }))}
                  >
                    Egreso
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.tipo === "REPOSICION" ? "default" : "outline"}
                    className={cn("rounded-xl", form.tipo === "REPOSICION" && "bg-emerald-600 hover:bg-emerald-700")}
                    onClick={() => setForm((p) => ({
                      ...p,
                      tipo: "REPOSICION",
                      monto: p.lineasConcepto[0]?.monto || p.monto,
                      lineasConcepto: [],
                      observacion: "",
                    }))}
                  >
                    Reposición
                  </Button>
                </div>
              </div>
            ) : null}
            <div className={cn("grid gap-3", form.tipo === "REPOSICION" ? "grid-cols-2" : "grid-cols-1")}>
              <div className="space-y-1.5">
                <Label htmlFor="cc-fecha">Fecha</Label>
                <Input
                  id="cc-fecha"
                  type="date"
                  value={isoToDateInput(form.creadoEn)}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!next) return;
                    setForm((p) => ({ ...p, creadoEn: dateInputToIso(next) }));
                  }}
                  className="rounded-xl"
                />
              </div>
              {form.tipo === "REPOSICION" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cc-monto">Monto</Label>
                  <Input
                    id="cc-monto"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.monto}
                    onChange={(e) => setForm((p) => ({ ...p, monto: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
              ) : null}
            </div>
            {form.tipo === "EGRESO" ? (
              <>
                <ConceptosDualList
                  conceptos={conceptosActivos}
                  seleccionados={form.lineasConcepto}
                  onChange={(lineasConcepto) => setForm((p) => ({ ...p, lineasConcepto }))}
                />
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total gasto</p>
                    <p className={cn("text-lg font-black tabular-nums", gastoExcedeSaldo ? "text-rose-700" : "text-slate-900")}>
                      {money(montoFormulario)}
                    </p>
                  </div>
                  <p className={cn("text-xs", gastoExcedeSaldo ? "font-medium text-rose-700" : "text-muted-foreground")}>
                    {gastoExcedeSaldo
                      ? `Excede el saldo (disponible: ${money(saldoDisponibleParaEgreso)})`
                      : `Saldo disponible: ${money(saldoDisponibleParaEgreso)}`}
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Concepto</Label>
                <Input value={CAJA_CHICA_CONCEPTO_REPOSICION} disabled className="rounded-xl bg-slate-50" />
              </div>
            )}
            {form.tipo === "EGRESO" ? (
              <div className="space-y-1.5">
                <Label htmlFor="cc-obs">Observación</Label>
                <Textarea
                  id="cc-obs"
                  value={form.observacion}
                  onChange={(e) => setForm((p) => ({ ...p, observacion: e.target.value }))}
                  className="min-h-[72px] rounded-xl"
                  placeholder="Detalle opcional del gasto"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>
                Foto del comprobante
                <span className="text-muted-foreground"> (opcional)</span>
              </Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {form.archivo || form.tieneFotoActual ? "Cambiar foto" : "Tomar / subir foto"}
                </Button>
                {(form.archivo || (form.tieneFotoActual && !form.quitarFoto)) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-xl text-rose-700"
                    onClick={() => {
                      onPickFile(null);
                      setForm((prev) => ({
                        ...prev,
                        archivo: null,
                        previewUrl: null,
                        quitarFoto: prev.tieneFotoActual,
                      }));
                    }}
                  >
                    Quitar
                  </Button>
                ) : null}
              </div>
              {form.previewUrl ? (
                <img
                  src={form.previewUrl}
                  alt="Vista previa comprobante"
                  className="mt-2 max-h-48 w-full rounded-2xl border object-cover"
                />
              ) : form.tieneFotoActual && !form.quitarFoto ? (
                <p className="text-xs text-muted-foreground">Ya hay una foto guardada. Puedes cambiarla o quitarla.</p>
              ) : form.quitarFoto ? (
                <p className="text-xs text-rose-700">Se quitará la foto al guardar.</p>
              ) : null}
            </div>
            <Button
              className={cn(
                "w-full rounded-xl",
                form.tipo === "EGRESO" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700",
              )}
              disabled={
                saving
                || gastoExcedeSaldo
                || (form.tipo === "EGRESO" && (saldoDisponibleParaEgreso <= 0 || form.lineasConcepto.length === 0))
              }
              onClick={() => guardar.mutate()}
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={conceptoDialogOpen} onOpenChange={setConceptoDialogOpen}>
        <DialogContent className="max-w-md rounded-[28px]">
          <DialogHeader>
            <DialogTitle>{conceptoEdit ? "Editar concepto" : "Nuevo concepto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-concepto-nombre">Nombre</Label>
              <Input
                id="cc-concepto-nombre"
                value={conceptoNombre}
                onChange={(e) => setConceptoNombre(e.target.value)}
                className="rounded-xl"
                placeholder="Ej. Útiles de limpieza"
              />
            </div>
            <Button
              className="w-full rounded-xl"
              disabled={guardarConcepto.isPending}
              onClick={() => guardarConcepto.mutate()}
            >
              {guardarConcepto.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(fotoUrl) || fotoLoading} onOpenChange={(open) => !open && setFotoUrl(null)}>
        <DialogContent className="max-w-lg rounded-[28px]">
          <DialogHeader>
            <DialogTitle>Comprobante</DialogTitle>
          </DialogHeader>
          {fotoLoading ? (
            <p className="text-sm text-muted-foreground">Cargando foto…</p>
          ) : fotoUrl ? (
            <img src={fotoUrl} alt="Comprobante caja chica" className="w-full rounded-2xl object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar movimiento</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Se eliminará ${deleteTarget.tipo === "EGRESO" ? "el egreso" : "la reposición"} de ${money(deleteTarget.monto)} (${deleteTarget.concepto}) y se recalculará el saldo.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={eliminar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-rose-600 hover:bg-rose-700"
              disabled={eliminar.isPending || !deleteTarget}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) eliminar.mutate(deleteTarget.id);
              }}
            >
              {eliminar.isPending ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteConcepto)} onOpenChange={(open) => !open && setDeleteConcepto(null)}>
        <AlertDialogContent className="rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar concepto</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConcepto
                ? `Se desactivará "${deleteConcepto.nombre}". Ya no aparecerá en el combo, pero se conservará en el historial de movimientos.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={borrarConcepto.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-rose-600 hover:bg-rose-700"
              disabled={borrarConcepto.isPending || !deleteConcepto}
              onClick={(e) => {
                e.preventDefault();
                if (deleteConcepto) borrarConcepto.mutate(deleteConcepto.id);
              }}
            >
              {borrarConcepto.isPending ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
