import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  PlayCircle,
  Power,
  Save,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import DispatchConfig from "@/components/admin/DispatchConfig";
import { useDispatchConfig, type DispatchAssignment, type DispatchConfig as DispatchConfigModel } from "@/hooks/useDispatchConfig";

interface ShiftUserRow {
  user_id: string;
  full_name: string;
  username: string;
  is_profile_active: boolean;
  is_enabled: boolean;
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function showShiftSetupError(
  error: any,
  setWarningDialog: React.Dispatch<React.SetStateAction<{ open: boolean; title: string; description: string }>>,
) {
  const rawMessage = String(error?.message ?? "").trim();

  if (rawMessage.startsWith("No puedes reducir a") && rawMessage.includes("mesas sigan ocupadas:")) {
    const [, tables] = rawMessage.split("mesas sigan ocupadas:");
    const occupiedTables = (tables ?? "").trim();
    setWarningDialog({
      open: true,
      title: "No se puede reducir el numero de mesas",
      description: occupiedTables
        ? `Las siguientes mesas aun no estan libres: ${occupiedTables}. Libera esas mesas primero y luego vuelve a intentarlo.`
        : "Todavia hay mesas ocupadas fuera del nuevo limite. Libera esas mesas primero y luego vuelve a intentarlo.",
    });
    return;
  }

  toast.error(rawMessage || "No se pudo guardar la configuracion del turno");
}

const ShiftSetupAdmin = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const [activeTablesCount, setActiveTablesCount] = useState(0);
  const [enabledUserIds, setEnabledUserIds] = useState<string[]>([]);
  const [draftDispatchConfig, setDraftDispatchConfig] = useState<DispatchConfigModel | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<DispatchAssignment[]>([]);
  const [warningDialog, setWarningDialog] = useState({
    open: false,
    title: "",
    description: "",
  });

  const { config: dispatchConfig, assignments, isLoading: dispatchLoading } = useDispatchConfig();

  const branchSettingsQuery = useQuery({
    queryKey: ["shift-admin-branch-settings", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;
      const { data, error } = await supabase
        .from("branches")
        .select("reference_table_count")
        .eq("id", activeBranchId)
        .single();
      if (error) throw error;
      return {
        referenceTableCount: Number(data.reference_table_count ?? 0),
      };
    },
    enabled: !!activeBranchId,
  });

