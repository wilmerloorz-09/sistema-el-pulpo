import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

export interface BranchShiftGate {
  shiftId: string | null;
  shiftOpen: boolean;
  userEnabled: boolean;
  activeTablesCount: number;
  cajaStatus: "UNOPENED" | "OPEN" | "CLOSED";
  canServeTables: boolean;
  canDispatchOrders: boolean;
  canUseCaja: boolean;
  canAuthorizeOrderCancel: boolean;
  isSupervisor: boolean;
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
          cajaStatus: "UNOPENED",
          canServeTables: false,
          canDispatchOrders: false,
          canUseCaja: false,
          canAuthorizeOrderCancel: false,
          isSupervisor: false,
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
        cajaStatus: row?.caja_status ?? "UNOPENED",
        canServeTables: Boolean(row?.can_serve_tables),
        canDispatchOrders: Boolean(row?.can_dispatch_orders),
        canUseCaja: Boolean(row?.can_use_caja),
        canAuthorizeOrderCancel: Boolean(row?.can_authorize_order_cancel),
        isSupervisor: Boolean(row?.is_supervisor),
        legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
      };
    },
    enabled: !!activeBranchId,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
