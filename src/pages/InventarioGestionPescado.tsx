import { useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Fish, Lock } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import InventarioModuleShell from "@/components/inventario/InventarioModuleShell";
import GestionPescadoAdmin from "@/components/admin/GestionPescadoAdmin";

const InventarioGestionPescado = () => {
  const { permissions, isGlobalAdmin } = useBranch();
  const [searchParams] = useSearchParams();
  const requestedTab = String(searchParams.get("tab") ?? "").trim().toLowerCase();

  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, "gestion_pescado")
    || canView(permissions, "gestion_pescado")
    || canOperate(permissions, "bodega_general")
    || canView(permissions, "bodega_general")
    || canManage(permissions, "admin_global")
    || canManage(permissions, "admin_sucursal");

  const canManageConfig =
    isGlobalAdmin
    || canManage(permissions, "admin_global")
    || canManage(permissions, "admin_sucursal");

  const tabs = useMemo(() => {
    const items = [
      ...(canManageConfig
        ? [{
            value: "configuracion",
            label: "Configuración",
            content: <GestionPescadoAdmin section="configuracion" />,
          }]
        : []),
      { value: "sucursales", label: "Sucursales", content: <GestionPescadoAdmin section="sucursales" /> },
      { value: "movimientos", label: "Movim.", content: <GestionPescadoAdmin section="movimientos" /> },
      { value: "historial", label: "Historial", content: <GestionPescadoAdmin section="historial" /> },
    ];
    return items;
  }, [canManageConfig]);

  if (requestedTab === "preparacion" || requestedTab === "ingreso-salida") {
    return <Navigate to="/gestion-pescado/preparacion" replace />;
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Pescado cocido requiere bodega general, administrador o supervisor de sucursal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <InventarioModuleShell
      title="Pescado cocido"
      description="Stock · configuración · movimientos"
      icon={<Fish className="h-4 w-4" />}
      iconClassName="border-sky-200 text-sky-700"
      defaultTab="sucursales"
      compactTabs
      tabs={tabs}
    />
  );
};

export default InventarioGestionPescado;
