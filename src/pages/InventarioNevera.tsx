import { Package } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import NeveraProductosAdmin from "@/components/admin/NeveraProductosAdmin";
import InventarioHistorialAdmin from "@/components/admin/InventarioHistorialAdmin";

const InventarioNevera = () => {
  const { permissions, isGlobalAdmin, activeBranchId } = useBranch();
  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "inventario_movimientos")
    || canView(permissions, "inventario_movimientos");

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Nevera requiere ser Administrador o el usuario asignado para nevera en la sucursal.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="p-6">
        <Card className="rounded-[28px] border border-border/80 p-6 text-sm text-muted-foreground">
          Selecciona una sucursal activa para operar nevera.
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Nevera"
      description="Stock operativo de nevera · Menú mesa"
      icon={<Package className="h-5 w-5" />}
      iconClassName="border-cyan-200 text-cyan-700"
      defaultTab="productos"
      tabs={[
        {
          value: "productos",
          label: "Productos Nevera",
          content: <NeveraProductosAdmin />,
        },
        {
          value: "historial",
          label: "Historial",
          content: <InventarioHistorialAdmin />,
        },
      ]}
    />
  );
};

export default InventarioNevera;
