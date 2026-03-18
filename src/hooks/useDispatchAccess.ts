import { useMemo } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { canOperate, canView } from "@/lib/permissions";
import { useDispatchConfig } from "@/hooks/useDispatchConfig";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

export type DispatchView = "ALL" | "TABLE" | "TAKEOUT";

export const DISPATCH_VIEW_LABELS: Record<DispatchView, string> = {
  ALL: "Todos",
  TABLE: "Mesa",
  TAKEOUT: "Para llevar",
};

export function useDispatchAccess() {
  const { permissions, isGlobalAdmin } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: isDispatchConfigLoading } = useDispatchConfig();
  const shiftGateQuery = useBranchShiftGate();

  const access = useMemo(() => {
    const hasDispatchShiftAccess = isGlobalAdmin
      || Boolean(shiftGateQuery.data?.isSupervisor)
      || Boolean(shiftGateQuery.data?.canDispatchOrders);
    const hasBaseViewTable = canView(permissions, "despacho_total") || canView(permissions, "despacho_mesa");
    const hasBaseViewTakeout = canView(permissions, "despacho_total") || canView(permissions, "despacho_para_llevar");
    const hasBaseOperateTable = canOperate(permissions, "despacho_total") || canOperate(permissions, "despacho_mesa");
    const hasBaseOperateTakeout = canOperate(permissions, "despacho_total") || canOperate(permissions, "despacho_para_llevar");
    const canViewTable = hasBaseViewTable || hasDispatchShiftAccess;
    const canViewTakeout = hasBaseViewTakeout || hasDispatchShiftAccess;
    const canOperateTable = hasBaseOperateTable || hasDispatchShiftAccess;
    const canOperateTakeout = hasBaseOperateTakeout || hasDispatchShiftAccess;

    const tableEnabled = config?.table_enabled ?? true;
    const takeoutEnabled = config?.takeout_enabled ?? true;
    const baseViews: Array<Extract<DispatchView, "TABLE" | "TAKEOUT">> = [];
    if (hasDispatchShiftAccess && canViewTable && tableEnabled) baseViews.push("TABLE");
    if (hasDispatchShiftAccess && canViewTakeout && takeoutEnabled) baseViews.push("TAKEOUT");

    const userAssignedTypes = new Set(
      (assignments ?? [])
        .filter((assignment) => assignment.user_id === user?.id)
        .map((assignment) => assignment.dispatch_type),
    );

    let scopedViews = baseViews;
    if (config?.dispatch_mode === "SPLIT" && !isGlobalAdmin && !shiftGateQuery.data?.isSupervisor) {
      if (userAssignedTypes.has("ALL")) {
        scopedViews = baseViews;
      } else if (userAssignedTypes.size > 0) {
        scopedViews = baseViews.filter((view) => userAssignedTypes.has(view));
      } else {
        scopedViews = [];
      }
    }

    const availableViews: DispatchView[] = [];
    if (scopedViews.length > 1) availableViews.push("ALL");
    availableViews.push(...scopedViews);

    return {
      availableViews,
      hasAccess: availableViews.length > 0,
      showTabs: availableViews.length > 1,
      canViewTable,
      canViewTakeout,
      canOperateTable: hasDispatchShiftAccess && canOperateTable,
      canOperateTakeout: hasDispatchShiftAccess && canOperateTakeout,
      canOperateAll: hasDispatchShiftAccess && (canOperateTable || canOperateTakeout),
      tableEnabled,
      takeoutEnabled,
      fallbackVisible: hasDispatchShiftAccess && (canViewTable || canViewTakeout),
    };
  }, [
    assignments,
    config?.dispatch_mode,
    config?.table_enabled,
    config?.takeout_enabled,
    isGlobalAdmin,
    permissions,
    shiftGateQuery.data?.canDispatchOrders,
    shiftGateQuery.data?.isSupervisor,
    user?.id,
  ]);

  return {
    ...access,
    isLoading: isDispatchConfigLoading || shiftGateQuery.isLoading,
    getViewLabel: (view: DispatchView) => DISPATCH_VIEW_LABELS[view],
    canOperateView: (view: DispatchView) => (
      view === "ALL"
        ? access.canOperateAll
        : view === "TABLE"
          ? access.canOperateTable
          : access.canOperateTakeout
    ),
  };
}
