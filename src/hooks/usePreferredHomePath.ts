import { useMemo } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import { canView } from "@/lib/permissions";

export function usePreferredHomePath() {
  const { branches, isGlobalAdmin, permissions, activeBranch } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const dispatchAccess = useDispatchAccess();
  const { visibleItems } = useVisibleNavItems();

  return useMemo(() => {
    const isDispatchFirstWorkflow = activeBranch?.workflow_mode === "DISPATCH_THEN_CASH";
    const canAccessAdmin = isGlobalAdmin
      || canView(permissions, "admin_sucursal")
      || canView(permissions, "admin_global");
    const canAccessTurno = canAccessAdmin || canView(permissions, "turno");
    const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
    const gate = shiftGateQuery.data;
    const hasSupervisorBypass = Boolean(gate?.isSupervisor);
    const hasOperationalShift = Boolean(gate?.shiftOpen) && Boolean(gate?.userEnabled);
    const canAccessDispatch = hasSupervisorBypass
      || (Boolean(gate?.canDispatchOrders) && dispatchAccess.hasAccess);

    let preferredPath: string | null = null;

    if (isGlobalAdminWithoutBranches) {
      preferredPath = "/admin";
    } else if (!gate?.shiftOpen || !gate?.userEnabled) {
      preferredPath = canAccessAdmin ? "/admin" : (canAccessTurno ? "/turno" : null);
    } else if (gate?.isCaptureDeviceOnly) {
      preferredPath = "/caja";
    } else if (!hasSupervisorBypass && gate?.canPackOrders && !isDispatchFirstWorkflow) {
      preferredPath = "/extra";
    } else if (hasSupervisorBypass || gate?.canServeTables) {
      preferredPath = "/mesas";
    } else if (hasSupervisorBypass || gate?.canAccessOrders) {
      preferredPath = "/ordenes";
    } else if (hasSupervisorBypass || gate?.canEditOrders) {
      preferredPath = "/editar-orden";
    } else if (canAccessDispatch) {
      preferredPath = "/despacho";
    } else if (hasSupervisorBypass || gate?.canManageProducts) {
      preferredPath = "/productos";
    } else if (hasSupervisorBypass || gate?.canUseCaja) {
      preferredPath = "/caja";
    } else if (canAccessAdmin) {
      preferredPath = "/admin";
    } else if (canAccessTurno) {
      preferredPath = "/turno";
    }

    return {
      preferredPath,
      firstVisiblePath: visibleItems[0]?.to ?? null,
      canAccessAdmin,
      hasOperationalShift,
      // No esperar config de despacho: bloqueaba el login con otra round-trip.
      // Si el usuario solo tiene despacho, hasAccess puede resolverse un instante después.
      isLoading: shiftGateQuery.isLoading && !shiftGateQuery.data,
    };
  }, [
    activeBranch?.workflow_mode,
    branches.length,
    dispatchAccess.hasAccess,
    isGlobalAdmin,
    permissions,
    shiftGateQuery.data,
    shiftGateQuery.isLoading,
    visibleItems,
  ]);
}
