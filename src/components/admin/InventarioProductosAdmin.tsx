import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import InventarioArbolPanel from "@/components/admin/InventarioArbolPanel";
import { InventarioProductosNodeMeta } from "@/components/admin/inventarioNodeMeta";
import type { TipoProducto } from "@/lib/inventarioProductos";

const InventarioProductosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canEditInventario =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const qc = useQueryClient();
  const [savingTipoProductoId, setSavingTipoProductoId] = useState<string | null>(null);

  const saveTipoMutation = useMutation({
    mutationFn: async ({ productoId, tipo }: { productoId: string; tipo: TipoProducto }) => {
      setSavingTipoProductoId(productoId);
      const { error } = await supabase.from("products").update({ tipo_producto: tipo }).eq("id", productoId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventario-producto-map", activeBranchId] });
      toast.success("Tipo de producto actualizado");
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar"),
    onSettled: () => setSavingTipoProductoId(null),
  });

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para administrar su inventario.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white text-primary shadow-sm">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Productos</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal: <span className="font-semibold text-foreground">{activeBranch?.name ?? activeBranchId}</span>
            {" · "}Menú mesa
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cada producto muestra su stock y configuración. La cantidad se modifica solo desde Movimientos.
        {!canEditInventario ? " Modo solo lectura." : null}
      </p>

      <InventarioArbolPanel
        branchId={activeBranchId}
        renderNodeAction={(_node, info) => (
          <InventarioProductosNodeMeta
            info={info}
            canEditTipo={canEditInventario}
            savingTipo={savingTipoProductoId === info.productoId}
            onTipoChange={(tipo) => saveTipoMutation.mutate({ productoId: info.productoId, tipo })}
          />
        )}
      />
    </div>
  );
};

export default InventarioProductosAdmin;
