import { useEffect, useMemo, useState } from "react";
import { useDispatchConfig } from "@/hooks/useDispatchConfig";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { DispatchType } from "@/types/cancellation";

export default function DispatchConfig() {
  const { activeBranchId } = useBranch();
  const { config, assignments, isLoading, updateConfig, updateAssignment, removeAssignment } = useDispatchConfig();
  const [dispatchUsers, setDispatchUsers] = useState<Array<{ id: string; username: string; full_name: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedType, setSelectedType] = useState<DispatchType>("TABLE");

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
    if (config?.table_enabled) options.push("TABLE");
    if (config?.takeout_enabled) options.push("TAKEOUT");
    return options;
  }, [config?.table_enabled, config?.takeout_enabled]);

  useEffect(() => {
    if (availableAssignmentTypes.length === 0) return;
    if (!availableAssignmentTypes.includes(selectedType)) {
      setSelectedType(availableAssignmentTypes[0]);
    }
  }, [availableAssignmentTypes, selectedType]);

  const handleModeChange = (mode: "SINGLE" | "SPLIT") => {
    updateConfig.mutate({ dispatch_mode: mode });
  };

  const handleToggleView = (key: "table_enabled" | "takeout_enabled", checked: boolean) => {
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

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Vistas habilitadas en la jornada</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Mesa</p>
              <p className="text-xs text-muted-foreground">Permite despachar ordenes de mesa en esta sucursal.</p>
            </div>
            <Switch checked={config.table_enabled} onCheckedChange={(checked) => handleToggleView("table_enabled", checked)} />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Para llevar</p>
              <p className="text-xs text-muted-foreground">Permite despachar ordenes para llevar en esta sucursal.</p>
            </div>
            <Switch checked={config.takeout_enabled} onCheckedChange={(checked) => handleToggleView("takeout_enabled", checked)} />
          </div>
        </div>

        {!config.table_enabled && !config.takeout_enabled && (
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
            className={`rounded-xl border-2 p-4 text-left transition-colors ${
              config.dispatch_mode === "SINGLE" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Un despachador</h4>
            <p className="mt-1 text-xs text-muted-foreground">La vista disponible se atiende sin asignaciones por tipo.</p>
          </button>

          <button
            onClick={() => handleModeChange("SPLIT")}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${
              config.dispatch_mode === "SPLIT" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Por tipo de orden</h4>
            <p className="mt-1 text-xs text-muted-foreground">Permite asignar despachadores especificos a Mesa o Para llevar.</p>
          </button>
        </div>
      </div>

      {config.dispatch_mode === "SPLIT" && (
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Asignaciones de despachadores</h3>

          <div className="space-y-2 rounded-xl bg-muted/30 p-4">
            <label className="block text-xs font-medium text-foreground">Agregar nueva asignacion</label>
            <div className="flex flex-wrap gap-2">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="min-w-[180px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Selecciona despachador...</option>
                {dispatchUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}{user.username ? ` (@${user.username})` : ""}
                  </option>
                ))}
              </select>

              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as DispatchType)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
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

              <Button onClick={handleAddAssignment} disabled={!selectedUser || availableAssignmentTypes.length === 0 || updateAssignment.isPending} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </div>
          </div>

          {assignments.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">Asignaciones actuales</label>
              <div className="space-y-2">
                {assignments.map((assignment) => {
                  const user = dispatchUsers.find((u) => u.id === assignment.user_id);
                  return (
                    <div key={assignment.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{user?.full_name || "Usuario"}</p>
                        <p className="text-xs text-muted-foreground">{getTypeLabel(assignment.dispatch_type)}</p>
                      </div>
                      <Button
                        onClick={() => removeAssignment.mutate(assignment.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
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

      {config.dispatch_mode === "SINGLE" && (
        <div className="rounded-xl border border-accent/20 bg-accent/10 p-4 text-sm text-foreground">
          En modo <Badge className="ml-1">Un despachador</Badge>, el modulo se sigue mostrando como una sola entrada y la vista disponible depende de permisos + jornada.
        </div>
      )}
    </div>
  );
}
