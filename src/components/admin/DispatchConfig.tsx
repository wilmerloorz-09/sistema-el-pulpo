import { useEffect, useMemo, useState } from "react";
import { useDispatchConfig, type DispatchAssignment, type DispatchConfig as DispatchConfigModel } from "@/hooks/useDispatchConfig";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { DispatchType } from "@/types/cancellation";

interface DispatchConfigProps {
  enabledUserIds?: string[];
  availableViewTypes?: Array<Extract<DispatchType, "TABLE" | "TAKEOUT">>;
  configOverride?: DispatchConfigModel | null;
  assignmentsOverride?: DispatchAssignment[];
  onConfigChange?: (nextConfig: DispatchConfigModel) => void;
  onAssignmentsChange?: (nextAssignments: DispatchAssignment[]) => void;
}

function dedupeAssignmentsByUser(items: DispatchAssignment[]) {
  const map = new Map<string, DispatchAssignment>();
  for (const item of items) {
    map.set(item.user_id, item);
  }
  return Array.from(map.values());
}

export default function DispatchConfig({
  enabledUserIds,
  availableViewTypes,
  configOverride,
  assignmentsOverride,
  onConfigChange,
  onAssignmentsChange,
}: DispatchConfigProps) {
  const { activeBranchId } = useBranch();
  const { config, assignments, isLoading, updateConfig, updateAssignment, removeAssignment } = useDispatchConfig();
  const [dispatchUsers, setDispatchUsers] = useState<Array<{ id: string; username: string; full_name: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedType, setSelectedType] = useState<DispatchType>("TABLE");
  const isControlled = Boolean(configOverride && onConfigChange && onAssignmentsChange);
  const currentConfig = configOverride ?? config;
  const currentAssignments = assignmentsOverride ?? assignments;
  const uniqueAssignments = useMemo(
    () => dedupeAssignmentsByUser(currentAssignments ?? []),
    [currentAssignments],
  );

  useEffect(() => {
    const fetchUsers = async () => {
      if (!activeBranchId) return;
      try {
        const { data: branchUsers } = await supabase
          .from("user_branches")
          .select("user_id, profiles!inner(id, full_name, username)")
          .eq("branch_id", activeBranchId);

        if (branchUsers) {
          const users = branchUsers
            .map((bu: any) => ({
              id: bu.user_id,
              username: bu.profiles?.username || "",
              full_name: bu.profiles?.full_name || bu.profiles?.username || "Usuario",
            }))
            .filter((u, idx, arr) => arr.findIndex((x) => x.id === u.id) === idx);

          setDispatchUsers(users);
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    };

    void fetchUsers();
  }, [activeBranchId]);

  const availableAssignmentTypes = useMemo(() => {
    if (availableViewTypes && availableViewTypes.length > 0) {
      return availableViewTypes;
    }

    const options: DispatchType[] = [];
    if (currentConfig?.table_enabled) options.push("TABLE");
    if (currentConfig?.takeout_enabled) options.push("TAKEOUT");
    return options;
  }, [availableViewTypes, currentConfig?.table_enabled, currentConfig?.takeout_enabled]);

  const availableDispatchUsers = useMemo(() => {
    if (!enabledUserIds) return dispatchUsers;
    if (enabledUserIds.length === 0) return [];
    const enabledSet = new Set(enabledUserIds);
    return dispatchUsers.filter((user) => enabledSet.has(user.id));
  }, [dispatchUsers, enabledUserIds]);

  useEffect(() => {
    if (availableAssignmentTypes.length === 0) return;
    if (!availableAssignmentTypes.includes(selectedType)) {
      setSelectedType(availableAssignmentTypes[0]);
    }
  }, [availableAssignmentTypes, selectedType]);

  useEffect(() => {
    if (!selectedUser) return;
    if (!availableDispatchUsers.some((user) => user.id === selectedUser)) {
      setSelectedUser("");
    }
  }, [availableDispatchUsers, selectedUser]);

  const handleModeChange = (mode: "SINGLE" | "SPLIT") => {
    if (!currentConfig) return;
    if (isControlled) {
      onConfigChange({
        ...currentConfig,
        dispatch_mode: mode,
      });
      if (mode === "SINGLE") {
        onAssignmentsChange([]);
      }
      return;
    }
    updateConfig.mutate({ dispatch_mode: mode });
  };

  const handleAddAssignment = () => {
    if (!selectedUser) {
      toast.error("Selecciona un despachador");
      return;
    }

    if (availableAssignmentTypes.length === 0) {
      toast.error("No hay vistas disponibles para asignar en este turno");
      return;
    }

    if (isControlled) {
      const nextAssignment: DispatchAssignment = {
        id: `draft-${selectedUser}-${selectedType}-${Date.now()}`,
        dispatch_config_id: currentConfig?.id ?? "",
        user_id: selectedUser,
        dispatch_type: selectedType,
        created_at: new Date().toISOString(),
      };
      onAssignmentsChange([
        ...(currentAssignments ?? []).filter((assignment) => assignment.user_id !== selectedUser),
        nextAssignment,
      ]);
      setSelectedUser("");
      setSelectedType(availableAssignmentTypes[0] ?? "TABLE");
      return;
    }

    updateAssignment.mutate(
      { userId: selectedUser, dispatchType: selectedType },
      {
        onSuccess: () => {
          setSelectedUser("");
          setSelectedType(availableAssignmentTypes[0] ?? "TABLE");
        },
      },
    );
  };

  const getTypeLabel = (type: DispatchType) => {
    switch (type) {
      case "ALL":
        return "Todos";
      case "TABLE":
        return "Mesa";
      case "TAKEOUT":
        return "Para llevar";
    }
  };

  if (isLoading || !currentConfig) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Modo de asignacion</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <button
            onClick={() => handleModeChange("SINGLE")}
            className={`rounded-xl border-2 p-3 text-left transition-colors sm:p-4 ${
              currentConfig.dispatch_mode === "SINGLE" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Un despachador</h4>
            <p className="mt-1 text-xs text-muted-foreground">En Despacho se mostraran las tabs Todos, Mesa y Para llevar segun las vistas disponibles.</p>
          </button>

          <button
            onClick={() => handleModeChange("SPLIT")}
            className={`rounded-xl border-2 p-3 text-left transition-colors sm:p-4 ${
              currentConfig.dispatch_mode === "SPLIT" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Por tipo de orden</h4>
            <p className="mt-1 text-xs text-muted-foreground">Cada despachador solo vera las ordenes del tipo que le asignes.</p>
          </button>
        </div>
      </div>

      {currentConfig.dispatch_mode === "SPLIT" && (
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Asignaciones de despachadores</h3>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-foreground">Agregar nueva asignacion</label>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              >
                <option value="">Selecciona despachador...</option>
                {availableDispatchUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}{user.username ? ` (@${user.username})` : ""}
                  </option>
                ))}
              </select>

              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as DispatchType)}
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                disabled={availableAssignmentTypes.length === 0}
              >
                {availableAssignmentTypes.length === 0 ? (
                  <option value="">Sin tipos habilitados</option>
                ) : (
                  availableAssignmentTypes.map((type) => (
                    <option key={type} value={type}>
                      {getTypeLabel(type)}
                    </option>
                  ))
                )}
              </select>

              <Button
                onClick={handleAddAssignment}
                disabled={!selectedUser || availableAssignmentTypes.length === 0 || availableDispatchUsers.length === 0 || updateAssignment.isPending}
                size="sm"
                className="h-10 w-full gap-2 lg:w-auto"
              >
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </div>
            {availableDispatchUsers.length === 0 && (
              <p className="text-xs text-amber-700">Primero habilita al menos un usuario del turno para poder asignarlo a despacho.</p>
            )}
          </div>

          {uniqueAssignments.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">Asignaciones actuales</label>
              <div className="space-y-2">
                {uniqueAssignments.map((assignment) => {
                  const user = dispatchUsers.find((u) => u.id === assignment.user_id);
                  const isEnabledForShift = !enabledUserIds || enabledUserIds.includes(assignment.user_id);
                  return (
                    <div
                      key={assignment.id}
                      className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between ${
                        isEnabledForShift ? "border-border bg-card" : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{user?.full_name || "Usuario"}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-muted-foreground">{getTypeLabel(assignment.dispatch_type)}</p>
                          {!isEnabledForShift && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                              Usuario no habilitado en este turno
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        onClick={() => {
                          if (isControlled) {
                            onAssignmentsChange((currentAssignments ?? []).filter((item) => item.user_id !== assignment.user_id));
                            return;
                          }
                          removeAssignment.mutate({ assignmentId: assignment.id, userId: assignment.user_id });
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-9"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-1 py-4 text-center text-sm text-muted-foreground">
              No hay asignaciones. Agrega despachadores a los tipos habilitados.
            </div>
          )}
        </div>
      )}

    </div>
  );
}
