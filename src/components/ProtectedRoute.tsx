import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Props {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  allowedModules?: string[];
}

const MODULE_FALLBACK_PATH: Record<string, string> = {
  mesas: "/mesas",
  ordenes: "/ordenes",
  despacho: "/despacho",
  caja: "/caja",
  pagos: "/caja",
  reportes: "/reportes",
  usuarios: "/admin",
  configuracion: "/admin",
};

const ProtectedRoute = ({ children, allowedRoles, allowedModules }: Props) => {
  const { user, loading, activeRole } = useAuth();
  const { allowedModules: currentModules } = useBranch();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && activeRole && !allowedRoles.includes(activeRole)) {
    return <Navigate to="/mesas" replace />;
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
