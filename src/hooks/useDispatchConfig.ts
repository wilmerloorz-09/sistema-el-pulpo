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
  table_enabled: boolean;
  takeout_enabled: boolean;
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

type DispatchConfigUpdate = Partial<Pick<DispatchConfig, "dispatch_mode" | "table_enabled" | "takeout_enabled">> | DispatchMode;

function createDefaultDispatchConfig(branchId: string): DispatchConfig {
  return {
    id: "",
    branch_id: branchId,
    dispatch_mode: "SINGLE",
    table_enabled: true,
    takeout_enabled: true,
    created_at: "",
    updated_at: "",
  };
}

export function useDispatchConfig() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();

  const fetchConfig = async (): Promise<DispatchConfig | null> => {
    if (!activeBranchId) return null;

    const result = await (supabase
      .from("dispatch_config" as any)
      .select("id, branch_id, dispatch_mode, table_enabled, takeout_enabled, created_at, updated_at")
      .eq("branch_id", activeBranchId)
      .maybeSingle() as any);

    if (result.error) {
      console.warn("[useDispatchConfig] Error loading config (using defaults):", result.error.message);
      return createDefaultDispatchConfig(activeBranchId);
    }

    if (!result.data) {
      return createDefaultDispatchConfig(activeBranchId);
    }

    const row = result.data as {
      id: string;
      branch_id: string;
      dispatch_mode: string;
      table_enabled?: boolean | null;
      takeout_enabled?: boolean | null;
      created_at: string;
      updated_at: string;
    };

    return {
      id: row.id,
      branch_id: row.branch_id,
      dispatch_mode: row.dispatch_mode === "SPLIT" ? "SPLIT" : "SINGLE",
      table_enabled: row.table_enabled ?? true,
      takeout_enabled: row.takeout_enabled ?? true,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };

  const configQuery = useQuery({
    queryKey: ["dispatch-config", activeBranchId],
    queryFn: fetchConfig,
    enabled: !!activeBranchId,
    retry: 1,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const fetchAssignments = async () => {
    if (!configQuery.data?.id) return [];

    const result = await (supabase
      .from("dispatch_assignments" as any)
      .select("*")
      .eq("dispatch_config_id", configQuery.data.id) as any);

    if (result.error) {
      console.error("Error fetching assignments:", result.error);
      return [];
    }

    return (result.data as DispatchAssignment[]) || [];
  };

  const assignmentsQuery = useQuery({
    queryKey: ["dispatch-assignments", configQuery.data?.id],
    queryFn: fetchAssignments,
    enabled: !!configQuery.data?.id,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const getUserDispatchType = (orderType: "TABLE" | "TAKEOUT"): DispatchType | null => {
    if (!user || !configQuery.data) return null;

    if (configQuery.data.dispatch_mode === "SINGLE") return "ALL";

    const userAssignments = assignmentsQuery.data?.filter((assignment) => assignment.user_id === user.id) || [];
    if (userAssignments.length === 0) return null;

    const assignedTypes = new Set(userAssignments.map((assignment) => assignment.dispatch_type));
    if (assignedTypes.has("ALL")) return "ALL";
    if (assignedTypes.has(orderType)) return orderType;

    return null;
  };

  const updateConfig = useMutation({
    mutationFn: async (input: DispatchConfigUpdate) => {
      if (!activeBranchId) throw new Error("No branch selected");

      const patch = typeof input === "string" ? { dispatch_mode: input } : input;
      const currentConfig = (qc.getQueryData(["dispatch-config", activeBranchId]) as DispatchConfig | undefined) ?? createDefaultDispatchConfig(activeBranchId);
      const previousMode = currentConfig.dispatch_mode;

      const upsertPayload = {
        branch_id: activeBranchId,
        dispatch_mode: patch.dispatch_mode ?? currentConfig.dispatch_mode,
        table_enabled: patch.table_enabled ?? currentConfig.table_enabled,
        takeout_enabled: patch.takeout_enabled ?? currentConfig.takeout_enabled,
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

      const updatedConfig = upsertResult.data as DispatchConfig;

      if ((patch.dispatch_mode ?? currentConfig.dispatch_mode) === "SINGLE" && previousMode === "SPLIT") {
        const assignments = assignmentsQuery.data || [];
        for (const assignment of assignments) {
          const deleteResult = await (supabase
            .from("dispatch_assignments" as any)
            .delete()
            .eq("id", assignment.id) as any);
          if (deleteResult.error) {
            console.error("Error deleting assignment:", deleteResult.error);
          }
        }
      }

      return updatedConfig;
    },
    onSuccess: (data) => {
      qc.setQueryData(["dispatch-config", activeBranchId], data);
      qc.invalidateQueries({ queryKey: ["dispatch-config", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["dispatch-assignments", data.id] });
      toast.success("Configuracion de despacho actualizada");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Error al actualizar configuracion de despacho");
    },
  });

  const updateAssignment = useMutation({
    mutationFn: async (params: { userId: string; dispatchType: DispatchType; fullName?: string }) => {
      if (!configQuery.data?.id) throw new Error("No config");

      const existingAssignments = (assignmentsQuery.data || []).filter((assignment) => assignment.user_id === params.userId);
      for (const assignment of existingAssignments) {
        const deleteResult = await (supabase
          .from("dispatch_assignments" as any)
          .delete()
          .eq("id", assignment.id) as any);

        if (deleteResult.error) throw deleteResult.error;
      }

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
    onError: () => {
      toast.error("Error al asignar despachador");
    },
  });

  const removeAssignment = useMutation({
    mutationFn: async (params: { assignmentId?: string; userId?: string }) => {
      let query = (supabase
        .from("dispatch_assignments" as any)
        .delete() as any);

      if (params.userId) {
        query = query.eq("user_id", params.userId);
      } else if (params.assignmentId) {
        query = query.eq("id", params.assignmentId);
      } else {
        throw new Error("No assignment reference");
      }

      const deleteResult = await query;
      if (deleteResult.error) throw deleteResult.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-assignments", configQuery.data?.id] });
      toast.success("Asignacion eliminada");
    },
    onError: () => {
      toast.error("Error al eliminar asignacion");
    },
  });

  return {
    config: configQuery.data,
    assignments: assignmentsQuery.data || [],
    isLoading: configQuery.isLoading || assignmentsQuery.isLoading,
    isConfigLoading: configQuery.isLoading,
    isAssignmentsLoading: assignmentsQuery.isLoading,
    updateConfig,
    updateAssignment,
    removeAssignment,
    getUserDispatchType,
  };
}
