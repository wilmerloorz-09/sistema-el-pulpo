import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate } from "@/lib/permissions";
import InventarioArbolPanel from "@/components/admin/InventarioArbolPanel";
import InventarioMovimientoDialog from "@/components/admin/InventarioMovimientoDialog";
import { InventarioMovimientosNodeMeta } from "@/components/admin/inventarioNodeMeta";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const InventarioMovimientosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const qc = useQueryClient();
  const canRegistrarMovimientos =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || canOperate(permissions, "inventario_movimientos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<{
    productoId: string;
    nombre: string;
    cantidad: number;
  } | null>(null);

  const handleSuccess = () => {
    toast.success("Movimiento registrado");
    void qc.invalidateQueries({ queryKey: ["inventario-producto-map", activeBranchId] });
    void qc.invalidateQueries({ queryKey: ["admin-inventario-movimientos", activeBranchId] });
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para registrar movimientos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200 bg-white text-teal-700 shadow-sm">
          <ArrowLeftRight className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Movimientos</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal: <span className="font-semibold text-foreground">{activeBranch?.name ?? activeBranchId}</span>
            {" · "}Menú mesa
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Usa el botón en cada producto para registrar ingreso, salida o ajuste.
        {!canRegistrarMovimientos ? " Modo solo lectura." : null}
      </p>

      <InventarioArbolPanel
        branchId={activeBranchId}
        renderNodeAction={(node, info) => (
          <InventarioMovimientosNodeMeta
            info={info}
            canRegistrar={canRegistrarMovimientos}
            onRegistrar={() => {
              setSelected({
                productoId: info.productoId,
                nombre: node.name,
                cantidad: info.cantidadDisponible,
              });
              setDialogOpen(true);
            }}
          />
        )}
      />

      <InventarioMovimientoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productoId={selected?.productoId ?? null}
        productoNombre={selected?.nombre ?? ""}
        cantidadActual={selected?.cantidad ?? 0}
        sucursalId={activeBranchId}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default InventarioMovimientosAdmin;
