import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate } from "@/lib/permissions";
import InventarioArbolPanel from "@/components/admin/InventarioArbolPanel";
import BodegaSucursalMovimientoDialog from "@/components/admin/BodegaSucursalMovimientoDialog";
import { BodegaSucursalProductosNodeMeta } from "@/components/admin/inventarioNodeMeta";

const BodegaSucursalProductosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canEdit =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const canAjustar =
    isGlobalAdmin
    || canOperate(permissions, "bodega_sucursal")
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const qc = useQueryClient();
  const [savingIntegraProductoId, setSavingIntegraProductoId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<{
    productoGlobalId: string;
    nombre: string;
    cantidad: number;
  } | null>(null);

  const saveIntegraMutation = useMutation({
    mutationFn: async ({
      productoId,
      integraConVentas,
    }: {
      productoId: string;
      integraConVentas: boolean;
    }) => {
      if (!activeBranchId) throw new Error("Sucursal no seleccionada");
      setSavingIntegraProductoId(productoId);

      const { data: existing, error: readError } = await supabase
        .from("inventario_bodega_sucursal" as any)
        .select("id, cantidad_disponible")
        .eq("producto_global_id", productoId)
        .eq("sucursal_id", activeBranchId)
        .maybeSingle();
      if (readError) throw readError;

      if (existing?.id) {
        const { error } = await supabase
          .from("inventario_bodega_sucursal" as any)
          .update({
            integra_con_ventas: integraConVentas,
            actualizado_en: new Date().toISOString(),
          } as any)
          .eq("id", existing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from("inventario_bodega_sucursal" as any)
        .insert({
          producto_global_id: productoId,
          sucursal_id: activeBranchId,
          cantidad_disponible: 0,
          integra_con_ventas: integraConVentas,
          activo: true,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId, "bodega_sucursal"],
      });
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId, "nevera"],
      });
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId],
      });
      toast.success("Integración con ventas actualizada");
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar"),
    onSettled: () => setSavingIntegraProductoId(null),
  });

  const handleSuccess = () => {
    toast.success("Movimiento registrado");
    void qc.invalidateQueries({
      queryKey: ["inventario-producto-map", activeBranchId, "bodega_sucursal"],
    });
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para ver el stock de su bodega.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white text-orange-700 shadow-sm">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Productos Sucursal</h2>
          <p className="text-xs text-muted-foreground">
            Sucursal:{" "}
            <span className="font-semibold text-foreground">
              {activeBranch?.name ?? activeBranchId}
            </span>
            {" · "}Stock de bodega sucursal (recibido desde bodega general)
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        La cantidad se actualiza cuando bodega general envía productos a esta sucursal.
        {" "}
        <span className="font-semibold">Integra ventas</span> se guarda en bodega sucursal:
        con <span className="font-semibold">Sí</span>, al vender se valida y descuenta stock de nevera.
        Usa <span className="font-semibold">Ajustar</span> para ingreso, salida o ajuste manual.
        {!canEdit && !canAjustar ? " Modo solo lectura." : null}
      </p>

      <InventarioArbolPanel
        branchId={activeBranchId}
        stockSource="bodega_sucursal"
        renderNodeAction={(node, info) => (
          <BodegaSucursalProductosNodeMeta
            info={info}
            canEdit={canEdit}
            showIntegraVentas
            savingIntegra={savingIntegraProductoId === info.productoId}
            onIntegraChange={(integra) =>
              saveIntegraMutation.mutate({
                productoId: info.productoId,
                integraConVentas: integra,
              })
            }
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

      <BodegaSucursalMovimientoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productoGlobalId={selected?.productoGlobalId ?? null}
        productoNombre={selected?.nombre ?? ""}
        cantidadActual={selected?.cantidad ?? 0}
        sucursalId={activeBranchId}
        defaultTipoMovimiento="AJUSTE"
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default BodegaSucursalProductosAdmin;
