import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { usePreferredHomePath } from "@/hooks/usePreferredHomePath";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import { Button } from "@/components/ui/button";
import { hasPermission, canManage, type AccessLevel } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  allowedModules?: string[];
  requiredPermission?: {
    module: string;
    level: AccessLevel;
  };
  requiresOpenShift?: boolean;
  requiredShiftRoles?: Array<
    | "canServeTables"
    | "canAccessOrders"
    | "canEditOrders"
    | "canDispatchOrders"
    | "canManageProducts"
    | "canUseCaja"
    | "canPackOrders"
    | "puedeRegistrarPromociones"
    | "canServePlates"
  >;
  blockedShiftRoles?: Array<
    | "canServeTables"
    | "canAccessOrders"
    | "canEditOrders"
    | "canDispatchOrders"
    | "canManageProducts"
    | "canUseCaja"
    | "canPackOrders"
    | "puedeRegistrarPromociones"
    | "canServePlates"
  >;
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
  canPackOrders: "Empaquetador",
  puedeRegistrarPromociones: "Promociones",
  canServePlates: "Servir",
};

const ProtectedRoute = ({
  children,
  allowedModules,
  requiredPermission,
  requiresOpenShift = false,
  requiredShiftRoles,
  blockedShiftRoles,
}: Props) => {
  const { user, loading, signOut } = useAuth();
  const { permissions, allowedModules: currentModules, isGlobalAdmin, branches } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const location = useLocation();
  const { preferredPath, firstVisiblePath, canAccessAdmin: preferredCanAccessAdmin } = usePreferredHomePath();
  const { visibleItems } = useVisibleNavItems();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  /** Solo turno: no esperar `usePreferredHomePath` (incluye config despacho) para montar la pantalla. */
  const isBranchAdmin =
    Boolean(isGlobalAdmin)
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  // Sin data confirmada: loading, error o refetch en frío. Nunca tratar eso como “turno cerrado”.
  const shiftGateUnresolved =
    requiresOpenShift
    && !isBranchAdmin
    && !shiftGateQuery.data
    && (shiftGateQuery.isLoading || shiftGateQuery.isPending || shiftGateQuery.isFetching || shiftGateQuery.isError);

  if (shiftGateUnresolved) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-3 p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-center text-sm text-muted-foreground">
          {shiftGateQuery.isError
            ? "No se pudo verificar el turno. Reintentando…"
            : "Verificando estado del turno…"}
        </p>
        {shiftGateQuery.isError && (
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => void shiftGateQuery.refetch()}
          >
            Reintentar ahora
          </Button>
        )}
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
  const hasSupervisorBypass = Boolean(shiftGateQuery.data?.isSupervisor) || isBranchAdmin;
  const isCaptureDeviceOnly = Boolean(shiftGateQuery.data?.isCaptureDeviceOnly);
  
  const hasBlockedShiftRole = !hasSupervisorBypass && blockedShiftRoles && blockedShiftRoles.length > 0
    ? blockedShiftRoles.some((roleKey) => Boolean(shiftGateQuery.data?.[roleKey]))
    : false;
    
  const hasRequiredShiftRole = !requiredShiftRoles || requiredShiftRoles.length === 0
    ? true
    : requiredShiftRoles.some((roleKey) => Boolean(shiftGateQuery.data?.[roleKey]));
    
  const hasShiftAccess = requiresOpenShift && shiftOpen && userEnabled && (hasSupervisorBypass || (hasRequiredShiftRole && !hasBlockedShiftRole));

  const isStaleShift = Boolean(shiftGateQuery.data?.isStaleShift);
  const isAllowedModulePath = 
    location.pathname.startsWith("/turno") || 
    location.pathname.startsWith("/forzar-cierre-turno") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/reportes") ||
    location.pathname.startsWith("/monitoreo-global") ||
    location.pathname.startsWith("/promociones") ||
    location.pathname.startsWith("/campanas") ||
    location.pathname.startsWith("/clientes");

  const fallback = (() => {
    if (isStaleShift && canAccessTurno) return "/turno";
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

  if (isStaleShift && !isAllowedModulePath) {
    if (canAccessTurno) {
      return <Navigate to="/turno" replace />;
    }

    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-[28px] border border-red-200 bg-white/90 p-6 text-center shadow-[0_22px_55px_-42px_rgba(239,68,68,0.55)]">
          <h2 className="font-display text-xl font-black text-red-950">
            Turno expirado detectado
          </h2>
          <p className="mt-2 text-sm text-red-900/80">
            El sistema ha detectado un turno activo de un día anterior. Por seguridad y orden financiero, el sistema permanecerá bloqueado para esta sucursal hasta que el turno sea cerrado.
          </p>
          <p className="mt-4 text-sm font-bold text-red-950">
            Contacta a un administrador o supervisor para proceder con el cierre del turno anterior.
          </p>
          <div className="mt-6">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl border-red-200 text-red-950 hover:bg-red-50"
              onClick={() => void signOut()}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (requiresOpenShift && !isBranchAdmin) {
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

    if (!hasSupervisorBypass && (!hasRequiredShiftRole || hasBlockedShiftRole)) {
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
