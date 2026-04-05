import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";

export interface BranchShiftGate {
  shiftId: string | null;
  shiftOpen: boolean;
  userEnabled: boolean;
  cashierId: string | null;
  captureUserId: string | null;
  activeTablesCount: number;
  cajaStatus: "UNOPENED" | "OPEN" | "CLOSED";
  canServeTables: boolean;
  canAccessOrders: boolean;
  canDispatchOrders: boolean;
  canManageProducts: boolean;
  canUseCaja: boolean;
  canAuthorizeOrderCancel: boolean;
  isSupervisor: boolean;
  isCaptureDeviceOnly: boolean;
  legacyFallbackApplied: boolean;
}

export function useBranchShiftGate() {
  const { activeBranchId } = useBranch();
  const { user } = useAuth();

  return useQuery({
    queryKey: ["branch-shift-gate", activeBranchId, user?.id ?? null],
    queryFn: async (): Promise<BranchShiftGate> => {
      if (!activeBranchId || !user?.id) {
        return {
          shiftId: null,
          shiftOpen: false,
          userEnabled: false,
          cashierId: null,
          captureUserId: null,
          activeTablesCount: 0,
          cajaStatus: "UNOPENED",
          canServeTables: false,
          canAccessOrders: false,
          canDispatchOrders: false,
          canManageProducts: false,
          canUseCaja: false,
          canAuthorizeOrderCancel: false,
          isSupervisor: false,
          isCaptureDeviceOnly: false,
          legacyFallbackApplied: false,
        };
      }

      const { data, error } = await supabase.rpc("get_my_branch_shift_gate" as never, {
        p_branch_id: activeBranchId,
      } as never);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const shiftId = row?.shift_id ?? null;

      if (!shiftId) {
        return {
          shiftId: null,
          shiftOpen: Boolean(row?.shift_open),
          userEnabled: Boolean(row?.user_enabled),
          cashierId: null,
          captureUserId: null,
          activeTablesCount: Number(row?.active_tables_count ?? 0),
          cajaStatus: row?.caja_status ?? "UNOPENED",
          canServeTables: Boolean(row?.can_serve_tables),
          canAccessOrders: Boolean(row?.can_access_orders ?? row?.can_serve_tables),
          canDispatchOrders: Boolean(row?.can_dispatch_orders),
          canManageProducts: Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
          canUseCaja: Boolean(row?.can_use_caja),
          canAuthorizeOrderCancel: Boolean(row?.can_authorize_order_cancel),
          isSupervisor: Boolean(row?.is_supervisor),
          isCaptureDeviceOnly: false,
          legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
        };
      }

      const { data: shiftMetaRow, error: shiftMetaError } = await (supabase
        .from("cash_shifts" as never)
        .select("cashier_id, capture_user_id")
        .eq("id", shiftId)
        .maybeSingle() as any);
      if (shiftMetaError) throw shiftMetaError;

      const { data: shiftUserRow, error: shiftUserError } = await (supabase
        .from("cash_shift_users" as never)
        .select("is_enabled, can_serve_tables, can_access_orders, can_dispatch_orders, can_manage_products, can_use_caja, can_authorize_order_cancel, is_supervisor")
        .eq("shift_id", shiftId)
        .eq("user_id", user.id)
        .maybeSingle() as any);

      if (shiftUserError) throw shiftUserError;

      const directUserEnabled = Boolean(shiftUserRow?.is_enabled);
      const hasDirectShiftRow = shiftUserRow != null;
      const cashierId = shiftMetaRow?.cashier_id ?? null;
      const captureUserId = shiftMetaRow?.capture_user_id ?? null;

      return {
        shiftId,
        shiftOpen: Boolean(row?.shift_open),
        userEnabled: hasDirectShiftRow ? directUserEnabled : Boolean(row?.user_enabled),
        cashierId,
        captureUserId,
        activeTablesCount: Number(row?.active_tables_count ?? 0),
        cajaStatus: row?.caja_status ?? "UNOPENED",
        canServeTables: hasDirectShiftRow ? Boolean(shiftUserRow?.can_serve_tables) : Boolean(row?.can_serve_tables),
        canAccessOrders: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_access_orders ?? shiftUserRow?.can_serve_tables)
          : Boolean(row?.can_access_orders ?? row?.can_serve_tables),
        canDispatchOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_dispatch_orders) : Boolean(row?.can_dispatch_orders),
        canManageProducts: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_manage_products ?? shiftUserRow?.can_dispatch_orders)
          : Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
        canUseCaja: hasDirectShiftRow ? Boolean(shiftUserRow?.can_use_caja) : Boolean(row?.can_use_caja),
        canAuthorizeOrderCancel: hasDirectShiftRow ? Boolean(shiftUserRow?.can_authorize_order_cancel) : Boolean(row?.can_authorize_order_cancel),
        isSupervisor: hasDirectShiftRow ? Boolean(shiftUserRow?.is_supervisor) : Boolean(row?.is_supervisor),
        isCaptureDeviceOnly: captureUserId === user.id && cashierId !== user.id,
        legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
      };
    },
    enabled: !!activeBranchId && !!user?.id,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
