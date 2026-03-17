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
  Plus,
  PlayCircle,
  Power,
  Save,
  Truck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import DispatchConfig from "@/components/admin/DispatchConfig";
import BranchCancelPolicyEditor, { type BranchCancelPolicyDraftRow } from "@/components/admin/BranchCancelPolicyEditor";
import { useDispatchConfig, type DispatchAssignment, type DispatchConfig as DispatchConfigModel } from "@/hooks/useDispatchConfig";

interface ShiftUserRow {
  user_id: string;
  full_name: string;
  username: string;
  is_profile_active: boolean;
  is_enabled: boolean;
  can_serve_tables: boolean;
  can_dispatch_orders: boolean;
  can_use_caja: boolean;
  can_authorize_order_cancel: boolean;
  is_supervisor: boolean;
}

const OPERATIVE_ROLE_KEYS: Array<keyof Pick<
  ShiftUserRow,
  "can_serve_tables" | "can_dispatch_orders" | "can_use_caja" | "is_supervisor"
>> = ["can_serve_tables", "can_dispatch_orders", "can_use_caja", "is_supervisor"];

function hasOperationalCapability(user: ShiftUserRow) {
  return OPERATIVE_ROLE_KEYS.some((key) => user[key]);
}

function normalizeShiftUser(user: ShiftUserRow, useFallbackServeRole: boolean): ShiftUserRow {
  const normalized: ShiftUserRow = {
    ...user,
    is_enabled: user.is_enabled ?? false,
    can_serve_tables: user.can_serve_tables ?? false,
    can_dispatch_orders: user.can_dispatch_orders ?? false,
    can_use_caja: user.can_use_caja ?? false,
    can_authorize_order_cancel: user.can_authorize_order_cancel ?? false,
    is_supervisor: user.is_supervisor ?? false,
  };

  if (useFallbackServeRole && !hasOperationalCapability(normalized)) {
    normalized.can_serve_tables = true;
  }

  return normalized;
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

  setWarningDialog({
    open: true,
    title: "Revisa la configuracion del turno",
    description: rawMessage || "No se pudo guardar la configuracion del turno. Revisa los datos y vuelve a intentarlo.",
  });
}

