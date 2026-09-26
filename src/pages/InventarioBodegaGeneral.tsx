import { Warehouse } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import BodegaGeneralHistorialAdmin from "@/components/admin/BodegaGeneralHistorialAdmin";
import BodegaGeneralProductosAdmin from "@/components/admin/BodegaGeneralProductosAdmin";
import CompraBodegaGeneralAdmin from "@/components/admin/CompraBodegaGeneralAdmin";
import MovimientoASucursalAdmin from "@/components/admin/MovimientoASucursalAdmin";

const InventarioBodegaGeneral = () => {
  const { permissions, isGlobalAdmin } = useBranch();
  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "bodega_general")
    || canView(permissions, "bodega_general")
    || canManage(permissions, "admin_global");

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Bodega general requiere Administrador general o Bodeguero general.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Bodega General"
      description="Stock central · Catálogo global"
      icon={<Warehouse className="h-5 w-5" />}
      iconClassName="border-emerald-200 text-emerald-700"
      defaultTab="productos"
      tabs={[
        {
          value: "productos",
          label: "Productos Generales",
          content: <BodegaGeneralProductosAdmin />,
        },
        {
          value: "compra",
          label: "Compra",
          content: <CompraBodegaGeneralAdmin />,
        },
        {
          value: "movimiento-sucursal",
          label: "Movimiento a sucursal",
          content: <MovimientoASucursalAdmin />,
        },
        {
          value: "historial",
          label: "Historial",
          content: <BodegaGeneralHistorialAdmin />,
        },
      ]}
    />
  );
};

export default InventarioBodegaGeneral;
