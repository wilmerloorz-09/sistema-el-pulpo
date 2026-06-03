import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ClientesCrud from "@/components/clientes/ClientesCrud";

const ORIGEN_CLIENTES = "clientes";

/**
 * Pantalla operativa de comensales. El layout replica el módulo de Usuarios del sistema:
 * métricas, barra de filtros, tabla y diálogos modales (sin salir de la vista).
 */
const Clientes = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === "/clientes" && params.get("origin") !== ORIGEN_CLIENTES) {
      params.set("origin", ORIGEN_CLIENTES);
      navigate({ pathname: "/clientes", search: params.toString() }, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  return (
    <div className="px-2.5 pb-8 pt-2 sm:px-4">
      <ClientesCrud />
    </div>
  );
};

export default Clientes;