const ShiftSetupAdmin = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId, activeBranch, isGlobalAdmin } = useBranch();
  const [activeTablesCount, setActiveTablesCount] = useState(0);
  const [shiftUsersState, setShiftUsersState] = useState<ShiftUserRow[]>([]);
  const [selectedUserToAdd, setSelectedUserToAdd] = useState("");
  const [cancelPolicyState, setCancelPolicyState] = useState<BranchCancelPolicyDraftRow[]>([]);
  const [cancelPoliciesDirty, setCancelPoliciesDirty] = useState(false);

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

  const cancelPolicyQuery = useQuery({
    queryKey: ["shift-admin-cancel-policy", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [] as BranchCancelPolicyDraftRow[];
      const { data, error } = await supabase.rpc("list_branch_cancel_policy_nodes" as never, {
        p_branch_id: activeBranchId,
      } as never);
      if (error) throw error;
      return ((data ?? []) as BranchCancelPolicyDraftRow[]).map((row) => ({
        ...row,
        descendant_product_count: Number(row.descendant_product_count ?? 0),
        is_primary_root_category: Boolean(row.is_primary_root_category),
        is_kitchen_plate: Boolean(row.is_kitchen_plate),
        allow_direct_cancel: Boolean(row.allow_direct_cancel),
      }));
    },
    enabled: !!activeBranchId,
  });

  const referenceCount = branchSettingsQuery.data?.referenceTableCount ?? 0;
  const isOpen = Boolean(shiftQuery.data);
  const allBranchUsers = shiftUsersQuery.data ?? [];
  const persistedTablesCount = isOpen ? shiftQuery.data?.active_tables_count ?? 0 : referenceCount;
  const persistedEnabledUsersData = useMemo(
    () =>
      allBranchUsers
        .filter((row) => row.is_enabled)
        .map((row) => normalizeShiftUser(row, false)),
    [allBranchUsers, isOpen],
  );
  const persistedEnabledUserIds = useMemo(
    () => persistedEnabledUsersData.map((row) => row.user_id),
    [persistedEnabledUsersData],
  );
  const persistedEnabledUserIdsKey = persistedEnabledUserIds.join("|");
  const enabledUserIds = useMemo(() => shiftUsersState.map((userState) => userState.user_id), [shiftUsersState]);
  const persistedCancelPolicies = useMemo(
    () => cancelPolicyQuery.data ?? [],
    [cancelPolicyQuery.data],
  );
  const availableUsersToAdd = useMemo(
    () => allBranchUsers.filter((branchUser) => !enabledUserIds.includes(branchUser.user_id)),
    [allBranchUsers, enabledUserIds],
  );
  const dispatchCapableUsers = useMemo(
    () => shiftUsersState.filter((userState) => userState.can_dispatch_orders || userState.is_supervisor),
    [shiftUsersState],
  );
  const dispatchCapableUserIds = useMemo(
    () => dispatchCapableUsers.map((userState) => userState.user_id),
    [dispatchCapableUsers],
  );

  useEffect(() => {
    setActiveTablesCount(persistedTablesCount);
  }, [persistedTablesCount]);

  useEffect(() => {
    setShiftUsersState(persistedEnabledUsersData);
  }, [persistedEnabledUserIdsKey, persistedEnabledUsersData]);

  useEffect(() => {
    if (!selectedUserToAdd) return;
    if (!availableUsersToAdd.some((branchUser) => branchUser.user_id === selectedUserToAdd)) {
      setSelectedUserToAdd("");
    }
  }, [availableUsersToAdd, selectedUserToAdd]);

  useEffect(() => {
    setDraftDispatchConfig(dispatchConfig ?? null);
  }, [dispatchConfig]);

  useEffect(() => {
    setDraftAssignments(assignments ?? []);
  }, [assignments]);

  useEffect(() => {
    setCancelPolicyState(persistedCancelPolicies);
    setCancelPoliciesDirty(false);
  }, [persistedCancelPolicies]);

  const workingDispatchConfig = draftDispatchConfig ?? dispatchConfig;
  const workingAssignments = draftAssignments;

  const enabledViews = useMemo(() => {
    const views: Array<{ code: "TABLE" | "TAKEOUT"; label: string }> = [];
    if (activeTablesCount > 0) views.push({ code: "TABLE", label: "Mesa" });
    views.push({ code: "TAKEOUT", label: "Para llevar" });
    return views;
  }, [activeTablesCount]);

  const enabledAssignments = useMemo(() => {
    const enabledSet = new Set(dispatchCapableUserIds);
    return workingAssignments.filter((assignment) => enabledSet.has(assignment.user_id));
  }, [dispatchCapableUserIds, workingAssignments]);

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

    if (enabledUserIds.length === 0) {
      issues.push("Debe haber por lo menos un usuario habilitado para este turno.");
    }

    const usersWithoutOperationalRole = shiftUsersState
      .filter((userState) => !hasOperationalCapability(userState))
      .map((userState) => userState.full_name || userState.username || "Usuario");

    if (usersWithoutOperationalRole.length > 0) {
      issues.push(`Cada usuario habilitado debe tener al menos un rol operativo. Revisa: ${usersWithoutOperationalRole.join(", ")}.`);
    }

    if (dispatchCapableUsers.length === 0) {
      issues.push("Debe haber por lo menos un usuario para despacho en este turno.");
    }

    if ((workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT") {
      if (enabledDispatchUserIds.length === 0) {
        issues.push("Debe haber por lo menos un usuario habilitado asignado a despacho.");
      }
      if (missingDispatchViews.length > 0) {
        issues.push(`Asigna al menos un despachador habilitado para: ${missingDispatchViews.join(", ")}.`);
      }
    }

    return Array.from(new Set(issues));
  }, [
    activeTablesCount,
    dispatchCapableUsers.length,
    workingDispatchConfig?.dispatch_mode,
    enabledDispatchUserIds.length,
    enabledUserIds.length,
    shiftUsersState.length,
    missingDispatchViews,
  ]);

  const hasSetupIssues = setupIssues.length > 0;
  const dispatchConfigChanged =
    (dispatchConfig?.dispatch_mode ?? "SINGLE") !== (workingDispatchConfig?.dispatch_mode ?? "SINGLE");
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
  const cancelPoliciesChanged =
    JSON.stringify(
      [...cancelPolicyState]
        .map((policy) => ({
          menu_node_id: policy.menu_node_id,
          is_kitchen_plate: policy.is_kitchen_plate,
          allow_direct_cancel: policy.allow_direct_cancel,
        }))
        .sort((a, b) => a.menu_node_id.localeCompare(b.menu_node_id)),
    ) !==
    JSON.stringify(
      [...persistedCancelPolicies]
        .map((policy) => ({
          menu_node_id: policy.menu_node_id,
          is_kitchen_plate: policy.is_kitchen_plate,
          allow_direct_cancel: policy.allow_direct_cancel,
        }))
        .sort((a, b) => a.menu_node_id.localeCompare(b.menu_node_id)),
    );
  const hasLocalChanges =
    activeTablesCount !== persistedTablesCount ||
    !sameMembers(shiftUsersState.map(u => u.user_id), persistedEnabledUserIds) ||
    JSON.stringify(shiftUsersState.map(u => ({
      can_serve_tables: u.can_serve_tables,
      can_dispatch_orders: u.can_dispatch_orders,
      can_use_caja: u.can_use_caja,
      can_authorize_order_cancel: u.can_authorize_order_cancel,
      is_supervisor: u.is_supervisor
    }))) !== JSON.stringify(persistedEnabledUsersData.map(u => ({
      can_serve_tables: u.can_serve_tables,
      can_dispatch_orders: u.can_dispatch_orders,
      can_use_caja: u.can_use_caja,
      can_authorize_order_cancel: u.can_authorize_order_cancel,
      is_supervisor: u.is_supervisor
    }))) ||
    dispatchConfigChanged ||
    assignmentsChanged ||
    cancelPoliciesChanged ||
    cancelPoliciesDirty;

  const validateSetup = () => {
    if (setupIssues.length > 0) {
      throw new Error(setupIssues[0]);
    }
  };

  const toggleUser = (userId: string, checked: boolean) => {
    setShiftUsersState((prev) => {
      if (checked) {
        const userRow = allBranchUsers.find((branchUser) => branchUser.user_id === userId);
        if (!userRow) return prev;

        return [...prev, normalizeShiftUser({ ...userRow, is_enabled: true }, true)];
      }
      return prev.filter((u) => u.user_id !== userId);
    });
  };

  const addSelectedUser = () => {
    if (!selectedUserToAdd) {
      toast.error("Selecciona un usuario para agregar al turno");
      return;
    }

    toggleUser(selectedUserToAdd, true);
    setSelectedUserToAdd("");
  };

  const updateUserRole = (userId: string, role: keyof ShiftUserRow, value: boolean) => {
    setShiftUsersState((prev) => prev.map((u) =>
      u.user_id === userId ? { ...u, [role]: value } : u
    ));
  };

  const invalidateShiftState = () => {
    qc.invalidateQueries({ queryKey: ["shift-admin-current-shift"] });
    qc.invalidateQueries({ queryKey: ["shift-admin-users"] });
    qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
    qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    qc.invalidateQueries({ queryKey: ["current-shift"] });
    qc.invalidateQueries({ queryKey: ["dispatch-config", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["dispatch-assignments"] });
    qc.invalidateQueries({ queryKey: ["shift-admin-cancel-policy", activeBranchId] });
  };

  const updateCancelPolicy = (
    menuNodeId: string,
    patch: Partial<Pick<BranchCancelPolicyDraftRow, "is_kitchen_plate" | "allow_direct_cancel">>,
  ) => {
    setCancelPolicyState((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.menu_node_id !== menuNodeId) return row;
        const updatedRow = { ...row, ...patch };
        if (
          updatedRow.allow_direct_cancel !== row.allow_direct_cancel
          || updatedRow.is_kitchen_plate !== row.is_kitchen_plate
        ) {
          changed = true;
        }
        return updatedRow;
      });

      if (changed) {
        setCancelPoliciesDirty(true);
      }

      return next;
    });
  };

  const persistDispatchDraft = async () => {
    if (!activeBranchId || !workingDispatchConfig) throw new Error("No hay configuracion de despacho");

    const upsertPayload = {
      branch_id: activeBranchId,
      dispatch_mode: workingDispatchConfig.dispatch_mode,
      table_enabled: activeTablesCount > 0,
      takeout_enabled: true,
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
      const dispatchUserSet = new Set(dispatchCapableUserIds);
      const sanitizedAssignments = workingAssignments
        .filter((assignment) => dispatchUserSet.has(assignment.user_id))
        .map((assignment) => ({
          dispatch_config_id: savedConfig.id,
          user_id: assignment.user_id,
          dispatch_type: assignment.dispatch_type,
        }));

      if (sanitizedAssignments.length > 0) {
        const insertResult = await (supabase
          .from("dispatch_assignments" as any)
          .insert(sanitizedAssignments) as any);
        if (insertResult.error) throw insertResult.error;
      }
    }
  };

  const persistCancelPolicyDraft = async () => {
    if (!activeBranchId) throw new Error("No hay sucursal activa");

    const payload = cancelPolicyState.map((row) => ({
      menu_node_id: row.menu_node_id,
      is_kitchen_plate: row.is_kitchen_plate,
      allow_direct_cancel: row.allow_direct_cancel,
    }));

    const { error } = await supabase.rpc("save_branch_cancel_policy" as never, {
      p_branch_id: activeBranchId,
      p_policies: payload,
    } as never);

    if (error) throw error;
  };

  const setShiftUserEnabledCompat = async (params: {
    shiftId: string;
    userId: string;
    isEnabled: boolean;
    canServeTables: boolean;
    canDispatchOrders: boolean;
    canUseCaja: boolean;
    canAuthorizeOrderCancel: boolean;
    isSupervisor: boolean;
  }) => {
    const rpcParams = {
      p_shift_id: params.shiftId,
      p_user_id: params.userId,
      p_is_enabled: params.isEnabled,
      p_can_serve_tables: params.canServeTables,
      p_can_dispatch_orders: params.canDispatchOrders,
      p_can_use_caja: params.canUseCaja,
      p_can_authorize_order_cancel: params.canAuthorizeOrderCancel,
      p_is_supervisor: params.isSupervisor,
    };

    const { error } = await supabase.rpc("set_shift_user_enabled" as never, rpcParams as never);

    if (!error) return;

    const message = String(error.message ?? "");
    const missingExtendedSignature =
      message.includes("Could not find the function public.set_shift_user_enabled")
      || message.includes("schema cache");

    if (!missingExtendedSignature) {
      throw error;
    }

    if (params.isEnabled) {
      const { error: upsertError } = await (supabase
        .from("cash_shift_users" as never)
        .upsert({
          shift_id: params.shiftId,
          user_id: params.userId,
          is_enabled: true,
          can_serve_tables: params.canServeTables,
          can_dispatch_orders: params.canDispatchOrders,
          can_use_caja: params.canUseCaja,
          can_authorize_order_cancel: params.canAuthorizeOrderCancel,
          is_supervisor: params.isSupervisor,
        } as never, {
          onConflict: "shift_id,user_id",
          ignoreDuplicates: false,
        }) as any);

      if (upsertError) throw upsertError;
      return;
    }

    const { error: deleteError } = await (supabase
      .from("cash_shift_users" as never)
      .delete()
      .eq("shift_id", params.shiftId)
      .eq("user_id", params.userId) as any);

    if (deleteError) throw deleteError;
  };

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No hay usuario autenticado");
      if (!activeBranchId) throw new Error("No hay sucursal activa");
      validateSetup();
      await persistDispatchDraft();
      await persistCancelPolicyDraft();

      const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
      const enabledUsersJson = shiftUsersState.map((u) => ({
        user_id: u.user_id,
        can_serve_tables: u.can_serve_tables,
        can_dispatch_orders: u.can_dispatch_orders,
        can_use_caja: u.can_use_caja,
        can_authorize_order_cancel: u.can_authorize_order_cancel,
        is_supervisor: u.is_supervisor,
      }));

      const { error } = await supabase.rpc("open_cash_shift_with_tables" as never, {
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_active_tables_count: normalizedCount,
        p_enabled_users: enabledUsersJson,
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
      await persistCancelPolicyDraft();

      const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
      const { error: tablesError } = await supabase.rpc("configure_shift_active_tables" as never, {
        p_branch_id: activeBranchId,
        p_shift_id: shiftQuery.data.id,
        p_active_tables_count: normalizedCount,
      } as never);
      if (tablesError) throw tablesError;

      const currentEnabledSet = new Set(persistedEnabledUserIds);
      const nextEnabledSet = new Set(enabledUserIds);

      const changedUsers = allBranchUsers.filter((row) => {
        const wasEnabled = currentEnabledSet.has(row.user_id);
        const isEnabled = nextEnabledSet.has(row.user_id);

        if (wasEnabled !== isEnabled) return true;
        if (!isEnabled) return false;

        const currentState = persistedEnabledUsersData.find((u) => u.user_id === row.user_id);
        const nextState = shiftUsersState.find((u) => u.user_id === row.user_id);
        if (!currentState || !nextState) return true;

        return currentState.can_serve_tables !== nextState.can_serve_tables
          || currentState.can_dispatch_orders !== nextState.can_dispatch_orders
          || currentState.can_use_caja !== nextState.can_use_caja
          || currentState.can_authorize_order_cancel !== nextState.can_authorize_order_cancel
          || currentState.is_supervisor !== nextState.is_supervisor;
      });

      await Promise.all(
        changedUsers.map(async (row) => {
          const nextState = shiftUsersState.find(u => u.user_id === row.user_id);
          await setShiftUserEnabledCompat({
            shiftId: shiftQuery.data!.id,
            userId: row.user_id,
            isEnabled: nextEnabledSet.has(row.user_id),
            canServeTables: nextState?.can_serve_tables ?? false,
            canDispatchOrders: nextState?.can_dispatch_orders ?? false,
            canUseCaja: nextState?.can_use_caja ?? false,
            canAuthorizeOrderCancel: nextState?.can_authorize_order_cancel ?? false,
            isSupervisor: nextState?.is_supervisor ?? false,
          });
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
    dispatchLoading ||
    cancelPolicyQuery.isLoading;

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
                {activeBranch?.name ?? "Sucursal activa"}: define mesas, usuarios y como se repartira el despacho antes de abrir.
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title="Estado"
            value={isOpen ? "Abierto" : "Cerrado"}
            description={shiftStatusDescription}
            icon={<PlayCircle className="h-5 w-5" />}
            tone={isOpen ? "emerald" : "amber"}
          />
          <MetricCard
            title="Usuarios del turno"
            value={`${shiftUsersState.length}`}
            description="Usuarios operativos habilitados"
            icon={<Users className="h-5 w-5" />}
            tone={shiftUsersState.length > 0 ? "violet" : "rose"}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700">
                <LayoutGrid className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-foreground sm:text-base">Numero de mesas</h4>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Define cuantas mesas estaran operativas en esta jornada.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
              Referencial sucursal: {referenceCount}
            </Badge>
          </div>

          <div className="mt-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-100 via-white to-cyan-100 p-3.5 shadow-sm sm:p-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Mesas habilitadas del turno
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              value={activeTablesCount}
              onChange={(event) => setActiveTablesCount(Math.max(0, parseInt(event.target.value, 10) || 0))}
              className="h-11 rounded-2xl text-center text-lg font-black sm:h-12 sm:text-xl xl:h-14 xl:text-2xl"
            />
          </div>
        </section>

        <BranchCancelPolicyEditor
          rows={cancelPolicyState}
          isGlobalAdmin={isGlobalAdmin}
          disabled={openShiftMutation.isPending || saveShiftMutation.isPending}
          onChange={updateCancelPolicy}
          className="h-full"
        />
      </div>

      <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground sm:text-base">Usuarios habilitados</h4>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Agrega solo los usuarios que operaran en este turno y luego define sus roles.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
            {enabledUserIds.length} de {shiftUsers.length} habilitados
          </Badge>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 p-3.5 shadow-sm sm:p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">
                  Agregar usuario al turno
                </label>
                <select
                  value={selectedUserToAdd}
                  onChange={(event) => setSelectedUserToAdd(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-violet-200 bg-white px-4 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-violet-400"
                >
                  <option value="">Selecciona un usuario de esta sucursal...</option>
                  {availableUsersToAdd.map((branchUser) => (
                    <option key={branchUser.user_id} value={branchUser.user_id}>
                      {(branchUser.full_name || branchUser.username || "Usuario")} {branchUser.username ? `(@${branchUser.username})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={addSelectedUser}
                  disabled={!selectedUserToAdd}
                  className="h-11 w-full gap-2 rounded-2xl xl:h-12 xl:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            </div>

            {availableUsersToAdd.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Todos los usuarios activos de esta sucursal ya fueron agregados al turno.
              </p>
            )}
          </div>

          {shiftUsersState.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-800">
              Todavia no has agregado usuarios a este turno.
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {shiftUsersState.map((branchUser) => {
                const userState = shiftUsersState.find((u) => u.user_id === branchUser.user_id);
                const isSupervisorLocked = !!userState?.is_supervisor && isOpen;

                return (
                  <div
                    key={branchUser.user_id}
                    className="flex flex-col gap-2.5 rounded-2xl border border-violet-200 bg-violet-50/80 px-3 py-2.5 transition-colors sm:min-h-[168px]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-bold text-foreground">
                            {branchUser.full_name || branchUser.username || "Usuario"}
                          </p>
                          {userState?.is_supervisor && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                              Supervisor
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">@{branchUser.username}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={isSupervisorLocked}
                        className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => toggleUser(branchUser.user_id, false)}
                        title={isSupervisorLocked ? "No puedes quitar al supervisor del turno abierto" : "Quitar usuario del turno"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="mt-1.5 grid gap-1.5 rounded-xl border border-violet-100 bg-white/60 p-2.5 shadow-sm md:grid-cols-2">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={userState?.can_serve_tables ?? false}
                          onCheckedChange={(c) => updateUserRole(branchUser.user_id, "can_serve_tables", c === true)}
                        />
                        <span className="text-muted-foreground">Mesero (Mesas)</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={userState?.can_dispatch_orders ?? false}
                          onCheckedChange={(c) => updateUserRole(branchUser.user_id, "can_dispatch_orders", c === true)}
                        />
                        <span className="text-muted-foreground">Despacho</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={userState?.can_use_caja ?? false}
                          onCheckedChange={(c) => updateUserRole(branchUser.user_id, "can_use_caja", c === true)}
                        />
                        <span className="text-muted-foreground">Cajero</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={userState?.can_authorize_order_cancel ?? false}
                          onCheckedChange={(c) => updateUserRole(branchUser.user_id, "can_authorize_order_cancel", c === true)}
                        />
                        <span className="text-muted-foreground">Autorizar anul.</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
                Define si despacho trabaja con un solo flujo o por tipo de orden, y quienes atenderan cada caso.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <DispatchConfig
            enabledUserIds={dispatchCapableUserIds}
            availableViewTypes={enabledViews.map((view) => view.code)}
            configOverride={workingDispatchConfig}
            assignmentsOverride={workingAssignments}
            onConfigChange={setDraftDispatchConfig}
            onAssignmentsChange={setDraftAssignments}
          />
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-gradient-to-r from-white via-orange-50 to-amber-50 p-4 shadow-sm sm:rounded-[26px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          {isOpen ? (
            <Button
              variant="secondary"
              onClick={() => saveShiftMutation.mutate()}
              disabled={!hasLocalChanges || saveShiftMutation.isPending}
              className="h-12 w-full md:w-auto"
            >
              {saveShiftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          ) : (
            <Button
              onClick={() => openShiftMutation.mutate()}
              disabled={openShiftMutation.isPending}
              className="h-12 w-full md:w-auto"
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
