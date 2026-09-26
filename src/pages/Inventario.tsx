import { Navigate } from "react-router-dom";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate, canView } from "@/lib/permissions";

const Inventario = () => {
  const { isGlobalAdmin, permissions } = useBranch();

  const canBodegaGeneral =
    isGlobalAdmin
    || canOperate(permissions, "bodega_general")
    || canView(permissions, "bodega_general");
  const canNevera =
    isGlobalAdmin
    || canOperate(permissions, "inventario_movimientos")
    || canView(permissions, "inventario_movimientos");
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
  if (canNevera) {
    return <Navigate to="/inventario/nevera" replace />;
  }

  return <Navigate to="/admin" replace />;
};

export default Inventario;
