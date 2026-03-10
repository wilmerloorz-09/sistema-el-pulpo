import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { hasPermission, type AccessLevel } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  allowedModules?: string[];
  requiredPermission?: {
    module: string;
    level: AccessLevel;
  };
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

const ProtectedRoute = ({ children, allowedModules, requiredPermission }: Props) => {
  const { user, loading } = useAuth();
  const { permissions, allowedModules: currentModules } = useBranch();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (requiredPermission && !hasPermission(permissions, requiredPermission.module, requiredPermission.level)) {
    const firstAllowed = currentModules.find((code) => MODULE_FALLBACK_PATH[code]);
    const fallback = firstAllowed ? MODULE_FALLBACK_PATH[firstAllowed] : "/mesas";
    return <Navigate to={fallback} replace />;
  }

  if (allowedModules && allowedModules.length > 0) {
    const hasModule = allowedModules.some((moduleCode) => currentModules.includes(moduleCode));
    if (!hasModule) {
      const firstAllowed = currentModules.find((code) => MODULE_FALLBACK_PATH[code]);
      const fallback = firstAllowed ? MODULE_FALLBACK_PATH[firstAllowed] : "/mesas";
      return <Navigate to={fallback} replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
