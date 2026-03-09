import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import type { Database } from "@/integrations/supabase/types";
import { Shield, UtensilsCrossed, CircleDollarSign, ChefHat, Truck } from "lucide-react";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_META: Record<AppRole, { label: string; icon: React.ReactNode; color: string }> = {
  admin: { label: "Admin", icon: <Shield className="h-7 w-7" />, color: "bg-primary text-primary-foreground" },
  mesero: { label: "Mesero", icon: <UtensilsCrossed className="h-7 w-7" />, color: "bg-accent text-accent-foreground" },
  cajero: { label: "Cajero", icon: <CircleDollarSign className="h-7 w-7" />, color: "bg-warning text-foreground" },
  cocina: { label: "Cocina", icon: <ChefHat className="h-7 w-7" />, color: "bg-destructive text-destructive-foreground" },
  despachador_mesas: { label: "Despacho Mesas", icon: <Truck className="h-7 w-7" />, color: "bg-info text-primary-foreground" },
  despachador_takeout: { label: "Despacho Takeout", icon: <Truck className="h-7 w-7" />, color: "bg-secondary text-secondary-foreground" },
  supervisor: { label: "Supervisor", icon: <Shield className="h-7 w-7" />, color: "bg-info text-primary-foreground" },
  superadmin: { label: "Super Admin", icon: <Shield className="h-7 w-7" />, color: "bg-primary text-primary-foreground" },
};

const RoleSelector = () => {
  const { roles, setActiveRole, profile } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="text-center space-y-1">
          <h1 className="font-display text-xl font-bold text-foreground">
            Hola, {profile?.full_name ?? "Usuario"}
          </h1>
          <p className="text-sm text-muted-foreground">Selecciona tu rol para esta sesion</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {roles.map((role, i) => {
            const meta = ROLE_META[role];
            return (
              <motion.button
                key={role}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => setActiveRole(role)}
                className={`flex flex-col items-center gap-2 rounded-2xl p-5 ${meta.color} shadow-sm active:scale-95 transition-transform`}
              >
                {meta.icon}
                <span className="font-display text-sm font-semibold">{meta.label}</span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default RoleSelector;
