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
  const [savingIntegraProductoId, setSavingIntegraProductoId] = useState<string | null>(null);

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

  const saveIntegraMutation = useMutation({
    mutationFn: async ({
      productoId,
      integraConVentas,
      cantidadActual,
    }: {
      productoId: string;
      integraConVentas: boolean;
      cantidadActual: number;
    }) => {
      if (!activeBranchId) throw new Error("Sucursal no seleccionada");
      setSavingIntegraProductoId(productoId);
      const { error } = await supabase
        .from("inventario_productos")
        .upsert(
          {
            producto_id: productoId,
            sucursal_id: activeBranchId,
            cantidad_disponible: cantidadActual,
            integra_con_ventas: integraConVentas,
            activo: true,
          },
          { onConflict: "producto_id,sucursal_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventario-producto-map", activeBranchId] });
      toast.success("Integración con ventas actualizada");
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar"),
    onSettled: () => setSavingIntegraProductoId(null),
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
          <h2 className="font-display text-lg font-bold text-foreground">Productos de la sucursal</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal: <span className="font-semibold text-foreground">{activeBranch?.name ?? activeBranchId}</span>
            {" · "}Menú mesa
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cada producto muestra su stock y configuración por sucursal. La cantidad se modifica solo desde Movimientos.
        {" "}
        <span className="font-semibold">Integra ventas = No</span> significa que las ventas no validarán stock (hasta activarlo).
        {!canEditInventario ? " Modo solo lectura." : null}
      </p>

      <InventarioArbolPanel
        branchId={activeBranchId}
        renderNodeAction={(_node, info) => (
          <InventarioProductosNodeMeta
            info={info}
            canEdit={canEditInventario}
            savingTipo={savingTipoProductoId === info.productoId}
            savingIntegra={savingIntegraProductoId === info.productoId}
            onTipoChange={(tipo) => saveTipoMutation.mutate({ productoId: info.productoId, tipo })}
            onIntegraChange={(integra) =>
              saveIntegraMutation.mutate({
                productoId: info.productoId,
                integraConVentas: integra,
                cantidadActual: info.cantidadDisponible,
              })
            }
          />
        )}
      />
    </div>
  );
};

export default InventarioProductosAdmin;
