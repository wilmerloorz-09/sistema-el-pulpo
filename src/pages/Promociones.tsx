import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import PromocionesCrud from "@/components/promociones/PromocionesCrud";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

const ORIGEN_PROMOCIONES = "promociones";

const Promociones = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const gate = useBranchShiftGate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === "/promociones" && params.get("origin") !== ORIGEN_PROMOCIONES) {
      params.set("origin", ORIGEN_PROMOCIONES);
      navigate({ pathname: "/promociones", search: params.toString() }, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  if (gate.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!gate.data?.puedeRegistrarPromociones) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-medium text-foreground">Sin acceso a promociones</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Debes tener un turno abierto y permiso para registrar promociones.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2.5 pb-8 pt-2 sm:px-4">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Promociones</h1>
        <p className="text-sm text-muted-foreground">
          Registra la predicción del comensal sobre órdenes ya pagadas del turno.
        </p>
      </div>
      <PromocionesCrud />
    </div>
  );
};

export default Promociones;
