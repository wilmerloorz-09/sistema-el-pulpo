import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";

export const TAB_SESSION_ID = crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36);

export interface BranchShiftGate {
  shiftId: string | null;
  shiftOpen: boolean;
  userEnabled: boolean;
  lastSessionId: string | null;
  secondarySessionId: string | null;
  tabSessionId: string;
  cashierId: string | null;
  captureUserId: string | null;
  activeTablesCount: number;
  cajaStatus: "UNOPENED" | "OPEN" | "CLOSED";
  canServeTables: boolean;
  canAccessOrders: boolean;
  canEditOrders: boolean;
  canDispatchOrders: boolean;
  canManageProducts: boolean;
  canUseCaja: boolean;
  canAuthorizeOrderCancel: boolean;
  canDoubleSession: boolean;
  isSupervisor: boolean;
  isCaptureDeviceOnly: boolean;
  legacyFallbackApplied: boolean;
  isStaleShift: boolean;
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
          lastSessionId: null,
          secondarySessionId: null,
          tabSessionId: TAB_SESSION_ID,
          cashierId: null,
          captureUserId: null,
          activeTablesCount: 0,
          cajaStatus: "UNOPENED",
          canServeTables: false,
          canAccessOrders: false,
          canEditOrders: false,
          canDispatchOrders: false,
          canManageProducts: false,
          canUseCaja: false,
          canAuthorizeOrderCancel: false,
          canDoubleSession: false,
          isSupervisor: false,
          isCaptureDeviceOnly: false,
          legacyFallbackApplied: false,
          isStaleShift: false,
        };
      }

      const { data, error } = await supabase.rpc("get_my_branch_shift_gate" as any, {
        p_branch_id: activeBranchId,
      } as any);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const shiftId = row?.shift_id ?? null;

      if (!shiftId) {
        return {
          shiftId: null,
          shiftOpen: Boolean(row?.shift_open),
          userEnabled: Boolean(row?.user_enabled),
          lastSessionId: null,
          secondarySessionId: null,
          tabSessionId: TAB_SESSION_ID,
          cashierId: null,
          captureUserId: null,
          activeTablesCount: Number(row?.active_tables_count ?? 0),
          cajaStatus: row?.caja_status ?? "UNOPENED",
          canServeTables: Boolean(row?.can_serve_tables),
          canAccessOrders: Boolean(row?.can_access_orders ?? row?.can_serve_tables),
          canEditOrders: Boolean(row?.can_edit_orders),
          canDispatchOrders: Boolean(row?.can_dispatch_orders),
          canManageProducts: Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
          canUseCaja: Boolean(row?.can_use_caja),
          canAuthorizeOrderCancel: Boolean(row?.can_authorize_order_cancel),
          canDoubleSession: Boolean(row?.can_double_session),
          isSupervisor: Boolean(row?.is_supervisor),
          isCaptureDeviceOnly: false,
          legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
          isStaleShift: false,
        };
      }

      const { data: shiftMetaRow, error: shiftMetaError } = await (supabase
        .from("cash_shifts" as any)
        .select("cashier_id, capture_user_id, opened_at")
        .eq("id", shiftId)
        .maybeSingle() as any);
      if (shiftMetaError) throw shiftMetaError;

      const openedDate = shiftMetaRow?.opened_at ? new Date(shiftMetaRow.opened_at) : null;
      const today = new Date();
      const isStaleShift = openedDate 
        ? (openedDate.getFullYear() !== today.getFullYear() ||
           openedDate.getMonth() !== today.getMonth() ||
           openedDate.getDate() !== today.getDate())
        : false;

      const { data: shiftUserRow, error: shiftUserError } = await (supabase
        .from("cash_shift_users" as any)
        .select("is_enabled, can_serve_tables, can_access_orders, can_edit_orders, can_dispatch_orders, can_manage_products, can_use_caja, can_authorize_order_cancel, is_supervisor, can_double_session, last_session_id, secondary_session_id")
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
        lastSessionId: shiftUserRow?.last_session_id ?? null,
        secondarySessionId: shiftUserRow?.secondary_session_id ?? null,
        tabSessionId: TAB_SESSION_ID,
        cashierId,
        captureUserId,
        activeTablesCount: Number(row?.active_tables_count ?? 0),
        cajaStatus: row?.caja_status ?? "UNOPENED",
        canServeTables: hasDirectShiftRow ? Boolean(shiftUserRow?.can_serve_tables) : Boolean(row?.can_serve_tables),
        canAccessOrders: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_access_orders ?? shiftUserRow?.can_serve_tables)
          : Boolean(row?.can_access_orders ?? row?.can_serve_tables),
        canEditOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_edit_orders) : Boolean(row?.can_edit_orders),
        canDispatchOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_dispatch_orders) : Boolean(row?.can_dispatch_orders),
        canManageProducts: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_manage_products ?? shiftUserRow?.can_dispatch_orders)
          : Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
        canUseCaja: hasDirectShiftRow ? Boolean(shiftUserRow?.can_use_caja) : Boolean(row?.can_use_caja),
        canAuthorizeOrderCancel: hasDirectShiftRow ? Boolean(shiftUserRow?.can_authorize_order_cancel) : Boolean(row?.can_authorize_order_cancel),
        canDoubleSession: hasDirectShiftRow ? Boolean(shiftUserRow?.can_double_session) : Boolean(row?.can_double_session),
        isSupervisor: hasDirectShiftRow ? Boolean(shiftUserRow?.is_supervisor) : Boolean(row?.is_supervisor),
        isCaptureDeviceOnly: false,
        legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
        isStaleShift,
      };
    },
    enabled: !!activeBranchId && !!user?.id,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
