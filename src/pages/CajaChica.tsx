import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Lock, Pencil, PiggyBank, PlusCircle, RefreshCw, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate, canView } from "@/lib/permissions";
import {
  actualizarMovimientoCajaChica,
  eliminarMovimientoCajaChica,
  listarMovimientosCajaChica,
  obtenerEstadoCajaChica,
  registrarMovimientoCajaChica,
  urlFirmadaComprobanteCajaChica,
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const money = (value: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

type FormState = {
  movimientoId: string | null;
  tipo: CajaChicaTipo;
  monto: string;
  concepto: string;
  notas: string;
  archivo: File | null;
  previewUrl: string | null;
  tieneFotoActual: boolean;
  quitarFoto: boolean;
};

const emptyForm = (tipo: CajaChicaTipo): FormState => ({
  movimientoId: null,
  tipo,
  monto: "",
  concepto: tipo === "REPOSICION" ? "Reposición de fondo" : "",
  notas: "",
  archivo: null,
  previewUrl: null,
  tieneFotoActual: false,
  quitarFoto: false,
});

export default function CajaChica() {
  const { permissions, isGlobalAdmin, activeBranchId, activeBranch, branches } = useBranch();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm("EGRESO"));
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CajaChicaMovimiento | null>(null);

  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "caja_chica")
    || canView(permissions, "caja_chica")
    || canView(permissions, "admin_sucursal")
    || canView(permissions, "admin_global");

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

  const compartirLabel = useMemo(() => {
    const lista = estadoQuery.data?.comparten ?? [];
    if (lista.length <= 1) return null;
    return lista.map((b) => b.name).join(" · ");
  }, [estadoQuery.data?.comparten]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["caja-chica-estado", activeBranchId] }),
      queryClient.invalidateQueries({ queryKey: ["caja-chica-movimientos", activeBranchId] }),
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
      const monto = Number(String(form.monto).replace(",", "."));
      if (!Number.isFinite(monto) || monto <= 0) {
        throw new Error("Ingresa un monto válido");
      }
      const concepto = form.concepto.trim();
      if (!concepto) throw new Error("El concepto es obligatorio");

      if (!form.movimientoId) {
        if (form.tipo === "EGRESO" && monto > Number(estadoQuery.data.saldo ?? 0)) {
          throw new Error(`Saldo insuficiente (disponible: ${money(Number(estadoQuery.data.saldo))})`);
        }
        return registrarMovimientoCajaChica({
          sucursalId: activeBranchId,
          sucursalEfectivaId: estadoQuery.data.sucursal_efectiva_id,
          tipo: form.tipo,
          monto,
          concepto,
          notas: form.notas.trim() || undefined,
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
        sucursalEfectivaId: estadoQuery.data.sucursal_efectiva_id,
        tipo: form.tipo,
        monto,
        concepto,
        notas: form.notas.trim() || undefined,
        comprobante,
        archivo: form.archivo,
      });
    },
    onSuccess: async () => {
      toast.success(form.movimientoId ? "Movimiento actualizado" : form.tipo === "EGRESO" ? "Egreso registrado" : "Reposición registrada");
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

  const openCreate = (tipo: CajaChicaTipo) => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    setForm(emptyForm(tipo));
    setDialogOpen(true);
  };

  const openEdit = (m: CajaChicaMovimiento) => {
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    setForm({
      movimientoId: m.id,
      tipo: m.tipo,
      monto: String(m.monto),
      concepto: m.concepto,
      notas: m.notas ?? "",
      archivo: null,
      previewUrl: null,
      tieneFotoActual: Boolean(m.ruta_objeto),
      quitarFoto: false,
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

  const saldo = Number(estadoQuery.data?.saldo ?? 0);
  const sucursalNombre =
    activeBranch?.name
    ?? branches.find((b) => b.id === activeBranchId)?.name
    ?? "Sucursal";
  const isEdit = Boolean(form.movimientoId);
  const saving = guardar.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
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
          }}
          disabled={estadoQuery.isFetching || movimientosQuery.isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", (estadoQuery.isFetching || movimientosQuery.isFetching) && "animate-spin")} />
          Actualizar
        </Button>
      </div>

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
              className="rounded-xl bg-rose-600 hover:bg-rose-700"
              onClick={() => openCreate("EGRESO")}
              disabled={estadoQuery.isLoading}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Comprobante</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(movimientosQuery.data ?? []).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fechaHora(m.creado_en)}
                        {m.registrado_por_nombre ? (
                          <span className="mt-0.5 block text-[11px]">{m.registrado_por_nombre}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-lg font-semibold",
                            m.tipo === "EGRESO"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700",
                          )}
                        >
                          {m.tipo === "EGRESO" ? "Egreso" : "Reposición"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[220px]">
                          <p className="truncate text-sm font-medium">{m.concepto}</p>
                          {m.notas ? (
                            <p className="truncate text-[11px] text-muted-foreground">{m.notas}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          m.tipo === "EGRESO" ? "text-rose-700" : "text-emerald-700",
                        )}
                      >
                        {m.tipo === "EGRESO" ? "−" : "+"}
                        {money(m.monto)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {money(m.saldo_despues)}
                      </TableCell>
                      <TableCell>
                        {m.ruta_objeto ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs"
                            disabled={fotoLoading}
                            onClick={() => void verFoto(m.ruta_objeto, m.nombre_bucket)}
                          >
                            Ver foto
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0"
                            title="Editar"
                            onClick={() => openEdit(m)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0 text-rose-700 hover:text-rose-800"
                            title="Eliminar"
                            onClick={() => setDeleteTarget(m)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
          else setDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-md rounded-[28px]">
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
                    onClick={() => setForm((p) => ({ ...p, tipo: "EGRESO" }))}
                  >
                    Egreso
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.tipo === "REPOSICION" ? "default" : "outline"}
                    className={cn("rounded-xl", form.tipo === "REPOSICION" && "bg-emerald-600 hover:bg-emerald-700")}
                    onClick={() => setForm((p) => ({ ...p, tipo: "REPOSICION" }))}
                  >
                    Reposición
                  </Button>
                </div>
              </div>
            ) : null}
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
            <div className="space-y-1.5">
              <Label htmlFor="cc-concepto">Concepto</Label>
              <Input
                id="cc-concepto"
                value={form.concepto}
                onChange={(e) => setForm((p) => ({ ...p, concepto: e.target.value }))}
                placeholder={form.tipo === "EGRESO" ? "Ej. Compra de insumos" : "Reposición de fondo"}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-notas">Notas (opcional)</Label>
              <Textarea
                id="cc-notas"
                value={form.notas}
                onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))}
                className="min-h-[72px] rounded-xl"
              />
            </div>
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
              disabled={saving}
              onClick={() => guardar.mutate()}
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
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
    </div>
  );
}
