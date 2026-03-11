import { NavLink } from "@/components/NavLink";
import { useBranch } from "@/contexts/BranchContext";
import { canView } from "@/lib/permissions";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
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
  visible: (permissions: Record<string, any>) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/mesas",
    label: "Mesas",
    icon: <LayoutGrid className="h-5 w-5" />,
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/ordenes",
    label: "Ordenes",
    icon: <UtensilsCrossed className="h-5 w-5" />,
    visible: (permissions) => canView(permissions, "ordenes"),
  },
  {
    to: "/despacho",
    label: "Despacho",
    icon: <ChefHat className="h-5 w-5" />,
    visible: (permissions) =>
      canView(permissions, "despacho_total") ||
      canView(permissions, "despacho_mesa") ||
      canView(permissions, "despacho_para_llevar"),
  },
  {
    to: "/caja",
    label: "Caja",
    icon: <CircleDollarSign className="h-5 w-5" />,
    visible: (permissions) => canView(permissions, "caja"),
  },
  {
    to: "/reportes",
    label: "Reportes",
    icon: <BarChart3 className="h-5 w-5" />,
    visible: (permissions) => canView(permissions, "reportes_sucursal") || canView(permissions, "reportes_globales"),
  },
  {
    to: "/admin",
    label: "Admin",
    icon: <Settings className="h-5 w-5" />,
    visible: (permissions) => canView(permissions, "admin_sucursal") || canView(permissions, "admin_global"),
  },
];

const BottomNav = () => {
  const { permissions, isGlobalAdmin, branches } = useBranch();
  const { hasAccess: hasDispatchAccess, fallbackVisible, isLoading: dispatchAccessLoading } = useDispatchAccess();

  const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isGlobalAdminWithoutBranches) {
      return item.to === "/admin";
    }

    if (item.to === "/admin" && isGlobalAdmin) {
      return true;
    }

    if (item.to !== "/despacho") return item.visible(permissions);
    if (!item.visible(permissions)) return false;
    return dispatchAccessLoading ? fallbackVisible : hasDispatchAccess;
  });

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md safe-bottom md:bottom-0">
      <div className="flex items-center justify-around px-1 py-1.5">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-muted-foreground transition-colors"
            activeClassName="bg-primary/10 text-primary"
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
