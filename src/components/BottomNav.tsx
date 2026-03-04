import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import {
  LayoutGrid,
  UtensilsCrossed,
  ChefHat,
  CircleDollarSign,
  BarChart3,
  Settings,
  Truck,
} from "lucide-react";

type AppRole = Database["public"]["Enums"]["app_role"];

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: AppRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/mesas", label: "Mesas", icon: <LayoutGrid className="h-5 w-5" />, roles: ["admin", "mesero"] },
  { to: "/ordenes", label: "Ordenes", icon: <UtensilsCrossed className="h-5 w-5" />, roles: ["admin", "mesero"] },
  { to: "/cocina", label: "Cocina", icon: <ChefHat className="h-5 w-5" />, roles: ["admin", "cocina"] },
  { to: "/despacho", label: "Despacho", icon: <Truck className="h-5 w-5" />, roles: ["admin", "despachador_mesas", "despachador_takeout"] },
  { to: "/caja", label: "Caja", icon: <CircleDollarSign className="h-5 w-5" />, roles: ["admin", "cajero"] },
  { to: "/reportes", label: "Reportes", icon: <BarChart3 className="h-5 w-5" />, roles: ["admin"] },
  { to: "/admin", label: "Admin", icon: <Settings className="h-5 w-5" />, roles: ["admin"] },
];

const BottomNav = () => {
  const { activeRole } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => activeRole && item.roles.includes(activeRole)
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md safe-bottom">
      <div className="flex items-center justify-around px-1 py-1.5">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors rounded-xl min-w-[3.5rem]"
            activeClassName="text-primary bg-primary/10"
          >
            {item.icon}
            <span className="text-[10px] font-medium leading-tight">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
