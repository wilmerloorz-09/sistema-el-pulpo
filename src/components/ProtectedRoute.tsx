import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { canManage, hasPermission, type AccessLevel } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  allowedModules?: string[];
  requiredPermission?: {
    module: string;
    level: AccessLevel;
  };
  requiresOpenShift?: boolean;
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
  admin_sucursal: "/admin",
  admin_global: "/admin",
};

const ProtectedRoute = ({ children, allowedModules, requiredPermission, requiresOpenShift = false }: Props) => {
  const { user, loading } = useAuth();
  const { permissions, allowedModules: currentModules, isGlobalAdmin, branches } = useBranch();
  const shiftGateQuery = useBranchShiftGate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (requiresOpenShift && shiftGateQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
  const fallback = (() => {
    const firstAllowed = currentModules.find((code) => MODULE_FALLBACK_PATH[code]);
    if (firstAllowed) return MODULE_FALLBACK_PATH[firstAllowed];
    if (isGlobalAdminWithoutBranches) return "/admin";
    return "/mesas";
  })();

  if (requiredPermission) {
    const hasRequiredPermission = hasPermission(permissions, requiredPermission.module, requiredPermission.level)
      || (isGlobalAdmin && requiredPermission.module === "admin_global");

    if (!hasRequiredPermission) {
      return <Navigate to={fallback} replace />;
    }
  }

  if (allowedModules && allowedModules.length > 0) {
    const hasModule = allowedModules.some((moduleCode) => currentModules.includes(moduleCode))
      || (isGlobalAdmin && allowedModules.includes("admin_global"));

    if (!hasModule) {
      return <Navigate to={fallback} replace />;
    }
  }

  if (requiresOpenShift) {
    const shiftOpen = Boolean(shiftGateQuery.data?.shiftOpen);
    const canAccessAdmin = isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
    const userEnabled = Boolean(shiftGateQuery.data?.userEnabled) || canAccessAdmin;

    if (!shiftOpen || !userEnabled) {
      if (canAccessAdmin) {
        return <Navigate to="/admin" replace />;
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
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
