import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import {
  isPathBlockedForRestrictedUser,
  isTemporarilyMenuRestrictedUser,
  safeHomePathForRestrictedUser,
} from "@/lib/menuAccessRestrictions";
import { canView } from "@/lib/permissions";

export function usePreferredHomePath() {
  const { profile } = useAuth();
  const { branches, isGlobalAdmin, permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const dispatchAccess = useDispatchAccess();
  const { visibleItems } = useVisibleNavItems();

  return useMemo(() => {
    const menuRestricted = isTemporarilyMenuRestrictedUser(profile);
    const canAccessAdmin = !menuRestricted && (
      isGlobalAdmin
      || canView(permissions, "admin_sucursal")
      || canView(permissions, "admin_global")
    );
    // admin1 sí puede Turno / Forzar cierre aunque el resto de Administración esté bloqueado.
    const canAccessTurno =
      canAccessAdmin
      || canView(permissions, "turno")
      || (menuRestricted && (isGlobalAdmin || canView(permissions, "admin_global") || canView(permissions, "admin_sucursal")));
    const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
    const gate = shiftGateQuery.data;
    const hasSupervisorBypass = Boolean(gate?.isSupervisor) || (isGlobalAdmin && !menuRestricted);
    const hasOperationalShift = Boolean(gate?.shiftOpen) && Boolean(gate?.userEnabled);
    const canAccessDispatch = hasSupervisorBypass
      || (Boolean(gate?.canDispatchOrders) && dispatchAccess.hasAccess);

    let preferredPath: string | null = null;

    if (menuRestricted && isGlobalAdminWithoutBranches) {
      preferredPath = safeHomePathForRestrictedUser([
        visibleItems[0]?.to,
        "/mesas",
        "/ordenes",
      ]);
    } else if (isGlobalAdminWithoutBranches) {
      preferredPath = "/admin";
    } else if (!gate?.shiftOpen || !gate?.userEnabled) {
      if (canAccessAdmin) preferredPath = "/admin";
      else if (canAccessTurno) preferredPath = "/turno";
      else if (menuRestricted) preferredPath = safeHomePathForRestrictedUser([visibleItems[0]?.to, "/mesas"]);
      else preferredPath = null;
    } else if (gate?.isCaptureDeviceOnly) {
      preferredPath = menuRestricted ? safeHomePathForRestrictedUser(["/mesas", "/ordenes"]) : "/caja";
    } else if (!hasSupervisorBypass && gate?.canPackOrders) {
      preferredPath = "/empaquetador";
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
    } else if ((hasSupervisorBypass || gate?.canUseCaja) && !menuRestricted) {
      preferredPath = "/caja";
    } else if (canAccessAdmin) {
      preferredPath = "/admin";
    } else if (canAccessTurno) {
      preferredPath = "/turno";
    } else if (menuRestricted) {
      preferredPath = safeHomePathForRestrictedUser([
        visibleItems[0]?.to,
        "/mesas",
        "/ordenes",
        "/turno",
      ]);
    }

    if (preferredPath && isPathBlockedForRestrictedUser(preferredPath, profile)) {
      preferredPath = safeHomePathForRestrictedUser([
        visibleItems[0]?.to,
        "/mesas",
        "/ordenes",
      ]);
    }

    return {
      preferredPath,
      firstVisiblePath: visibleItems.find((item) => !item.to.startsWith("/inventario"))?.to
        ?? visibleItems[0]?.to
        ?? null,
      canAccessAdmin,
      hasOperationalShift,
      // No esperar config de despacho: bloqueaba el login con otra round-trip.
      // Si el usuario solo tiene despacho, hasAccess puede resolverse un instante después.
      isLoading: shiftGateQuery.isLoading && !shiftGateQuery.data,
    };
  }, [
    branches.length,
    dispatchAccess.hasAccess,
    isGlobalAdmin,
    permissions,
    profile,
    shiftGateQuery.data,
    shiftGateQuery.isLoading,
    visibleItems,
  ]);
}
