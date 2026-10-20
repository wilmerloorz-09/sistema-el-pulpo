import { Fish, Lock } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import GestionPescadoAdmin from "@/components/admin/GestionPescadoAdmin";

const InventarioGestionPescado = () => {
  const { permissions, isGlobalAdmin } = useBranch();
  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "gestion_pescado")
    || canView(permissions, "gestion_pescado")
    || canOperate(permissions, "bodega_general")
    || canView(permissions, "bodega_general")
    || canManage(permissions, "admin_global")
    || canManage(permissions, "admin_sucursal");

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Gestión Pescado requiere bodega general, administrador o supervisor de sucursal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Gestión Pescado"
      description="Stock por sucursal · ingresos/salidas · movimientos (libras y gramos)"
      icon={<Fish className="h-5 w-5" />}
      iconClassName="border-sky-200 text-sky-700"
      defaultTab="sucursales"
      tabs={[
        { value: "sucursales", label: "Sucursales", content: <GestionPescadoAdmin section="sucursales" /> },
        { value: "ingreso-salida", label: "Ingreso/salida", content: <GestionPescadoAdmin section="ingreso-salida" /> },
        { value: "movimientos", label: "Movimientos", content: <GestionPescadoAdmin section="movimientos" /> },
        { value: "historial", label: "Historial", content: <GestionPescadoAdmin section="historial" /> },
      ]}
    />
  );
};

export default InventarioGestionPescado;
