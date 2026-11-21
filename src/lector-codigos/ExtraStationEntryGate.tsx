import { Navigate, useLocation } from "react-router-dom";
import { getExtraStationBranchId } from "./extraStationBranch";

/** Obliga a pasar por /extra-acceso antes de abrir Extra / Extra Empaquetador. */
export default function ExtraStationEntryGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const branchId = getExtraStationBranchId();
  if (!branchId) {
    return <Navigate to="/extra-acceso" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
