import { useState } from "react";
import { Package } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";
import BodegaGeneralArbolPanel from "@/components/admin/BodegaGeneralArbolPanel";
import BodegaGeneralMovimientoDialog from "@/components/admin/BodegaGeneralMovimientoDialog";
import { BodegaSucursalProductosNodeMeta } from "@/components/admin/inventarioNodeMeta";

const BodegaGeneralProductosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const qc = useQueryClient();
  const canAjustar = isGlobalAdmin || canOperate(permissions, "bodega_general");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<{
    productoGlobalId: string;
    nombre: string;
    cantidad: number;
  } | null>(null);

  const handleSuccess = () => {
    toast.success("Movimiento registrado");
    void qc.invalidateQueries({ queryKey: ["inventario-bodega-general-map"] });
    void qc.invalidateQueries({ queryKey: ["admin-movimientos-bodega-general"] });
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para navegar el menú y ver el stock de bodega general.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Productos Generales</h2>
          <p className="text-xs text-muted-foreground">
            Menú:{" "}
            <span className="font-semibold text-foreground">
              {activeBranch?.name ?? activeBranchId}
            </span>
            {" · "}Stock de bodega general (catálogo global)
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        La cantidad se actualiza con compras y con envíos a sucursal desde bodega general.
        Usa <span className="font-semibold">Ajustar</span> para ingreso, salida o ajuste manual.
      </p>

      <BodegaGeneralArbolPanel
        renderNodeAction={(node, info) => (
          <BodegaSucursalProductosNodeMeta
            info={info}
            canAjustar={canAjustar}
            onAjustar={() => {
              setSelected({
                productoGlobalId: info.productoId,
                nombre: node.name,
                cantidad: info.cantidadDisponible,
              });
              setDialogOpen(true);
            }}
          />
        )}
      />

      <BodegaGeneralMovimientoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productoGlobalId={selected?.productoGlobalId ?? null}
        productoNombre={selected?.nombre ?? ""}
        cantidadActual={selected?.cantidad ?? 0}
        defaultTipoMovimiento="AJUSTE"
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default BodegaGeneralProductosAdmin;
