import InventarioHistorialAdmin from "@/components/admin/InventarioHistorialAdmin";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";

const InventarioHistorial = () => {
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
            El historial de nevera requiere ser Administrador o el usuario asignado para nevera en la sucursal.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="p-6">
        <Card className="rounded-[28px] border border-border/80 p-6 text-sm text-muted-foreground">
          Selecciona una sucursal activa para consultar el historial de nevera.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <InventarioHistorialAdmin />
    </div>
  );
};

export default InventarioHistorial;
