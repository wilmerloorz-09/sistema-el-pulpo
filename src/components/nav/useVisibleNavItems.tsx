import { useMemo, type ReactNode } from "react";
import { BarChart3, ChefHat, CircleDollarSign, LayoutGrid, Package, Settings, UtensilsCrossed } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { canView } from "@/lib/permissions";

export interface AppNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  tone: {
    active: string;
    idle: string;
    iconIdle: string;
  };
  visible: (permissions: Record<string, any>) => boolean;
}

const NAV_ITEMS: AppNavItem[] = [
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
      canView(permissions, "despacho_total")
      || canView(permissions, "despacho_mesa")
      || canView(permissions, "despacho_para_llevar"),
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
      canView(permissions, "ordenes")
      || canView(permissions, "despacho_total")
      || canView(permissions, "despacho_mesa")
      || canView(permissions, "despacho_para_llevar"),
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

export function useVisibleNavItems() {
  const { permissions, isGlobalAdmin, branches } = useBranch();
  const { hasAccess: hasDispatchAccess, fallbackVisible, isLoading: dispatchAccessLoading } = useDispatchAccess();
  const shiftGateQuery = useBranchShiftGate();

  return useMemo(() => {
    const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
    const canAccessAdmin = isGlobalAdmin || canView(permissions, "admin_sucursal") || canView(permissions, "admin_global");
    const hasOperationalShift = Boolean(shiftGateQuery.data?.shiftOpen) && Boolean(shiftGateQuery.data?.userEnabled);
    const hasSupervisorBypass = Boolean(shiftGateQuery.data?.isSupervisor);

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

    return {
      visibleItems,
      canAccessAdmin,
    };
  }, [
    branches.length,
    dispatchAccessLoading,
    fallbackVisible,
    hasDispatchAccess,
    isGlobalAdmin,
    permissions,
    shiftGateQuery.data?.canDispatchOrders,
    shiftGateQuery.data?.canServeTables,
    shiftGateQuery.data?.canUseCaja,
    shiftGateQuery.data?.isSupervisor,
    shiftGateQuery.data?.shiftOpen,
    shiftGateQuery.data?.userEnabled,
  ]);
}
