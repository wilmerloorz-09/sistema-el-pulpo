import { useEffect, useMemo, useState } from "react";
import { useDispatchConfig, type DispatchAssignment, type DispatchConfig as DispatchConfigModel } from "@/hooks/useDispatchConfig";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { DispatchType } from "@/types/cancellation";

interface DispatchConfigProps {
  enabledUserIds?: string[];
  configOverride?: DispatchConfigModel | null;
  assignmentsOverride?: DispatchAssignment[];
  onConfigChange?: (nextConfig: DispatchConfigModel) => void;
  onAssignmentsChange?: (nextAssignments: DispatchAssignment[]) => void;
}

export default function DispatchConfig({
  enabledUserIds,
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
    const options: DispatchType[] = [];
    if (currentConfig?.table_enabled) options.push("TABLE");
    if (currentConfig?.takeout_enabled) options.push("TAKEOUT");
    return options;
  }, [currentConfig?.table_enabled, currentConfig?.takeout_enabled]);

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

  const handleToggleView = (key: "table_enabled" | "takeout_enabled", checked: boolean) => {
    if (!currentConfig) return;
    if (isControlled) {
      onConfigChange({
        ...currentConfig,
        [key]: checked,
      });
      return;
    }
    updateConfig.mutate({ [key]: checked });
  };

  const handleAddAssignment = () => {
    if (!selectedUser) {
      toast.error("Selecciona un despachador");
      return;
    }

    if (availableAssignmentTypes.length === 0) {
      toast.error("Habilita al menos un tipo de despacho en la jornada");
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
      onAssignmentsChange([...(currentAssignments ?? []), nextAssignment]);
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
        <h3 className="text-sm font-semibold text-foreground">Vistas habilitadas en la jornada</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Mesa</p>
              <p className="text-xs text-muted-foreground">Permite despachar ordenes de mesa en esta sucursal.</p>
            </div>
            <Switch checked={currentConfig.table_enabled} onCheckedChange={(checked) => handleToggleView("table_enabled", checked)} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Para llevar</p>
              <p className="text-xs text-muted-foreground">Permite despachar ordenes para llevar en esta sucursal.</p>
            </div>
            <Switch checked={currentConfig.takeout_enabled} onCheckedChange={(checked) => handleToggleView("takeout_enabled", checked)} />
          </div>
        </div>

        {!currentConfig.table_enabled && !currentConfig.takeout_enabled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No hay tipos de despacho habilitados. El modulo quedara sin vistas disponibles hasta activar al menos una.
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Modo de asignacion</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => handleModeChange("SINGLE")}
            className={`rounded-xl border-2 p-3 text-left transition-colors sm:p-4 ${
              currentConfig.dispatch_mode === "SINGLE" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Un despachador</h4>
            <p className="mt-1 text-xs text-muted-foreground">La vista disponible se atiende sin asignaciones por tipo.</p>
          </button>

          <button
            onClick={() => handleModeChange("SPLIT")}
            className={`rounded-xl border-2 p-3 text-left transition-colors sm:p-4 ${
              currentConfig.dispatch_mode === "SPLIT" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Por tipo de orden</h4>
            <p className="mt-1 text-xs text-muted-foreground">Permite asignar despachadores especificos a Mesa o Para llevar.</p>
          </button>
        </div>
      </div>

      {currentConfig.dispatch_mode === "SPLIT" && (
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Asignaciones de despachadores</h3>

          <div className="space-y-2 rounded-xl bg-muted/30 p-3 sm:p-4">
            <label className="block text-xs font-medium text-foreground">Agregar nueva asignacion</label>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto]">
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
                className="h-10 gap-2 md:w-auto"
              >
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </div>
            {availableDispatchUsers.length === 0 && (
              <p className="text-xs text-amber-700">Primero habilita al menos un usuario del turno para poder asignarlo a despacho.</p>
            )}
          </div>

          {currentAssignments.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">Asignaciones actuales</label>
              <div className="space-y-2">
                {currentAssignments.map((assignment) => {
                  const user = dispatchUsers.find((u) => u.id === assignment.user_id);
                  const isEnabledForShift = !enabledUserIds || enabledUserIds.includes(assignment.user_id);
                  return (
                    <div
                      key={assignment.id}
                      className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
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
                            onAssignmentsChange(currentAssignments.filter((item) => item.id !== assignment.id));
                            return;
                          }
                          removeAssignment.mutate(assignment.id);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No hay asignaciones. Agrega despachadores a los tipos habilitados.
            </div>
          )}
        </div>
      )}

      {currentConfig.dispatch_mode === "SINGLE" && (
        <div className="rounded-xl border border-accent/20 bg-accent/10 p-4 text-sm text-foreground">
          En modo <Badge className="ml-1">Un despachador</Badge>, el modulo se sigue mostrando como una sola entrada y la vista disponible depende de permisos + jornada.
        </div>
      )}
    </div>
  );
}
