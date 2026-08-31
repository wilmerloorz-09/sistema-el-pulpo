import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, UserCheck, UserCog, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { fechaActualEcuador } from "@/lib/feriadosBancarios";
import { getUserAlias, getUserRealName } from "@/lib/userDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface DelegationStatusRow {
  branch_id: string;
  branch_name: string;
  permanent_supervisor_user_id: string | null;
  permanent_supervisor_name: string | null;
  delegation_id: string | null;
  delegate_user_id: string | null;
  delegate_name: string | null;
  effective_date: string | null;
  assigned_at: string | null;
  assigned_by_name: string | null;
  reason: string | null;
}

interface UserOption {
  id: string;
  label: string;
  alias: string;
  isActive: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "").trim() : "";
    if (message) return message;
  }
  return "No se pudo completar la operacion.";
}

function formatAssignedAt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TemporarySupervisorAdmin() {
  const { isGlobalAdmin } = useBranch();
  const queryClient = useQueryClient();
  const todayLabel = fechaActualEcuador();

  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedDelegateId, setSelectedDelegateId] = useState("");
  const [reason, setReason] = useState("");
  const [revokeBranchId, setRevokeBranchId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["admin-supervisor-delegations", todayLabel],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_branch_supervisor_delegation_status" as never);
      if (error) throw error;
      return (data ?? []) as DelegationStatusRow[];
    },
    enabled: isGlobalAdmin,
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users-access", "supervisor-delegation"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users_access" as never);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        username: string;
        alias?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        full_name?: string | null;
        is_active: boolean;
      }>;
    },
    enabled: isGlobalAdmin,
  });

  const userOptions = useMemo<UserOption[]>(() => {
    return (usersQuery.data ?? [])
      .filter((user) => user.is_active)
      .map((user) => {
        const realName = getUserRealName(user);
        const alias = getUserAlias(user);
        return {
          id: user.id,
          alias,
          isActive: user.is_active,
          label: realName ? `${realName} (${alias})` : alias,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [usersQuery.data]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("assign_branch_supervisor_delegation" as never, {
        p_branch_id: selectedBranchId,
        p_delegate_user_id: selectedDelegateId,
        p_reason: reason.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      setErrorMessage(null);
      setInfoMessage("Supervisor temporal asignado. La vigencia es solo por el resto del dia (hora Ecuador).");
      setReason("");
      setSelectedDelegateId("");
      await queryClient.invalidateQueries({ queryKey: ["admin-supervisor-delegations"] });
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase.rpc("revoke_branch_supervisor_delegation" as never, {
        p_branch_id: branchId,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      setErrorMessage(null);
      setInfoMessage("Supervisor temporal revocado.");
      setRevokeBranchId(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-supervisor-delegations"] });
    },
    onError: (error) => {
      setRevokeBranchId(null);
      setErrorMessage(getErrorMessage(error));
    },
  });

  const selectedBranch = statusQuery.data?.find((row) => row.branch_id === selectedBranchId) ?? null;
  const canAssign = Boolean(selectedBranchId && selectedDelegateId && !assignMutation.isPending);

  if (!isGlobalAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Shield className="h-8 w-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-black text-slate-900">Acceso restringido</h2>
          <p className="max-w-sm text-sm text-slate-500">
            Solo los administradores globales pueden asignar supervision temporal de sucursales.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-orange-200 bg-white/90 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-primary">
            <UserCog className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-lg font-black text-foreground">Supervisor temporal</h2>
            <p className="text-sm text-muted-foreground">
              Asigna un suplente por el resto del dia ({todayLabel}, hora Ecuador). El supervisor permanente
              conserva sus poderes; ambos pueden operar como supervisoras ese dia. El suplente puede ser de otra
              sucursal: vera la sucursal delegada en su selector y debe cambiar a ella para operar.
            </p>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {infoMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {infoMessage}
        </div>
      )}

      <div className="rounded-[28px] border border-orange-200 bg-white/90 p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-muted-foreground">Nueva asignacion</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Sucursal</Label>
            <Select value={selectedBranchId || undefined} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="h-11 rounded-2xl">
                <SelectValue placeholder="Selecciona sucursal" />
              </SelectTrigger>
              <SelectContent>
                {(statusQuery.data ?? []).map((row) => (
                  <SelectItem key={row.branch_id} value={row.branch_id}>
                    {row.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBranch && (
              <p className="text-xs text-muted-foreground">
                Supervisor permanente: {selectedBranch.permanent_supervisor_name ?? "Sin asignar"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Supervisor temporal</Label>
            <Select value={selectedDelegateId || undefined} onValueChange={setSelectedDelegateId}>
              <SelectTrigger className="h-11 rounded-2xl">
                <SelectValue placeholder="Selecciona usuario" />
              </SelectTrigger>
              <SelectContent>
                {userOptions.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Motivo (opcional)</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. Ivonne no puede asistir hoy"
              className="h-11 rounded-2xl"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            className="rounded-2xl"
            disabled={!canAssign}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
            Asignar por hoy
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-orange-200 bg-white/90 shadow-sm">
        <div className="border-b border-orange-100 px-5 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Estado por sucursal</h3>
        </div>

        {statusQuery.isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="divide-y divide-orange-100">
            {(statusQuery.data ?? []).map((row) => {
              const hasDelegation = Boolean(row.delegation_id && row.delegate_user_id);

              return (
                <div key={row.branch_id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">{row.branch_name}</p>
                    <p className="text-sm text-muted-foreground">
                      Permanente: {row.permanent_supervisor_name ?? "Sin asignar"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Temporal hoy: {hasDelegation ? row.delegate_name : "Ninguno"}
                    </p>
                    {hasDelegation && (
                      <p className="text-xs text-muted-foreground">
                        Asignado {formatAssignedAt(row.assigned_at)}
                        {row.assigned_by_name ? ` por ${row.assigned_by_name}` : ""}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </p>
                    )}
                  </div>

                  {hasDelegation && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-destructive/30 text-destructive hover:bg-destructive/5"
                      disabled={revokeMutation.isPending}
                      onClick={() => setRevokeBranchId(row.branch_id)}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Revocar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={Boolean(revokeBranchId)} onOpenChange={(open) => !open && setRevokeBranchId(null)}>
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar supervisor temporal</AlertDialogTitle>
            <AlertDialogDescription>
              El usuario dejara de tener poderes de supervisor temporal en esta sucursal por el resto del dia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl"
              onClick={() => revokeBranchId && revokeMutation.mutate(revokeBranchId)}
            >
              Revocar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
