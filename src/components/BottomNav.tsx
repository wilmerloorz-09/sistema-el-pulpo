import { NavLink } from "@/components/NavLink";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { canView } from "@/lib/permissions";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  UtensilsCrossed,
  ChefHat,
  Package,
  CircleDollarSign,
  BarChart3,
  Settings,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  tone: {
    active: string;
    idle: string;
    iconIdle: string;
  };
  visible: (permissions: Record<string, any>) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/mesas",
    label: "Mesas",
    icon: <LayoutGrid className="h-5 w-5" />,
    tone: {
      active: "from-sky-500 to-cyan-400",
      idle: "hover:border-sky-200 hover:bg-sky-50/90 hover:text-sky-700",
      iconIdle: "bg-sky-50 text-sky-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/ordenes",
    label: "Ordenes",
    icon: <UtensilsCrossed className="h-5 w-5" />,
    tone: {
      active: "from-orange-500 to-amber-400",
      idle: "hover:border-orange-200 hover:bg-orange-50/90 hover:text-orange-700",
      iconIdle: "bg-orange-50 text-orange-600",
    },
    visible: (permissions) => canView(permissions, "ordenes"),
  },
  {
    to: "/despacho",
    label: "Despacho",
    icon: <ChefHat className="h-5 w-5" />,
    tone: {
      active: "from-rose-500 to-pink-400",
      idle: "hover:border-rose-200 hover:bg-rose-50/90 hover:text-rose-700",
      iconIdle: "bg-rose-50 text-rose-600",
    },
    visible: (permissions) =>
      canView(permissions, "despacho_total") ||
      canView(permissions, "despacho_mesa") ||
      canView(permissions, "despacho_para_llevar"),
  },
  {
    to: "/productos",
    label: "Productos",
    icon: <Package className="h-5 w-5" />,
    tone: {
      active: "from-teal-500 to-cyan-400",
      idle: "hover:border-teal-200 hover:bg-teal-50/90 hover:text-teal-700",
      iconIdle: "bg-teal-50 text-teal-600",
    },
    visible: (permissions) =>
      canView(permissions, "ordenes") ||
      canView(permissions, "despacho_total") ||
      canView(permissions, "despacho_mesa") ||
      canView(permissions, "despacho_para_llevar"),
  },
  {
    to: "/caja",
    label: "Caja",
    icon: <CircleDollarSign className="h-5 w-5" />,
    tone: {
      active: "from-emerald-500 to-lime-400",
      idle: "hover:border-emerald-200 hover:bg-emerald-50/90 hover:text-emerald-700",
      iconIdle: "bg-emerald-50 text-emerald-600",
    },
    visible: (permissions) => canView(permissions, "caja"),
  },
  {
    to: "/reportes",
    label: "Reportes",
    icon: <BarChart3 className="h-5 w-5" />,
    tone: {
      active: "from-violet-500 to-fuchsia-400",
      idle: "hover:border-violet-200 hover:bg-violet-50/90 hover:text-violet-700",
      iconIdle: "bg-violet-50 text-violet-600",
    },
    visible: (permissions) => canView(permissions, "reportes_sucursal") || canView(permissions, "reportes_globales"),
  },
  {
    to: "/admin",
    label: "Admin",
    icon: <Settings className="h-5 w-5" />,
    tone: {
      active: "from-slate-700 to-slate-500",
      idle: "hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-700",
      iconIdle: "bg-slate-100 text-slate-600",
    },
    visible: (permissions) => canView(permissions, "admin_sucursal") || canView(permissions, "admin_global"),
  },
];

const BottomNav = () => {
  const { permissions, isGlobalAdmin, branches } = useBranch();
  const { hasAccess: hasDispatchAccess, fallbackVisible, isLoading: dispatchAccessLoading } = useDispatchAccess();
  const shiftGateQuery = useBranchShiftGate();

  const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
  const canAccessAdmin = isGlobalAdmin || canView(permissions, "admin_sucursal") || canView(permissions, "admin_global");
  const hasOperationalShift = Boolean(shiftGateQuery.data?.shiftOpen) && (Boolean(shiftGateQuery.data?.userEnabled) || canAccessAdmin);
  const hasSupervisorBypass = Boolean(shiftGateQuery.data?.isSupervisor) || canAccessAdmin;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isGlobalAdminWithoutBranches) {
      return item.to === "/admin";
    }

    if (!hasOperationalShift) {
      return item.to === "/admin" && canAccessAdmin;
    }

    if (item.to === "/admin" && isGlobalAdmin) {
      return true;
    }

    if (item.to === "/mesas" || item.to === "/ordenes") {
      if (!item.visible(permissions)) return false;
      return hasSupervisorBypass || Boolean(shiftGateQuery.data?.canServeTables);
    }

    if (item.to === "/productos") {
      if (!item.visible(permissions)) return false;
      return hasSupervisorBypass
        || Boolean(shiftGateQuery.data?.canServeTables)
        || Boolean(shiftGateQuery.data?.canDispatchOrders);
    }

    if (item.to === "/caja") {
      if (!item.visible(permissions)) return false;
      return hasSupervisorBypass || Boolean(shiftGateQuery.data?.canUseCaja);
    }

    if (item.to === "/despacho") {
      if (!(hasSupervisorBypass || Boolean(shiftGateQuery.data?.canDispatchOrders))) return false;
      return dispatchAccessLoading ? fallbackVisible : hasDispatchAccess;
    }

    if (!item.visible(permissions)) return false;

    return true;
  });

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-orange-200/80 bg-white safe-bottom md:bottom-0 dark:border-border dark:bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-start gap-3 overflow-x-auto px-2 py-2 [scrollbar-width:none] snap-x snap-mandatory [&::-webkit-scrollbar]:hidden sm:gap-6 sm:px-4 md:gap-8">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              "group flex min-w-[4.8rem] shrink-0 snap-start flex-col items-center gap-1 rounded-[20px] border border-white/70 bg-white/82 px-2.5 py-2 text-muted-foreground shadow-[0_14px_28px_-24px_rgba(15,23,42,0.28)] transition-all sm:min-w-[5rem] sm:gap-1.5 sm:px-3",
              item.tone.idle,
            )}
            activeClassName={cn(
              "border-white/20 bg-gradient-to-b text-white shadow-[0_18px_35px_-24px_rgba(15,23,42,0.45)] [&>span:first-child]:bg-white/15 [&>span:first-child]:text-white",
              item.tone.active,
            )}
          >
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-2xl transition-all group-hover:scale-105 sm:h-9 sm:w-9", item.tone.iconIdle)}>
              {item.icon}
            </span>
            <span className="max-w-[4.8rem] text-center text-[10px] font-semibold leading-tight sm:max-w-[5rem]">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
