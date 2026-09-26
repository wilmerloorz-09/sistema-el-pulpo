import { Warehouse } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import InventarioTabPlaceholder from "@/components/inventario/InventarioTabPlaceholder";
import BodegaSucursalProductosAdmin from "@/components/admin/BodegaSucursalProductosAdmin";
import MovimientoSucursalANeveraAdmin from "@/components/admin/MovimientoSucursalANeveraAdmin";

const InventarioBodegaSucursal = () => {
  const { permissions, isGlobalAdmin, activeBranchId } = useBranch();
  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "bodega_sucursal")
    || canView(permissions, "bodega_sucursal")
    || canManage(permissions, "admin_global");

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Bodega sucursal requiere Administrador o Bodeguero de sucursal.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="p-6">
        <Card className="rounded-[28px] border border-border/80 p-6 text-sm text-muted-foreground">
          Selecciona una sucursal activa para operar la bodega de la sucursal.
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Bodega Sucursal"
      description="Stock de bodega por sucursal"
      icon={<Warehouse className="h-5 w-5" />}
      iconClassName="border-orange-200 text-orange-700"
      defaultTab="productos"
      tabs={[
        {
          value: "productos",
          label: "Productos Sucursal",
          content: <BodegaSucursalProductosAdmin />,
        },
        {
          value: "movimientos",
          label: "Movimiento",
          content: <MovimientoSucursalANeveraAdmin />,
        },
        {
          value: "historial",
          label: "Historial",
          content: (
            <InventarioTabPlaceholder
              title="Historial bodega Sucursal"
              description="Consulta del historial de movimientos de la bodega de la sucursal."
            />
          ),
        },
      ]}
    />
  );
};

export default InventarioBodegaSucursal;
