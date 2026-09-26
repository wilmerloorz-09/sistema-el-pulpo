import BodegaGeneralHistorialAdmin from "@/components/admin/BodegaGeneralHistorialAdmin";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";

const InventarioBodegaGeneralHistorial = () => {
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
            El historial de bodega general requiere ser Administrador general o Bodeguero general.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <BodegaGeneralHistorialAdmin />
    </div>
  );
};

export default InventarioBodegaGeneralHistorial;
