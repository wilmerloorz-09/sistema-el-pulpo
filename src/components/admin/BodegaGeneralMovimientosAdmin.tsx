import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";
import BodegaGeneralArbolPanel from "@/components/admin/BodegaGeneralArbolPanel";
import BodegaGeneralMovimientoDialog from "@/components/admin/BodegaGeneralMovimientoDialog";
import { InventarioMovimientosNodeMeta } from "@/components/admin/inventarioNodeMeta";

const BodegaGeneralMovimientosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const qc = useQueryClient();
  const canRegistrarMovimientos =
    isGlobalAdmin || canOperate(permissions, "bodega_general");
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
        Selecciona una sucursal activa para navegar el menú y registrar movimientos de bodega general.
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
          <h2 className="font-display text-lg font-bold text-foreground">
            Movimientos de Bodega General
          </h2>
          <p className="text-xs text-muted-foreground">
            Sucursal:{" "}
            <span className="font-semibold text-foreground">
              {activeBranch?.name ?? activeBranchId}
            </span>
            {" · "}Stock en bodega general · Menú mesa
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Usa el botón en cada producto para registrar ingreso, salida o ajuste de bodega general.
        {!canRegistrarMovimientos ? " Modo solo lectura." : null}
      </p>

      <BodegaGeneralArbolPanel
        renderNodeAction={(node, info) => (
          <InventarioMovimientosNodeMeta
            info={info}
            canRegistrar={canRegistrarMovimientos}
            onRegistrar={() => {
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
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default BodegaGeneralMovimientosAdmin;
