import { useState } from "react";
import { Package } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";
import InventarioArbolPanel from "@/components/admin/InventarioArbolPanel";
import InventarioMovimientoDialog from "@/components/admin/InventarioMovimientoDialog";
import { BodegaSucursalProductosNodeMeta } from "@/components/admin/inventarioNodeMeta";

const NeveraProductosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const qc = useQueryClient();
  const canAjustar =
    isGlobalAdmin || canOperate(permissions, "inventario_movimientos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<{
    productoId: string;
    nombre: string;
    cantidad: number;
  } | null>(null);

  const handleSuccess = () => {
    toast.success("Movimiento registrado");
    void qc.invalidateQueries({ queryKey: ["inventario-producto-map", activeBranchId, "nevera"] });
    void qc.invalidateQueries({ queryKey: ["inventario-producto-map", activeBranchId] });
    void qc.invalidateQueries({ queryKey: ["admin-inventario-movimientos", activeBranchId] });
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para ver el stock de nevera.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200 bg-white text-cyan-700 shadow-sm">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Productos Nevera</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal:{" "}
            <span className="font-semibold text-foreground">
              {activeBranch?.name ?? activeBranchId}
            </span>
            {" · "}Stock operativo de nevera (menú mesa)
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        La cantidad se actualiza cuando bodega sucursal abastece la nevera y cuando se venden
        productos con Integra ventas = Sí.
        Usa <span className="font-semibold">Ajustar</span> para ingreso, salida o ajuste manual.
      </p>

      <InventarioArbolPanel
        branchId={activeBranchId}
        stockSource="nevera"
        renderNodeAction={(node, info) => (
          <BodegaSucursalProductosNodeMeta
            info={info}
            canAjustar={canAjustar}
            onAjustar={() => {
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
        defaultTipoMovimiento="AJUSTE"
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default NeveraProductosAdmin;
