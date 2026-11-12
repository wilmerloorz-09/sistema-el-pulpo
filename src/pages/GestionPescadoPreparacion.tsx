import { ChefHat, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import GestionPescadoAdmin from "@/components/admin/GestionPescadoAdmin";
import { supabase } from "@/integrations/supabase/client";

const GestionPescadoPreparacion = () => {
  const { profile } = useAuth();
  const { permissions, isGlobalAdmin } = useBranch();
  const isAdmin =
    isGlobalAdmin
    || canManage(permissions, "admin_global")
    || canManage(permissions, "admin_sucursal");

  const prepAccessQuery = useQuery({
    queryKey: ["pescado-prep-access", profile?.id ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("puede_acceder_preparacion_pescado" as any);
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(profile?.id) && !isAdmin,
  });

  const hasAccess = isAdmin || Boolean(prepAccessQuery.data);

  if (!isAdmin && prepAccessQuery.isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4 text-sm text-muted-foreground">
        Verificando acceso…
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso restringido</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Preparación solo está disponible para administradores y el usuario configurado en Pescado cocido → Configuración.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-2.5 p-3 sm:space-y-4 sm:p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-sm sm:h-10 sm:w-10 sm:rounded-2xl">
          <ChefHat className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-base font-bold leading-tight text-foreground sm:text-lg">
            Preparación
          </h1>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
            Registro de preparación de pescado cocido
          </p>
        </div>
      </div>
      <GestionPescadoAdmin section="preparacion" />
    </div>
  );
};

export default GestionPescadoPreparacion;
