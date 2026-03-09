import { NavLink } from "@/components/NavLink";
import { useBranch } from "@/contexts/BranchContext";
import {
  LayoutGrid,
  UtensilsCrossed,
  ChefHat,
  CircleDollarSign,
  BarChart3,
  Settings,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  moduleCodes: string[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/mesas", label: "Mesas", icon: <LayoutGrid className="h-5 w-5" />, moduleCodes: ["mesas"] },
  { to: "/ordenes", label: "Ordenes", icon: <UtensilsCrossed className="h-5 w-5" />, moduleCodes: ["ordenes"] },
  { to: "/despacho", label: "Despacho", icon: <ChefHat className="h-5 w-5" />, moduleCodes: ["despacho"] },
  { to: "/caja", label: "Caja", icon: <CircleDollarSign className="h-5 w-5" />, moduleCodes: ["caja", "pagos"] },
  { to: "/reportes", label: "Reportes", icon: <BarChart3 className="h-5 w-5" />, moduleCodes: ["reportes"] },
  { to: "/admin", label: "Admin", icon: <Settings className="h-5 w-5" />, moduleCodes: ["usuarios", "configuracion"] },
];

const BottomNav = () => {
  const { allowedModules } = useBranch();

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.moduleCodes.some((code) => allowedModules.includes(code))
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md safe-bottom md:bottom-0">
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
