import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Proveedor = {
  id: string;
  ruc_cedula: string;
  nombre: string;
  nombre_comercial: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  ciudad: string | null;
  persona_contacto: string | null;
  telefono_contacto: string | null;
  notas: string | null;
  activo: boolean;
};

type ProveedorForm = {
  ruc_cedula: string;
  nombre: string;
  nombre_comercial: string;
  telefono: string;
  email: string;
  direccion: string;
  ciudad: string;
  persona_contacto: string;
  telefono_contacto: string;
  notas: string;
  activo: boolean;
};

const emptyForm = (): ProveedorForm => ({
  ruc_cedula: "",
  nombre: "",
  nombre_comercial: "",
  telefono: "",
  email: "",
  direccion: "",
  ciudad: "",
  persona_contacto: "",
  telefono_contacto: "",
  notas: "",
  activo: true,
});

function formFromProveedor(row: Proveedor): ProveedorForm {
  return {
    ruc_cedula: row.ruc_cedula ?? "",
    nombre: row.nombre ?? "",
    nombre_comercial: row.nombre_comercial ?? "",
    telefono: row.telefono ?? "",
    email: row.email ?? "",
    direccion: row.direccion ?? "",
    ciudad: row.ciudad ?? "",
    persona_contacto: row.persona_contacto ?? "",
    telefono_contacto: row.telefono_contacto ?? "",
    notas: row.notas ?? "",
    activo: row.activo,
  };
}

function validarFormulario(form: ProveedorForm): string | null {
  const ruc = form.ruc_cedula.trim();
  const nombre = form.nombre.trim();
  if (!/^\d+$/.test(ruc)) return "El RUC/cédula solo debe contener números.";
  if (ruc.length !== 10 && ruc.length !== 13) {
    return "El RUC debe tener 13 dígitos o la cédula 10 dígitos.";
  }
  if (nombre.length < 2) return "El nombre es obligatorio.";
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return "El correo no es válido.";
  }
  return null;
}

