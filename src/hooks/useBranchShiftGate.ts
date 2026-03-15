import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

export interface BranchShiftGate {
  shiftId: string | null;
  shiftOpen: boolean;
  userEnabled: boolean;
  activeTablesCount: number;
  legacyFallbackApplied: boolean;
}

export function useBranchShiftGate() {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["branch-shift-gate", activeBranchId],
    queryFn: async (): Promise<BranchShiftGate> => {
      if (!activeBranchId) {
        return {
          shiftId: null,
          shiftOpen: false,
          userEnabled: false,
          activeTablesCount: 0,
          legacyFallbackApplied: false,
        };
      }

      const { data, error } = await supabase.rpc("get_my_branch_shift_gate" as never, {
        p_branch_id: activeBranchId,
      } as never);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;

      return {
        shiftId: row?.shift_id ?? null,
        shiftOpen: Boolean(row?.shift_open),
        userEnabled: Boolean(row?.user_enabled),
        activeTablesCount: Number(row?.active_tables_count ?? 0),
        legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
      };
    },
    enabled: !!activeBranchId,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
