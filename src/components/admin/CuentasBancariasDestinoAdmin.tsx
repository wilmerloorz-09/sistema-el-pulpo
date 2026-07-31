import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useBancosActivos } from "@/hooks/useBancosActivos";
import type { CuentaBancariaDestino } from "@/lib/validacionComprobanteTransferencia";
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

type CuentaForm = {
  id: string | null;
  bancoId: string;
  numeroCuenta: string;
  tipoCuenta: "AHORROS" | "CORRIENTE";
  titular: string;
  identificacionTitular: string;
  alias: string;
  sucursalId: string;
  activa: boolean;
};

const ALL_BRANCHES = "__todas__";

const EMPTY_FORM: CuentaForm = {
  id: null,
  bancoId: "",
  numeroCuenta: "",
  tipoCuenta: "AHORROS",
  titular: "",
  identificacionTitular: "",
  alias: "",
  sucursalId: ALL_BRANCHES,
  activa: true,
};

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "No se pudo guardar la cuenta bancaria.";
}

export default function CuentasBancariasDestinoAdmin() {
  const { isGlobalAdmin, branches } = useBranch();
  const queryClient = useQueryClient();
  const { data: bancos = [] } = useBancosActivos(isGlobalAdmin);
  const [form, setForm] = useState<CuentaForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const cuentasQuery = useQuery({
    queryKey: ["admin-cuentas-bancarias-destino"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cuentas_bancarias_destino")
        .select("id, banco_id, numero_cuenta, numero_cuenta_normalizado, tipo_cuenta, titular, identificacion_titular, alias, sucursal_id, activa, creada_en")
        .order("creada_en", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CuentaBancariaDestino[];
    },
    enabled: isGlobalAdmin,
  });

  const bancoById = useMemo(
    () => new Map(bancos.map((banco) => [banco.id, banco.nombre])),
    [bancos],
  );
  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const numeroCuenta = form.numeroCuenta.replace(/\s+/g, "").trim();
      const numeroNormalizado = numeroCuenta.replace(/\D/g, "");
      const titular = form.titular.trim();
      if (!form.bancoId) throw new Error("Selecciona el banco de la cuenta destino.");
      if (numeroNormalizado.length < 4) throw new Error("Ingresa un número de cuenta válido.");
      if (titular.length < 3) throw new Error("Ingresa el titular de la cuenta.");

      const identificacion = form.identificacionTitular.replace(/\D/g, "");
      if (identificacion && ![10, 13].includes(identificacion.length)) {
        throw new Error("La identificación debe tener 10 o 13 dígitos.");
      }

      const payload = {
        banco_id: form.bancoId,
        numero_cuenta: numeroCuenta,
        tipo_cuenta: form.tipoCuenta,
        titular,
        identificacion_titular: identificacion || null,
        alias: form.alias.trim() || null,
        sucursal_id: form.sucursalId === ALL_BRANCHES ? null : form.sucursalId,
        activa: form.activa,
      };

      const query = (supabase as any).from("cuentas_bancarias_destino");
      const { error } = form.id
        ? await query.update(payload).eq("id", form.id)
        : await query.insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setErrorMensaje(null);
      setForm(EMPTY_FORM);
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-cuentas-bancarias-destino"] });
      void queryClient.invalidateQueries({ queryKey: ["cuentas-bancarias-destino-activas"] });
    },
    onError: (error) => setErrorMensaje(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("cuentas_bancarias_destino")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDeleteId(null);
      setErrorMensaje(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-cuentas-bancarias-destino"] });
      void queryClient.invalidateQueries({ queryKey: ["cuentas-bancarias-destino-activas"] });
    },
    onError: (error) => {
      setDeleteId(null);
      setErrorMensaje(
        `${getErrorMessage(error)} Si ya tiene validaciones asociadas, desactívala en lugar de eliminarla.`,
      );
    },
  });

  const startAdd = () => {
    setForm({ ...EMPTY_FORM, bancoId: bancos[0]?.id ?? "" });
    setErrorMensaje(null);
    setShowForm(true);
  };

  const startEdit = (cuenta: CuentaBancariaDestino) => {
    setForm({
      id: cuenta.id,
      bancoId: cuenta.banco_id,
      numeroCuenta: cuenta.numero_cuenta,
      tipoCuenta: cuenta.tipo_cuenta,
      titular: cuenta.titular,
      identificacionTitular: cuenta.identificacion_titular ?? "",
      alias: cuenta.alias ?? "",
      sucursalId: cuenta.sucursal_id ?? ALL_BRANCHES,
      activa: cuenta.activa,
    });
    setErrorMensaje(null);
    setShowForm(true);
  };

  if (!isGlobalAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <Shield className="h-10 w-10 text-destructive" />
        <p className="text-center text-sm font-semibold">
          Solo administradores globales pueden gestionar las cuentas bancarias.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Cuentas bancarias de El Pulpo</h2>
          <p className="text-sm text-muted-foreground">
            Cuentas autorizadas para recibir transferencias de clientes.
          </p>
        </div>
        <Button type="button" onClick={startAdd} className="h-11 gap-2">
          <Plus className="h-4 w-4" />
          Agregar cuenta
        </Button>
      </div>

      {errorMensaje ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
          {errorMensaje}
        </div>
      ) : null}

      {showForm ? (
        <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
          <h3 className="mb-4 font-bold">
            {form.id ? "Editar cuenta bancaria" : "Nueva cuenta bancaria"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Banco destino</Label>
              <Select value={form.bancoId} onValueChange={(value) => setForm((prev) => ({ ...prev, bancoId: value }))}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecciona banco" /></SelectTrigger>
                <SelectContent>
                  {bancos.map((banco) => (
                    <SelectItem key={banco.id} value={banco.id}>{banco.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuenta-numero">Número de cuenta</Label>
              <Input
                id="cuenta-numero"
                value={form.numeroCuenta}
                onChange={(event) => setForm((prev) => ({ ...prev, numeroCuenta: event.target.value }))}
                inputMode="numeric"
                className="h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de cuenta</Label>
              <Select
                value={form.tipoCuenta}
                onValueChange={(value: "AHORROS" | "CORRIENTE") => setForm((prev) => ({ ...prev, tipoCuenta: value }))}
              >
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AHORROS">Ahorros</SelectItem>
                  <SelectItem value="CORRIENTE">Corriente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuenta-titular">Titular</Label>
              <Input
                id="cuenta-titular"
                value={form.titular}
                onChange={(event) => setForm((prev) => ({ ...prev, titular: event.target.value }))}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuenta-identificacion">Cédula/RUC del titular (opcional)</Label>
              <Input
                id="cuenta-identificacion"
                value={form.identificacionTitular}
                onChange={(event) => setForm((prev) => ({ ...prev, identificacionTitular: event.target.value }))}
                inputMode="numeric"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuenta-alias">Alias (opcional)</Label>
              <Input
                id="cuenta-alias"
                value={form.alias}
                onChange={(event) => setForm((prev) => ({ ...prev, alias: event.target.value }))}
                placeholder="Ej. Cuenta principal"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Disponible para</Label>
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
              <Label htmlFor="cuenta-activa">Cuenta activa</Label>
              <Switch
                id="cuenta-activa"
                checked={form.activa}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, activa: checked }))}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button type="button" className="h-11" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Guardando..." : "Guardar cuenta"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {cuentasQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando cuentas...</p>
        ) : null}
        {(cuentasQuery.data ?? []).map((cuenta) => (
          <div key={cuenta.id} className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold">{cuenta.alias || bancoById.get(cuenta.banco_id) || "Cuenta bancaria"}</p>
                  <p className="text-sm">{bancoById.get(cuenta.banco_id)} · {cuenta.tipo_cuenta === "AHORROS" ? "Ahorros" : "Corriente"}</p>
                  <p className="font-mono text-sm">•••• {cuenta.numero_cuenta_normalizado.slice(-4)}</p>
                </div>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${cuenta.activa ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                {cuenta.activa ? "Activa" : "Inactiva"}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p><strong>Titular:</strong> {cuenta.titular}</p>
              <p className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {cuenta.sucursal_id ? branchById.get(cuenta.sucursal_id) ?? "Sucursal" : "Todas las sucursales"}
              </p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10 gap-1" onClick={() => startEdit(cuenta)}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-10 text-destructive" onClick={() => setDeleteId(cuenta.id)}>
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cuenta bancaria?</AlertDialogTitle>
            <AlertDialogDescription>
              Si ya fue usada en una validación no podrá eliminarse; en ese caso debes desactivarla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