const ProveedoresAdmin = () => {
  const { isGlobalAdmin, permissions } = useBranch();
  const canEdit =
    isGlobalAdmin
    || canManage(permissions, "admin_global")
    || canOperate(permissions, "bodega_general");
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProveedorForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const proveedoresQuery = useQuery({
    queryKey: ["proveedores-bodega-general"],
    queryFn: async (): Promise<Proveedor[]> => {
      const { data, error } = await supabase
        .from("proveedores" as any)
        .select(`
          id,
          ruc_cedula,
          nombre,
          nombre_comercial,
          telefono,
          email,
          direccion,
          ciudad,
          persona_contacto,
          telefono_contacto,
          notas,
          activo
        `)
        .order("nombre", { ascending: true });

      if (error) throw error;
      return (data as Proveedor[]) ?? [];
    },
  });

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const rows = proveedoresQuery.data ?? [];
    if (!q) return rows;
    return rows.filter((row) =>
      row.nombre.toLowerCase().includes(q)
      || row.ruc_cedula.toLowerCase().includes(q)
      || (row.nombre_comercial ?? "").toLowerCase().includes(q)
      || (row.telefono ?? "").toLowerCase().includes(q)
      || (row.ciudad ?? "").toLowerCase().includes(q)
      || (row.persona_contacto ?? "").toLowerCase().includes(q),
    );
  }, [busqueda, proveedoresQuery.data]);

  useEffect(() => {
    if (!dialogOpen) return;
    setFormError(null);
  }, [dialogOpen]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validationError = validarFormulario(form);
      if (validationError) throw new Error(validationError);

      const payload = {
        ruc_cedula: form.ruc_cedula.trim(),
        nombre: form.nombre.trim(),
        nombre_comercial: form.nombre_comercial.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
        persona_contacto: form.persona_contacto.trim() || null,
        telefono_contacto: form.telefono_contacto.trim() || null,
        notas: form.notas.trim() || null,
        activo: form.activo,
      };

      if (editingId) {
        const { error } = await supabase
          .from("proveedores" as any)
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("proveedores" as any).insert({
        ...payload,
        creado_por: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Proveedor actualizado" : "Proveedor creado");
      void qc.invalidateQueries({ queryKey: ["proveedores-bodega-general"] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    },
    onError: (error: Error) => {
      const message = error.message.includes("idx_proveedores_ruc_cedula_uniq")
        || error.message.toLowerCase().includes("duplicate")
        ? "Ya existe un proveedor con ese RUC/cédula."
        : (error.message || "No se pudo guardar el proveedor");
      setFormError(message);
      toast.error(message);
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (row: Proveedor) => {
    setEditingId(row.id);
    setForm(formFromProveedor(row));
    setFormError(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Proveedores</h2>
            <p className="text-xs text-muted-foreground">
              Catálogo de proveedores para compras de bodega general
            </p>
          </div>
        </div>

        {canEdit ? (
          <Button className="h-10 rounded-xl" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nuevo proveedor
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, RUC, teléfono o ciudad..."
          className="h-10 rounded-xl border-border/80 pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-3">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">Listado</h3>
          <span className="text-[11px] text-muted-foreground">
            ({filas.length} proveedor{filas.length === 1 ? "" : "es"})
          </span>
        </div>

        {proveedoresQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : proveedoresQuery.isError ? (
          <div className="p-4 text-sm text-destructive">
            {(proveedoresQuery.error as Error)?.message || "No se pudo cargar proveedores"}
          </div>
        ) : filas.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No hay proveedores registrados todavía.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filas.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{row.nombre}</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-lg text-[10px] font-bold",
                        row.activo
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800",
                      )}
                    >
                      {row.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    RUC/Cédula: <span className="font-semibold tabular-nums">{row.ruc_cedula}</span>
                    {row.nombre_comercial ? ` · ${row.nombre_comercial}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {[row.telefono, row.ciudad, row.persona_contacto].filter(Boolean).join(" · ") || "Sin contacto"}
                  </p>
                </div>

                {canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0 rounded-xl"
                    onClick={() => openEdit(row)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Editar
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-1">
                <Label className="text-xs">RUC / Cédula *</Label>
                <Input
                  value={form.ruc_cedula}
                  onChange={(e) => setForm((p) => ({ ...p, ruc_cedula: e.target.value.replace(/\D/g, "").slice(0, 13) }))}
                  className="h-10 rounded-xl tabular-nums"
                  placeholder="10 o 13 dígitos"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-1">
                <Label className="text-xs">Teléfono</Label>
                <Input
                  value={form.telefono}
                  onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
                  className="h-10 rounded-xl"
                  placeholder="Ej. 0999999999"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Nombre / Razón social *</Label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
                className="h-10 rounded-xl"
                placeholder="Nombre legal del proveedor"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Nombre comercial</Label>
              <Input
                value={form.nombre_comercial}
                onChange={(e) => setForm((p) => ({ ...p, nombre_comercial: e.target.value }))}
                className="h-10 rounded-xl"
                placeholder="Opcional"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Correo</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="h-10 rounded-xl"
                  placeholder="correo@ejemplo.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ciudad</Label>
                <Input
                  value={form.ciudad}
                  onChange={(e) => setForm((p) => ({ ...p, ciudad: e.target.value }))}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Dirección</Label>
              <Input
                value={form.direccion}
                onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
                className="h-10 rounded-xl"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Persona de contacto</Label>
                <Input
                  value={form.persona_contacto}
                  onChange={(e) => setForm((p) => ({ ...p, persona_contacto: e.target.value }))}
                  className="h-10 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Teléfono de contacto</Label>
                <Input
                  value={form.telefono_contacto}
                  onChange={(e) => setForm((p) => ({ ...p, telefono_contacto: e.target.value }))}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notas</Label>
              <Textarea
                value={form.notas}
                onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))}
                className="min-h-[72px] rounded-xl"
                placeholder="Observaciones opcionales"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
              <Label className="text-xs">Proveedor activo</Label>
              <Switch
                checked={form.activo}
                onCheckedChange={(checked) => setForm((p) => ({ ...p, activo: checked }))}
              />
            </div>

            {formError ? (
              <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={saveMutation.isPending}
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="rounded-xl"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setFormError(null);
                  saveMutation.mutate();
                }}
              >
                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingId ? "Guardar cambios" : "Crear proveedor"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProveedoresAdmin;
