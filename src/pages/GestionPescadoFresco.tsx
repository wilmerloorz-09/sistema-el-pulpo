import { Lock, Snowflake } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import CompraPescadoFrescoAdmin from "@/components/admin/CompraPescadoFrescoAdmin";
import AjustePescadoFrescoAdmin from "@/components/admin/AjustePescadoFrescoAdmin";
import HistorialPescadoFrescoAdmin from "@/components/admin/HistorialPescadoFrescoAdmin";

const GestionPescadoFresco = () => {
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
            Pescado fresco requiere bodega general, administrador o supervisor de sucursal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Pescado fresco"
      description="Compra · ajuste de cantidades · historial"
      icon={<Snowflake className="h-5 w-5" />}
      iconClassName="border-cyan-200 text-cyan-700"
      defaultTab="compra"
      tabs={[
        {
          value: "compra",
          label: "Compra",
          content: <CompraPescadoFrescoAdmin />,
        },
        {
          value: "ajuste",
          label: "Ajuste de cantidades",
          content: <AjustePescadoFrescoAdmin />,
        },
        {
          value: "historial",
          label: "Historial de movimientos",
          content: <HistorialPescadoFrescoAdmin />,
        },
      ]}
    />
  );
};

export default GestionPescadoFresco;
