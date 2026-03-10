import { useState, useEffect } from "react";
import { useDispatchConfig } from "@/hooks/useDispatchConfig";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { DispatchType } from "@/types/cancellation";

export default function DispatchConfig() {
  const { activeBranchId } = useBranch();
  const { config, assignments, isLoading, updateConfig, updateAssignment, removeAssignment } = useDispatchConfig();
  const [dispatchUsers, setDispatchUsers] = useState<Array<{ id: string; username: string; full_name: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedType, setSelectedType] = useState<DispatchType>("TABLE");

  // Load users when config is available - separate effect to avoid infinite loops
  useEffect(() => {
    const fetchUsers = async () => {
      if (!activeBranchId) return;
      setLoadingUsers(true);
      try {
        // Get users from this branch
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
            .filter((u, idx, arr) => arr.findIndex(x => x.id === u.id) === idx);

          setDispatchUsers(users);
        }
      } catch (error: any) {
        console.error("Error fetching users:", error);
        // Don't show error toast since config will still work without users fetched
      } finally {
        setLoadingUsers(false);
      }
    };

    // Only fetch users if we have a valid config (means initialization is done)
    if (config && activeBranchId) {
      fetchUsers();
    }
  }, [activeBranchId]); // Only depend on activeBranchId, NOT on config or updateConfig

  const handleModeChange = (mode: "SINGLE" | "SPLIT") => {
    updateConfig.mutate(mode);
  };

  const handleAddAssignment = () => {
    if (!selectedUser) {
      toast.error("Selecciona un despachador");
      return;
    }

    const user = dispatchUsers.find(u => u.id === selectedUser);
    updateAssignment.mutate(
      { userId: selectedUser, dispatchType: selectedType, fullName: user?.full_name },
      {
        onSuccess: () => {
          setSelectedUser("");
          setSelectedType("TABLE");
        },
      }
    );
  };

  const handleRemoveAssignment = (assignmentId: string) => {
    removeAssignment.mutate(assignmentId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If no config exists yet, show initialization UI
  if (!config) {
    return (
      <div className="space-y-6">
        <div className="p-6 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
            Configuración Inicial
          </h3>
          <p className="text-sm text-amber-800 dark:text-amber-300 mb-4">
            Selecciona el modo de despacho para esta sucursal
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => handleModeChange("SINGLE")}
              disabled={updateConfig.isPending}
              className={`p-4 rounded-xl border-2 transition-colors text-left ${
                updateConfig.isPending
                  ? "border-gray-300 bg-gray-100 cursor-not-allowed opacity-50"
                  : "border-blue-300 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
              }`}
            >
              {updateConfig.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              ) : null}
              <h4 className="font-semibold text-foreground">Un Despachador</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Un único despachador ve y despacha todas las órdenes
              </p>
            </button>

            <button
              onClick={() => handleModeChange("SPLIT")}
              disabled={updateConfig.isPending}
              className={`p-4 rounded-xl border-2 transition-colors text-left ${
                updateConfig.isPending
                  ? "border-gray-300 bg-gray-100 cursor-not-allowed opacity-50"
                  : "border-blue-300 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
              }`}
            >
              {updateConfig.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              ) : null}
              <h4 className="font-semibold text-foreground">Por Tipo de Orden</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Despachadores específicos para mesas y para llevar
              </p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const getTypeLabel = (type: DispatchType) => {
    switch (type) {
      case "ALL":
        return "Todos";
      case "TABLE":
        return "Órdenes de Mesa";
      case "TAKEOUT":
        return "Para Llevar";
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Selection */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Modo de Despacho</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => handleModeChange("SINGLE")}
            className={`p-4 rounded-xl border-2 transition-colors text-left ${
              config?.dispatch_mode === "SINGLE"
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Un Despachador</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Un único despachador ve y despacha todas las órdenes
            </p>
          </button>

          <button
            onClick={() => handleModeChange("SPLIT")}
            className={`p-4 rounded-xl border-2 transition-colors text-left ${
              config?.dispatch_mode === "SPLIT"
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <h4 className="font-semibold text-foreground">Por Tipo de Orden</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Despachadores específicos para mesas y para llevar
            </p>
          </button>
        </div>
      </div>

      {/* Assignments Section (only for SPLIT mode) */}
      {config?.dispatch_mode === "SPLIT" && (
        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Asignaciones de Despachadores</h3>

          {/* Add New Assignment */}
          <div className="space-y-2 p-4 bg-muted/30 rounded-xl">
            <label className="text-xs font-medium text-foreground block">Agregar Nueva Asignación</label>
            <div className="flex gap-2 flex-wrap">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="flex-1 min-w-[150px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
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
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="TABLE">Órdenes de Mesa</option>
                <option value="TAKEOUT">Para Llevar</option>
              </select>

              <Button
                onClick={handleAddAssignment}
                disabled={!selectedUser || updateAssignment.isPending}
                size="sm"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </div>
          </div>

          {/* Current Assignments */}
          {assignments.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground block">Asignaciones Actuales</label>
              <div className="space-y-2">
                {assignments.map((assignment) => {
                  const user = dispatchUsers.find(u => u.id === assignment.user_id);
                  return (
                    <div
                      key={assignment.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-card border border-border"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {user?.full_name || "Usuario"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getTypeLabel(assignment.dispatch_type)}
                        </p>
                      </div>
                      <Button
                        onClick={() => handleRemoveAssignment(assignment.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {assignments.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">No hay asignaciones. Agrega despachadores a los tipos de orden.</p>
            </div>
          )}
        </div>
      )}

      {/* Info for SINGLE mode */}
      {config?.dispatch_mode === "SINGLE" && (
        <div className="p-4 bg-accent/10 rounded-xl border border-accent/20">
          <p className="text-sm text-foreground">
            En modo <Badge className="ml-1">Un Despachador</Badge>, todos los usuarios con acceso a esta sucursal pueden despachar todas las órdenes sin necesidad de asignaciones específicas.
          </p>
        </div>
      )}
    </div>
  );
}

