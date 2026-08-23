import { useState } from "react";
import { History, Search } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import InventarioMovimientosHistorial from "@/components/admin/InventarioMovimientosHistorial";
import { Input } from "@/components/ui/input";

const InventarioHistorialAdmin = () => {
  const { activeBranchId, activeBranch } = useBranch();
  const [busqueda, setBusqueda] = useState("");

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para consultar el historial.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-200 bg-white text-indigo-700 shadow-sm">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Historial</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal: <span className="font-semibold text-foreground">{activeBranch?.name ?? activeBranchId}</span>
            {" · "}Últimos 100 movimientos
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por producto o motivo..."
          className="h-10 rounded-xl border-border/80 pl-9"
        />
      </div>

      <InventarioMovimientosHistorial sucursalId={activeBranchId} filtroProducto={busqueda} />
    </div>
  );
};

export default InventarioHistorialAdmin;