  const shiftQuery = useQuery({
    queryKey: ["shift-admin-current-shift", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id, status, opened_at, active_tables_count")
        .eq("branch_id", activeBranchId)
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            id: data.id,
            status: data.status,
            opened_at: data.opened_at,
            active_tables_count: Number(data.active_tables_count ?? 0),
          }
        : null;
    },
    enabled: !!activeBranchId,
  });

  const shiftUsersQuery = useQuery({
    queryKey: ["shift-admin-users", activeBranchId, shiftQuery.data?.id ?? "closed"],
    queryFn: async () => {
      if (!activeBranchId) return [] as ShiftUserRow[];
      const { data, error } = await supabase.rpc("list_shift_users_for_branch" as never, {
        p_branch_id: activeBranchId,
      } as never);
      if (error) throw error;
      return ((data ?? []) as ShiftUserRow[]).filter((row) => row.is_profile_active);
    },
    enabled: !!activeBranchId,
  });

  const referenceCount = branchSettingsQuery.data?.referenceTableCount ?? 0;
  const isOpen = Boolean(shiftQuery.data);
  const persistedTablesCount = isOpen ? shiftQuery.data?.active_tables_count ?? 0 : referenceCount;
  const persistedEnabledUserIds = useMemo(() => {
    const rows = shiftUsersQuery.data ?? [];
    return isOpen ? rows.filter((row) => row.is_enabled).map((row) => row.user_id) : rows.map((row) => row.user_id);
  }, [isOpen, shiftUsersQuery.data]);
  const persistedEnabledUserIdsKey = persistedEnabledUserIds.join("|");

  useEffect(() => {
    setActiveTablesCount(persistedTablesCount);
  }, [persistedTablesCount]);

  useEffect(() => {
    setEnabledUserIds(persistedEnabledUserIds);
  }, [persistedEnabledUserIdsKey]);

  useEffect(() => {
    setDraftDispatchConfig(dispatchConfig ?? null);
  }, [dispatchConfig]);

  useEffect(() => {
    setDraftAssignments(assignments ?? []);
  }, [assignments]);

  const workingDispatchConfig = draftDispatchConfig ?? dispatchConfig;
  const workingAssignments = draftAssignments;

  const enabledViews = useMemo(() => {
    const views: Array<{ code: "TABLE" | "TAKEOUT"; label: string }> = [];
    if (workingDispatchConfig?.table_enabled ?? true) views.push({ code: "TABLE", label: "Mesa" });
    if (workingDispatchConfig?.takeout_enabled ?? true) views.push({ code: "TAKEOUT", label: "Para llevar" });
    return views;
  }, [workingDispatchConfig?.table_enabled, workingDispatchConfig?.takeout_enabled]);

  const enabledAssignments = useMemo(() => {
    const enabledSet = new Set(enabledUserIds);
    return workingAssignments.filter((assignment) => enabledSet.has(assignment.user_id));
  }, [workingAssignments, enabledUserIds]);

  const enabledDispatchUserIds = useMemo(
    () => Array.from(new Set(enabledAssignments.map((assignment) => assignment.user_id))),
    [enabledAssignments],
  );

  const missingDispatchViews = useMemo(() => {
    if ((workingDispatchConfig?.dispatch_mode ?? "SINGLE") !== "SPLIT") return [] as string[];

    return enabledViews
      .filter((view) => !enabledAssignments.some((assignment) => assignment.dispatch_type === "ALL" || assignment.dispatch_type === view.code))
      .map((view) => view.label);
  }, [workingDispatchConfig?.dispatch_mode, enabledAssignments, enabledViews]);

  const setupIssues = useMemo(() => {
    const issues: string[] = [];

    if (enabledViews.length === 0) {
      issues.push("Debe haber por lo menos una vista habilitada para el turno: Mesa o Para llevar.");
    }

    if ((workingDispatchConfig?.table_enabled ?? true) && activeTablesCount <= 0) {
      issues.push("Si Mesa esta habilitado, debes configurar al menos una mesa activa para el turno.");
    }

    if (enabledUserIds.length === 0) {
      issues.push("Debe haber por lo menos un usuario habilitado para este turno.");
    }

    if ((workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT") {
      if (enabledDispatchUserIds.length === 0) {
        issues.push("Debe haber por lo menos un usuario habilitado asignado a despacho.");
      }
      if (missingDispatchViews.length > 0) {
        issues.push(`Asigna al menos un despachador habilitado para: ${missingDispatchViews.join(", ")}.`);
      }
    } else if (enabledUserIds.length === 0) {
      issues.push("Debe haber por lo menos un usuario disponible para despacho.");
    }

    return Array.from(new Set(issues));
  }, [
    activeTablesCount,
    workingDispatchConfig?.dispatch_mode,
    workingDispatchConfig?.table_enabled,
    enabledDispatchUserIds.length,
    enabledUserIds.length,
    enabledViews.length,
    missingDispatchViews,
  ]);

  const hasSetupIssues = setupIssues.length > 0;
  const dispatchConfigChanged =
    (dispatchConfig?.dispatch_mode ?? "SINGLE") !== (workingDispatchConfig?.dispatch_mode ?? "SINGLE") ||
    (dispatchConfig?.table_enabled ?? true) !== (workingDispatchConfig?.table_enabled ?? true) ||
    (dispatchConfig?.takeout_enabled ?? true) !== (workingDispatchConfig?.takeout_enabled ?? true);
  const assignmentsChanged =
    JSON.stringify(
      [...(assignments ?? [])]
        .map((item) => ({ user_id: item.user_id, dispatch_type: item.dispatch_type }))
        .sort((a, b) => `${a.user_id}-${a.dispatch_type}`.localeCompare(`${b.user_id}-${b.dispatch_type}`)),
    ) !==
    JSON.stringify(
      [...workingAssignments]
        .map((item) => ({ user_id: item.user_id, dispatch_type: item.dispatch_type }))
        .sort((a, b) => `${a.user_id}-${a.dispatch_type}`.localeCompare(`${b.user_id}-${b.dispatch_type}`)),
    );
  const hasLocalChanges =
    activeTablesCount !== persistedTablesCount ||
    !sameMembers(enabledUserIds, persistedEnabledUserIds) ||
    dispatchConfigChanged ||
    assignmentsChanged;

  const validateSetup = () => {
    if (setupIssues.length > 0) {
      throw new Error(setupIssues[0]);
    }
  };

  const toggleUser = (userId: string, checked: boolean) => {
    setEnabledUserIds((prev) => {
      if (checked) return [...new Set([...prev, userId])];
      return prev.filter((id) => id !== userId);
    });
  };

  const invalidateShiftState = () => {
    qc.invalidateQueries({ queryKey: ["shift-admin-current-shift"] });
    qc.invalidateQueries({ queryKey: ["shift-admin-users"] });
    qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
    qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    qc.invalidateQueries({ queryKey: ["current-shift"] });
    qc.invalidateQueries({ queryKey: ["dispatch-config", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["dispatch-assignments"] });
  };

  const persistDispatchDraft = async () => {
    if (!activeBranchId || !workingDispatchConfig) throw new Error("No hay configuracion de despacho");

    const upsertPayload = {
      branch_id: activeBranchId,
      dispatch_mode: workingDispatchConfig.dispatch_mode,
      table_enabled: workingDispatchConfig.table_enabled,
      takeout_enabled: workingDispatchConfig.takeout_enabled,
      updated_at: new Date().toISOString(),
    };

    const upsertResult = await (supabase
      .from("dispatch_config" as any)
      .upsert(upsertPayload, {
        onConflict: "branch_id",
        ignoreDuplicates: false,
      })
      .select("id, branch_id, dispatch_mode, table_enabled, takeout_enabled, created_at, updated_at")
      .single() as any);

    if (upsertResult.error) throw upsertResult.error;

    const savedConfig = upsertResult.data as DispatchConfigModel;

    const deleteResult = await (supabase
      .from("dispatch_assignments" as any)
      .delete()
      .eq("dispatch_config_id", savedConfig.id) as any);
    if (deleteResult.error) throw deleteResult.error;

    if (savedConfig.dispatch_mode === "SPLIT" && workingAssignments.length > 0) {
      const sanitizedAssignments = workingAssignments.map((assignment) => ({
        dispatch_config_id: savedConfig.id,
        user_id: assignment.user_id,
        dispatch_type: assignment.dispatch_type,
      }));

      const insertResult = await (supabase
        .from("dispatch_assignments" as any)
        .insert(sanitizedAssignments) as any);
      if (insertResult.error) throw insertResult.error;
    }
  };

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No hay usuario autenticado");
      if (!activeBranchId) throw new Error("No hay sucursal activa");
      validateSetup();
      await persistDispatchDraft();

      const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
      const { error } = await supabase.rpc("open_cash_shift_with_tables" as never, {
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_active_tables_count: normalizedCount,
        p_denoms: [],
        p_enabled_user_ids: enabledUserIds,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateShiftState();
      toast.success("Turno abierto correctamente");
    },
    onError: (err: any) => showShiftSetupError(err, setWarningDialog),
  });

  const saveShiftMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !shiftQuery.data?.id) throw new Error("No hay turno abierto");
      validateSetup();
      await persistDispatchDraft();

      const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
      const { error: tablesError } = await supabase.rpc("configure_shift_active_tables" as never, {
        p_branch_id: activeBranchId,
        p_shift_id: shiftQuery.data.id,
        p_active_tables_count: normalizedCount,
      } as never);
      if (tablesError) throw tablesError;

      const currentEnabledSet = new Set(persistedEnabledUserIds);
      const nextEnabledSet = new Set(enabledUserIds);
      const changedUsers = (shiftUsersQuery.data ?? []).filter(
        (row) => currentEnabledSet.has(row.user_id) !== nextEnabledSet.has(row.user_id),
      );

      await Promise.all(
        changedUsers.map(async (row) => {
          const { error } = await supabase.rpc("set_shift_user_enabled" as never, {
            p_shift_id: shiftQuery.data.id,
            p_user_id: row.user_id,
            p_is_enabled: nextEnabledSet.has(row.user_id),
          } as never);
          if (error) throw error;
        }),
      );
    },
    onSuccess: () => {
      invalidateShiftState();
      toast.success("Configuracion del turno guardada");
    },
    onError: (err: any) => showShiftSetupError(err, setWarningDialog),
  });

  const closeShiftMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !shiftQuery.data?.id) throw new Error("No hay turno abierto");
      const { error } = await supabase.rpc("close_cash_shift_with_tables" as never, {
        p_shift_id: shiftQuery.data.id,
        p_branch_id: activeBranchId,
        p_notes: "Cierre desde Administracion > Turno",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateShiftState();
      toast.success("Turno cerrado correctamente");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo cerrar el turno"),
  });

  if (!activeBranchId) {
    return (
      <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
        Selecciona una sucursal para administrar el turno.
      </div>
    );
  }

  const loading =
    branchSettingsQuery.isLoading ||
    shiftUsersQuery.isLoading ||
    shiftQuery.isLoading ||
    dispatchLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const enabledViewLabels = enabledViews.map((view) => view.label);
  const shiftUsers = shiftUsersQuery.data ?? [];
  const shiftStatusDescription = isOpen
    ? "La sucursal ya puede operar con la configuracion actual."
    : "Configura usuarios, vistas y mesas antes de abrir la jornada.";

  return (
    <>
      <div className="space-y-3 sm:space-y-4">
      <section className="rounded-[24px] border border-orange-200 bg-gradient-to-br from-white via-orange-50/70 to-amber-50/80 p-4 shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)] sm:rounded-[28px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-black text-foreground sm:text-lg">Configuracion del turno operativo</h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                {activeBranch?.name ?? "Sucursal activa"}: define mesas, usuarios y metodo de despacho antes de abrir.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                isOpen
                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                  : "border-orange-200 bg-orange-50 text-primary"
              }
            >
              {isOpen ? "Turno abierto" : "Turno cerrado"}
            </Badge>
            {isOpen && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => closeShiftMutation.mutate()}
                disabled={closeShiftMutation.isPending}
              >
                {closeShiftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                Cerrar turno
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Estado"
            value={isOpen ? "Abierto" : "Cerrado"}
            description={shiftStatusDescription}
            icon={<PlayCircle className="h-5 w-5" />}
            tone={isOpen ? "emerald" : "amber"}
          />
          <MetricCard
            title="Vistas habilitadas"
            value={enabledViewLabels.length > 0 ? enabledViewLabels.join(" + ") : "Ninguna"}
            description="Debe existir al menos una vista activa"
            icon={<Truck className="h-5 w-5" />}
            tone={enabledViewLabels.length > 0 ? "sky" : "rose"}
          />
          <MetricCard
            title="Usuarios del turno"
            value={`${enabledUserIds.length}`}
            description="Usuarios operativos habilitados"
            icon={<Users className="h-5 w-5" />}
            tone={enabledUserIds.length > 0 ? "violet" : "rose"}
          />
          <MetricCard
            title="Despacho"
            value={(workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT" ? `${enabledDispatchUserIds.length} asignados` : "Modo unico"}
            description={
              (workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT"
                ? missingDispatchViews.length > 0
                  ? `Falta cubrir: ${missingDispatchViews.join(", ")}`
                  : "Todas las vistas activas tienen despachador"
                : "Cualquier usuario habilitado puede atender la vista"
            }
            icon={<Truck className="h-5 w-5" />}
            tone={hasSetupIssues ? "rose" : "emerald"}
          />
        </div>

        <div className={`mt-4 rounded-[20px] border px-3 py-3 sm:rounded-[22px] sm:px-4 ${hasSetupIssues ? "border-amber-200 bg-amber-50/90" : "border-emerald-200 bg-emerald-50/90"}`}>
          <div className="flex items-start gap-3">
            {hasSetupIssues ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            )}
            <div className="space-y-1">
              <p className={`text-sm font-bold ${hasSetupIssues ? "text-amber-900" : "text-emerald-900"}`}>
                {hasSetupIssues ? "Faltan condiciones para abrir o guardar el turno" : "La configuracion del turno esta lista"}
              </p>
              {hasSetupIssues ? (
                <ul className="space-y-1 text-sm text-amber-800">
                  {setupIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-emerald-800">
                  Puedes abrir el turno o guardar los cambios actuales sin bloquear la operacion de la sucursal.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700">
              <LayoutGrid className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground sm:text-base">Numero de mesas</h4>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Solo aplica si la vista de Mesa esta habilitada en despacho.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
            Referencial sucursal: {referenceCount}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-100 via-white to-cyan-100 p-4 shadow-sm">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Mesas habilitadas del turno
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              value={activeTablesCount}
              onChange={(event) => setActiveTablesCount(Math.max(0, parseInt(event.target.value, 10) || 0))}
              className="h-12 rounded-2xl text-center text-xl font-black sm:h-14 sm:text-2xl"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/85 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Regla activa</p>
              <p className="mt-2 text-sm font-semibold text-amber-950">
                Si la vista Mesa esta encendida, no puede quedar en cero.
              </p>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50/85 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">Flexibilidad</p>
              <p className="mt-2 text-sm font-semibold text-violet-950">
                Puede ser mayor o menor a la referencia de sucursal segun la jornada.
              </p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50/85 p-4 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Al reducir mesas</p>
              <p className="mt-2 text-sm font-semibold text-rose-950">
                Todas las mesas que queden fuera del nuevo limite deben estar libres. Si alguna sigue ocupada o por cobrar, el sistema no dejara guardar.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground sm:text-base">Usuarios habilitados</h4>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Por defecto aparecen activos. Puedes desmarcar quien no operara en este turno.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
            {enabledUserIds.length} de {shiftUsers.length} habilitados
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {shiftUsers.map((branchUser) => {
            const checked = enabledUserIds.includes(branchUser.user_id);
            return (
              <label
                key={branchUser.user_id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 transition-colors sm:px-4 ${
                  checked ? "border-violet-200 bg-violet-50/80" : "border-border bg-card"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">
                    {branchUser.full_name || branchUser.username || "Usuario"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{branchUser.username}</p>
                </div>
                <Checkbox checked={checked} onCheckedChange={(nextChecked) => toggleUser(branchUser.user_id, nextChecked === true)} />
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground sm:text-base">Metodo de despacho</h4>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Define las vistas activas y quienes atienden el despacho de esta jornada.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {(workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT" ? "Asignado por tipo" : "Un despachador"}
            </Badge>
            {enabledViewLabels.map((label) => (
              <Badge key={label} variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                {label}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-[20px] border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-cyan-50/70 p-3 sm:rounded-[22px] sm:p-4">
          <DispatchConfig
            enabledUserIds={enabledUserIds}
            configOverride={workingDispatchConfig}
            assignmentsOverride={workingAssignments}
            onConfigChange={setDraftDispatchConfig}
            onAssignmentsChange={setDraftAssignments}
          />
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-gradient-to-r from-white via-orange-50 to-amber-50 p-4 shadow-sm sm:rounded-[26px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {isOpen ? (
            <Button
              variant="secondary"
              onClick={() => saveShiftMutation.mutate()}
              disabled={!hasLocalChanges || hasSetupIssues || saveShiftMutation.isPending}
              className="h-12 w-full sm:w-auto"
            >
              {saveShiftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          ) : (
            <Button
              onClick={() => openShiftMutation.mutate()}
              disabled={hasSetupIssues || openShiftMutation.isPending}
              className="h-12 w-full sm:w-auto"
            >
              {openShiftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Abrir turno
            </Button>
          )}
        </div>
      </section>
      </div>

      <AlertDialog open={warningDialog.open} onOpenChange={(open) => setWarningDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent className="max-w-md rounded-[24px] border border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-50 p-5 shadow-[0_30px_80px_-42px_rgba(245,158,11,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-black text-amber-950">
              {warningDialog.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-amber-900/80">
              {warningDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setWarningDialog({ open: false, title: "", description: "" })}
              className="w-full sm:w-auto"
            >
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ShiftSetupAdmin;
