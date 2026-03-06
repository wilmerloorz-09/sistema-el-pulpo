import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { DispatchMode, DispatchType } from "@/types/cancellation";

export interface DispatchConfig {
  id: string;
  branch_id: string;
  dispatch_mode: DispatchMode;
  created_at: string;
  updated_at: string;
}

export interface DispatchAssignment {
  id: string;
  dispatch_config_id: string;
  user_id: string;
  dispatch_type: DispatchType;
  created_at: string;
}

export function useDispatchConfig() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();

  // Helper to fetch dispatch config
  const fetchConfig = async () => {
    if (!activeBranchId) return null;

    const result = await (supabase
      .from("dispatch_config" as any)
      .select("*")
      .eq("branch_id", activeBranchId)
      .single() as any);

    // Handle "no rows found" error - return null, don't create automatically
    // This allows the component to show a loading state or default UI
    if (result.error && result.error.code === "PGRST116") {
      console.log("No dispatch config found for branch, will be created on first update");
      return null;
    }

    if (result.error) {
      console.error("Error fetching dispatch config:", result.error);
      throw result.error;
    }

    return (result.data as DispatchConfig) || null;
  };

  // Get dispatch configuration for the branch
  const configQuery = useQuery({
    queryKey: ["dispatch-config", activeBranchId],
    queryFn: fetchConfig,
    enabled: !!activeBranchId,
    retry: 1, // Only retry once to avoid infinite loops
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Helper to fetch dispatch assignments
  const fetchAssignments = async () => {
    if (!configQuery.data?.id) return [];

    const result = await (supabase
      .from("dispatch_assignments" as any)
      .select("*")
      .eq("dispatch_config_id", configQuery.data.id) as any);

    if (result.error) {
      // Log but don't throw - assignments are optional
      console.error("Error fetching assignments:", result.error);
      return [];
    }

    return (result.data as DispatchAssignment[]) || [];
  };

  // Get assignments for the current configuration
  const assignmentsQuery = useQuery({
    queryKey: ["dispatch-assignments", configQuery.data?.id],
    queryFn: fetchAssignments,
    enabled: !!configQuery.data?.id,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  // Check if current user has assignment for order type
  const getUserDispatchType = (orderType: "TABLE" | "TAKEOUT"): DispatchType | null => {
    if (!user || !configQuery.data) return null;

    if (configQuery.data.dispatch_mode === "SINGLE") return "ALL";

    const userAssignments = assignmentsQuery.data?.filter(a => a.user_id === user.id) || [];
    if (userAssignments.length === 0) return null;

    const assignedTypes = new Set(userAssignments.map(a => a.dispatch_type));
    if (assignedTypes.has("ALL")) return "ALL";
    if (assignedTypes.has(orderType)) return orderType;

    return null;
  };

  const updateConfig = useMutation({
    mutationFn: async (mode: DispatchMode) => {
      if (!activeBranchId) {
        throw new Error("No branch selected");
      }

      if (!mode || (mode !== "SINGLE" && mode !== "SPLIT")) {
        throw new Error(`Invalid dispatch mode: ${mode}`);
      }

      // Use UPSERT to handle both INSERT and UPDATE cases
      // This ensures the operation succeeds whether the record exists or not
      const upsertResult = await (supabase
        .from("dispatch_config" as any)
        .upsert(
          {
            branch_id: activeBranchId,
            dispatch_mode: mode,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "branch_id", // Use branch_id as the conflict resolution key
            ignoreDuplicates: false, // Always update if conflict exists
          }
        )
        .select()
        .single() as any);

      if (upsertResult.error) {
        console.error("Error upserting dispatch config:", {
          error: upsertResult.error,
          errorCode: upsertResult.error?.code,
          errorMessage: upsertResult.error?.message,
          branchId: activeBranchId,
          mode: mode,
        });
        throw upsertResult.error;
      }

      const updatedConfig = upsertResult.data as DispatchConfig;

      // If switching from SPLIT to SINGLE, clean up assignments
      if (mode === "SINGLE" && qc.getQueryData(["dispatch-config", activeBranchId])?.dispatch_mode === "SPLIT") {
        const assignments = assignmentsQuery.data || [];
        if (assignments.length > 0) {
          for (const a of assignments) {
            const deleteResult = await (supabase
              .from("dispatch_assignments" as any)
              .delete()
              .eq("id", a.id) as any);
            
            if (deleteResult.error) {
              console.error("Error deleting assignment:", deleteResult.error);
              // Don't fail the whole operation if assignment deletion fails
            }
          }
        }
      }

      return updatedConfig;
    },
    onSuccess: (data) => {
      qc.setQueryData(["dispatch-config", activeBranchId], data);
      qc.invalidateQueries({ queryKey: ["dispatch-config", activeBranchId] });
      toast.success("Modo de despacho actualizado correctamente");
    },
    onError: (error: any) => {
      console.error("Mutation error details:", error);
      const errorMessage = error?.message || "Error al actualizar configuración de despacho";
      toast.error(errorMessage);
    },
  });

  const updateAssignment = useMutation({
    mutationFn: async (params: { userId: string; dispatchType: DispatchType; fullName?: string }) => {
      if (!configQuery.data?.id) throw new Error("No config");

      const insertResult = await (supabase
        .from("dispatch_assignments" as any)
        .insert({
          dispatch_config_id: configQuery.data.id,
          user_id: params.userId,
          dispatch_type: params.dispatchType,
        })
        .select()
        .single() as any);

      if (insertResult.error) throw insertResult.error;
      return insertResult.data as DispatchAssignment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-assignments", configQuery.data?.id] });
      toast.success("Despachador asignado");
    },
    onError: (error: any) => {
      console.error("Error assigning dispatcher:", error);
      toast.error("Error al asignar despachador");
    },
  });

  const removeAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      const deleteResult = await (supabase
        .from("dispatch_assignments" as any)
        .delete()
        .eq("id", assignmentId) as any);

      if (deleteResult.error) throw deleteResult.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-assignments", configQuery.data?.id] });
      toast.success("Asignación eliminada");
    },
    onError: (error: any) => {
      console.error("Error removing assignment:", error);
      toast.error("Error al eliminar asignación");
    },
  });

  return {
    config: configQuery.data,
    assignments: assignmentsQuery.data || [],
    isLoading: configQuery.isLoading || assignmentsQuery.isLoading,
    updateConfig,
    updateAssignment,
    removeAssignment,
    getUserDispatchType,
  };
}
