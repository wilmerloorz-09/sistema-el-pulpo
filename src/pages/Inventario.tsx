import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { isTemporarilyMenuRestrictedUser } from "@/lib/menuAccessRestrictions";
import { canOperate, canView } from "@/lib/permissions";

const Inventario = () => {
  const { profile } = useAuth();
  const { isGlobalAdmin, permissions } = useBranch();

  if (isTemporarilyMenuRestrictedUser(profile)) {
    return <Navigate to="/mesas" replace />;
  }

  const canBodegaGeneral =
    isGlobalAdmin
    || canOperate(permissions, "bodega_general")
    || canView(permissions, "bodega_general");
  const canBodegaSucursal =
    isGlobalAdmin
    || canOperate(permissions, "bodega_sucursal")
    || canView(permissions, "bodega_sucursal");

  if (canBodegaGeneral) {
    return <Navigate to="/inventario/bodega-general" replace />;
  }
  if (canBodegaSucursal) {
    return <Navigate to="/inventario/bodega-sucursal" replace />;
  }

  return <Navigate to="/admin" replace />;
};

export default Inventario;
