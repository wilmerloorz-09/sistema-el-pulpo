import { useMemo } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { canManage } from "@/lib/permissions";

export function usePreferredHomePath() {
  const { branches, isGlobalAdmin, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const dispatchAccess = useDispatchAccess();

  return useMemo(() => {
    const canAccessAdmin = isGlobalAdmin
      || canManage(permissions, "admin_sucursal")
      || canManage(permissions, "admin_global");
    const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
    const gate = shiftGateQuery.data;
    const hasSupervisorBypass = Boolean(gate?.isSupervisor) || canAccessAdmin;
    const hasOperationalShift = Boolean(gate?.shiftOpen) && Boolean(gate?.userEnabled);
    const canAccessDispatch = hasSupervisorBypass
      || (Boolean(gate?.canDispatchOrders) && dispatchAccess.hasAccess);

    let preferredPath: string | null = null;

    if (isGlobalAdminWithoutBranches) {
      preferredPath = "/admin";
    } else if (!gate?.shiftOpen || !gate?.userEnabled) {
      preferredPath = canAccessAdmin ? "/admin" : null;
    } else if (gate?.isCaptureDeviceOnly) {
      preferredPath = "/caja";
    } else if (hasSupervisorBypass || gate?.canServeTables) {
      preferredPath = "/mesas";
    } else if (hasSupervisorBypass || gate?.canAccessOrders) {
      preferredPath = "/ordenes";
    } else if (canAccessDispatch) {
      preferredPath = "/despacho";
    } else if (hasSupervisorBypass || gate?.canManageProducts) {
      preferredPath = "/productos";
    } else if (hasSupervisorBypass || gate?.canUseCaja) {
      preferredPath = "/caja";
    } else if (canAccessAdmin) {
      preferredPath = "/admin";
    }

    return {
      preferredPath,
      canAccessAdmin,
      hasOperationalShift,
      isLoading: shiftGateQuery.isLoading || dispatchAccess.isLoading,
    };
  }, [
    branches.length,
    dispatchAccess.hasAccess,
    dispatchAccess.isLoading,
    isGlobalAdmin,
    permissions,
    shiftGateQuery.data,
    shiftGateQuery.isLoading,
  ]);
}
