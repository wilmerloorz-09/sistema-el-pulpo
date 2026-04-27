import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { usePreferredHomePath } from "@/hooks/usePreferredHomePath";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import { Button } from "@/components/ui/button";
import { hasPermission, type AccessLevel } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  allowedModules?: string[];
  requiredPermission?: {
    module: string;
    level: AccessLevel;
  };
  requiresOpenShift?: boolean;
  requiredShiftRoles?: Array<"canServeTables" | "canAccessOrders" | "canEditOrders" | "canDispatchOrders" | "canManageProducts" | "canUseCaja">;
}

const MODULE_FALLBACK_PATH: Record<string, string> = {
  mesas: "/mesas",
  ordenes: "/ordenes",
  despacho_total: "/despacho",
  despacho_mesa: "/despacho",
  despacho_para_llevar: "/despacho",
  caja: "/caja",
  reportes_sucursal: "/reportes",
  reportes_globales: "/reportes",
  turno: "/turno",
  admin_sucursal: "/admin",
  admin_global: "/admin",
};

const SHIFT_ROLE_LABELS: Record<NonNullable<Props["requiredShiftRoles"]>[number], string> = {
  canServeTables: "Mesas",
  canAccessOrders: "Ordenes",
  canEditOrders: "Editar Ordenes",
  canDispatchOrders: "Despacho",
  canManageProducts: "Productos",
  canUseCaja: "Caja",
};

const ProtectedRoute = ({
  children,
  allowedModules,
  requiredPermission,
  requiresOpenShift = false,
  requiredShiftRoles,
}: Props) => {
  const { user, loading, signOut } = useAuth();
  const { permissions, allowedModules: currentModules, isGlobalAdmin, branches } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const location = useLocation();
  const { preferredPath, firstVisiblePath, canAccessAdmin: preferredCanAccessAdmin, isLoading: preferredPathLoading } = usePreferredHomePath();
  const { visibleItems } = useVisibleNavItems();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (requiresOpenShift && (shiftGateQuery.isLoading || preferredPathLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
  const canAccessAdmin = isGlobalAdmin
    || hasPermission(permissions, "admin_sucursal", "VIEW")
    || hasPermission(permissions, "admin_global", "VIEW");
  const canAccessTurno = canAccessAdmin || hasPermission(permissions, "turno", "VIEW");
  const shiftOpen = Boolean(shiftGateQuery.data?.shiftOpen);
  const userEnabled = Boolean(shiftGateQuery.data?.userEnabled);
  const hasSupervisorBypass = Boolean(shiftGateQuery.data?.isSupervisor);
  const isCaptureDeviceOnly = Boolean(shiftGateQuery.data?.isCaptureDeviceOnly);
  const hasRequiredShiftRole = !requiredShiftRoles || requiredShiftRoles.length === 0
    ? true
    : requiredShiftRoles.some((roleKey) => Boolean(shiftGateQuery.data?.[roleKey]));
  const hasShiftAccess = requiresOpenShift && shiftOpen && userEnabled && (hasSupervisorBypass || hasRequiredShiftRole);

  const fallback = (() => {
    if (preferredPath) return preferredPath;
    if (firstVisiblePath) return firstVisiblePath;
    const firstVisibleItem = visibleItems[0]?.to;
    if (firstVisibleItem) return firstVisibleItem;
    const firstAllowed = currentModules.find((code) => MODULE_FALLBACK_PATH[code]);
    if (firstAllowed) return MODULE_FALLBACK_PATH[firstAllowed];
    if (isGlobalAdminWithoutBranches) return "/admin";
    if (canAccessAdmin || preferredCanAccessAdmin) return "/admin";
    if (canAccessTurno) return "/turno";
    return "/";
  })();

  if (requiresOpenShift) {
    if (!shiftOpen || !userEnabled) {
      if (canAccessTurno) {
        return <Navigate to={canAccessAdmin ? "/admin" : "/turno"} replace />;
      }

      return (
        <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-orange-200 bg-white/90 p-6 text-center shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)]">
            <h2 className="font-display text-xl font-black text-foreground">
              {!shiftOpen ? "No hay turno abierto" : "Tu usuario no esta habilitado en este turno"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {!shiftOpen
                ? "Los modulos operativos permanecen deshabilitados hasta que un administrador general o supervisor abra el turno desde Administracion."
                : "Tu usuario esta deshabilitado para este turno. Solicita al administrador o supervisor que lo habilite desde Administracion."}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              {canAccessTurno && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => {
                    window.location.href = "/turno";
                  }}
                >
                  Abrir turno
                </Button>
              )}
              <Button
                type="button"
                variant={canAccessTurno ? "ghost" : "outline"}
                className="rounded-2xl"
                onClick={() => void signOut()}
              >
                Ingresar con otro usuario
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (isCaptureDeviceOnly && location.pathname !== "/caja") {
      return <Navigate to="/caja" replace />;
    }

    if (!hasSupervisorBypass && !hasRequiredShiftRole) {
      const operationalFallback = preferredPath ?? firstVisiblePath ?? visibleItems[0]?.to ?? null;
      if (operationalFallback && operationalFallback !== location.pathname) {
        return <Navigate to={operationalFallback} replace />;
      }

      const requestedAreas = (requiredShiftRoles ?? []).map((role) => SHIFT_ROLE_LABELS[role]).join(" o ");

      return (
        <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-orange-200 bg-white/90 p-6 text-center shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)]">
            <h2 className="font-display text-xl font-black text-foreground">
              No tienes acceso operativo en este turno
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Tu usuario esta habilitado en la jornada, pero no tiene asignado el rol operativo necesario para entrar a {requestedAreas || "este modulo"}.
            </p>
          </div>
        </div>
      );
    }
  }

  if (requiredPermission && !hasShiftAccess) {
    const hasRequiredPermission = hasPermission(permissions, requiredPermission.module, requiredPermission.level)
      || (isGlobalAdmin && requiredPermission.module === "admin_global");

    if (!hasRequiredPermission) {
      return <Navigate to={fallback} replace />;
    }
  }

  if (allowedModules && allowedModules.length > 0 && !hasShiftAccess) {
    const hasModule = allowedModules.some((moduleCode) => currentModules.includes(moduleCode))
      || (isGlobalAdmin && allowedModules.includes("admin_global"));

    if (!hasModule) {
      return <Navigate to={fallback} replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
