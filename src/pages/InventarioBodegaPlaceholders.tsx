import { Warehouse } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";

type BodegaPlaceholderProps = {
  title: string;
  description: string;
  require: "bodega_sucursal";
};

const BodegaPlaceholderPage = ({ title, description, require }: BodegaPlaceholderProps) => {
  const { permissions, isGlobalAdmin } = useBranch();
  const hasAccess =
    isGlobalAdmin
    || canOperate(permissions, require)
    || canView(permissions, require)
    || canManage(permissions, "admin_global");

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            No tienes permiso para este módulo de bodega.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Card className="rounded-[28px] border border-border/80 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-4 text-xs font-semibold text-amber-700">
              En construcción: el menú ya está disponible; la operativa de stock se conectará en el siguiente paso.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export const InventarioBodegaSucursalMovimientos = () => (
  <BodegaPlaceholderPage
    title="Movimientos bodega Sucursal"
    description="Aquí se registrarán movimientos de la bodega de la sucursal y el abastecimiento hacia nevera."
    require="bodega_sucursal"
  />
);

export const InventarioBodegaSucursalHistorial = () => (
  <BodegaPlaceholderPage
    title="Historial bodega Sucursal"
    description="Consulta del historial de movimientos de la bodega de la sucursal."
    require="bodega_sucursal"
  />
);
