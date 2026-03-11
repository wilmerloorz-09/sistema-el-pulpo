import { useMemo } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate, canView } from "@/lib/permissions";
import { useDispatchConfig } from "@/hooks/useDispatchConfig";

export type DispatchView = "TABLE" | "TAKEOUT";

export const DISPATCH_VIEW_LABELS: Record<DispatchView, string> = {
  TABLE: "Mesa",
  TAKEOUT: "Para llevar",
};

export function useDispatchAccess() {
  const { permissions } = useBranch();
  const { config, isConfigLoading } = useDispatchConfig();

  const access = useMemo(() => {
    const canViewTable = canView(permissions, "despacho_total") || canView(permissions, "despacho_mesa");
    const canViewTakeout = canView(permissions, "despacho_total") || canView(permissions, "despacho_para_llevar");
    const canOperateTable = canOperate(permissions, "despacho_total") || canOperate(permissions, "despacho_mesa");
    const canOperateTakeout = canOperate(permissions, "despacho_total") || canOperate(permissions, "despacho_para_llevar");

    const tableEnabled = config?.table_enabled ?? true;
    const takeoutEnabled = config?.takeout_enabled ?? true;

    const availableViews: DispatchView[] = [];
    if (canViewTable && tableEnabled) availableViews.push("TABLE");
    if (canViewTakeout && takeoutEnabled) availableViews.push("TAKEOUT");

    return {
      availableViews,
      hasAccess: availableViews.length > 0,
      showTabs: availableViews.length > 1,
      canViewTable,
      canViewTakeout,
      canOperateTable,
      canOperateTakeout,
      tableEnabled,
      takeoutEnabled,
      fallbackVisible: canViewTable || canViewTakeout,
    };
  }, [config?.table_enabled, config?.takeout_enabled, permissions]);

  return {
    ...access,
    isLoading: isConfigLoading,
    getViewLabel: (view: DispatchView) => DISPATCH_VIEW_LABELS[view],
    canOperateView: (view: DispatchView) => (view === "TABLE" ? access.canOperateTable : access.canOperateTakeout),
  };
}
