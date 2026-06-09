import { useMemo, type ReactNode } from "react";
import { BarChart3, ChefHat, CircleDollarSign, ConciergeBell, LayoutGrid, MonitorCheck, Package, PackagePlus, Settings, UtensilsCrossed, PlayCircle, ShoppingBag, Sparkles, Zap, Banknote, History, Users, Gift, Megaphone, Search } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useDispatchAccess } from "@/hooks/useDispatchAccess";
import { canSeeCajaFinanceNav, isCajaFinanceNavPath } from "@/components/nav/cajaTerminalNav";
import { canManage, canView } from "@/lib/permissions";

export interface NavSubItem {
  to: string;
  label: string;
  end?: boolean;
  disabled?: boolean;
  /** Texto para tooltip cuando está deshabilitado */
  disabledReason?: string;
}

export type NavGroupType = "VENTA" | "OPERATIVO" | "FINANZAS" | "PROMOCIONES" | "ADMINISTRACIÓN";

export interface AppNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  group: NavGroupType;
  tone: {
    active: string;
    idle: string;
    iconIdle: string;
  };
  visible: (permissions: Record<string, any>) => boolean;
  subItems?: NavSubItem[];
  disabled?: boolean;
  disabledReason?: string;
  end?: boolean;
}

const NAV_ITEMS: AppNavItem[] = [
  {
    to: "/mesas",
    label: "Mesas",
    icon: <LayoutGrid className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-sky-500 to-cyan-400",
      idle: "hover:border-sky-200 hover:bg-sky-50/90 hover:text-sky-700",
      iconIdle: "bg-sky-50 text-sky-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/para-llevar",
    label: "Para llevar",
    icon: <ShoppingBag className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-amber-500 to-yellow-300",
      idle: "hover:border-amber-200 hover:bg-amber-50/90 hover:text-amber-700",
      iconIdle: "bg-amber-50 text-amber-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/express",
    label: "Express",
    icon: <Zap className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-violet-500 to-fuchsia-400",
      idle: "hover:border-violet-200 hover:bg-violet-50/90 hover:text-violet-700",
      iconIdle: "bg-violet-50 text-violet-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/extra",
    label: "Extra",
    icon: <PackagePlus className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-teal-500 to-cyan-400",
      idle: "hover:border-teal-200 hover:bg-teal-50/90 hover:text-teal-700",
      iconIdle: "bg-teal-50 text-teal-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/orden-especial",
    label: "Orden especial",
    icon: <Sparkles className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-orange-500 to-amber-400",
      idle: "hover:border-orange-200 hover:bg-orange-50/90 hover:text-orange-700",
      iconIdle: "bg-orange-50 text-orange-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/clientes?origin=clientes",
    label: "Clientes",
    icon: <Users className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-sky-500 to-cyan-400",
      idle: "hover:border-sky-200 hover:bg-sky-50/90 hover:text-sky-700",
      iconIdle: "bg-sky-50 text-sky-600",
    },
    visible: (permissions) => canView(permissions, "mesas"),
  },
  {
    to: "/ordenes",
    label: "Comandas",
    icon: <UtensilsCrossed className="h-5 w-5" />,
    group: "VENTA",
    tone: {
      active: "from-orange-500 to-amber-400",
      idle: "hover:border-orange-200 hover:bg-orange-50/90 hover:text-orange-700",
      iconIdle: "bg-orange-50 text-orange-600",
    },
    visible: (permissions) => canView(permissions, "ordenes") || canView(permissions, "mesas"),
  },
  {
    to: "/servir",
    label: "Servir",
    icon: <ConciergeBell className="h-5 w-5" />,
    group: "OPERATIVO",
    tone: {
      active: "from-indigo-500 to-blue-400",
      idle: "hover:border-indigo-200 hover:bg-indigo-50/90 hover:text-indigo-700",
      iconIdle: "bg-indigo-50 text-indigo-600",
    },
    visible: (permissions) =>
      canView(permissions, "despacho_total")
      || canView(permissions, "despacho_mesa")
      || canView(permissions, "despacho_para_llevar"),
  },
  {
    to: "/despacho",
    label: "Despacho",
    icon: <ChefHat className="h-5 w-5" />,
    group: "OPERATIVO",
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
    group: "OPERATIVO",
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
    group: "FINANZAS",
    tone: {
      active: "from-emerald-500 to-lime-400",
      idle: "hover:border-emerald-200 hover:bg-emerald-50/90 hover:text-emerald-700",
      iconIdle: "bg-emerald-50 text-emerald-600",
    },
    visible: (permissions) => canView(permissions, "caja"),
  },
  {
    to: "/promociones?origin=promociones",
    label: "Registrar participante",
    icon: <Gift className="h-5 w-5" />,
    group: "PROMOCIONES",
    tone: {
      active: "from-fuchsia-500 to-violet-400",
      idle: "hover:border-fuchsia-200 hover:bg-fuchsia-50/90 hover:text-fuchsia-700",
      iconIdle: "bg-fuchsia-50 text-fuchsia-600",
    },
    visible: () => false,
  },
  {
    to: "/promociones/consulta",
    label: "Consulta",
    icon: <Search className="h-5 w-5" />,
    group: "PROMOCIONES",
    tone: {
      active: "from-fuchsia-600 to-pink-500",
      idle: "hover:border-fuchsia-200 hover:bg-fuchsia-50/90 hover:text-fuchsia-700",
      iconIdle: "bg-fuchsia-50 text-fuchsia-600",
    },
    visible: () => false,
  },
  {
    to: "/campanas?origin=campanas",
    label: "Campañas",
    icon: <Megaphone className="h-5 w-5" />,
    group: "PROMOCIONES",
    tone: {
      active: "from-violet-500 to-purple-400",
      idle: "hover:border-violet-200 hover:bg-violet-50/90 hover:text-violet-700",
      iconIdle: "bg-violet-50 text-violet-600",
    },
    visible: () => false,
  },
  {
    to: "/reportes",
    label: "Reportes",
    icon: <BarChart3 className="h-5 w-5" />,
    group: "ADMINISTRACIÓN",
    tone: {
      active: "from-violet-500 to-fuchsia-400",
      idle: "hover:border-violet-200 hover:bg-violet-50/90 hover:text-violet-700",
      iconIdle: "bg-violet-50 text-violet-600",
    },
    visible: (permissions) => canView(permissions, "admin_sucursal") || canView(permissions, "admin_global"),
  },
  {
    to: "/turno",
    label: "Turno",
    icon: <PlayCircle className="h-5 w-5" />,
    group: "ADMINISTRACIÓN",
    tone: {
      active: "from-orange-400 to-amber-300",
      idle: "hover:border-orange-200 hover:bg-orange-50/90 hover:text-orange-700",
      iconIdle: "bg-orange-50 text-orange-600",
    },
    visible: (permissions) =>
      canView(permissions, "turno") || canView(permissions, "admin_sucursal") || canView(permissions, "admin_global"),
  },
  {
    to: "/admin",
    label: "Administración",
    icon: <Settings className="h-5 w-5" />,
    group: "ADMINISTRACIÓN",
    tone: {
      active: "from-slate-700 to-slate-500",
      idle: "hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-700",
      iconIdle: "bg-slate-100 text-slate-600",
    },
    visible: (permissions) => canView(permissions, "admin_sucursal") || canView(permissions, "admin_global"),
  },
  {
    to: "/monitoreo-global",
    label: "Monitoreo Global",
    icon: <MonitorCheck className="h-5 w-5" />,
    group: "ADMINISTRACIÓN",
    tone: {
      active: "from-indigo-600 to-violet-500",
      idle: "hover:border-indigo-200 hover:bg-indigo-50/90 hover:text-indigo-700",
      iconIdle: "bg-indigo-50 text-indigo-600",
    },
    // Visibility is handled manually in the useMemo below (isGlobalAdmin check)
    visible: () => false,
  },
];

export function useVisibleNavItems() {
  const { permissions, isGlobalAdmin, branches } = useBranch();
  const { hasAccess: hasDispatchAccess, fallbackVisible, isLoading: dispatchAccessLoading } = useDispatchAccess();
  const shiftGateQuery = useBranchShiftGate();

  return useMemo(() => {
    const sg = shiftGateQuery.data;

    const navItemsResolved = NAV_ITEMS.flatMap((navItem) => {
      if (navItem.to !== "/caja") return [navItem];
      return [
        {
          ...navItem,
          to: "/caja",
          label: "Recaudar",
          icon: <Banknote className="h-5 w-5" />,
          end: true,
        },
        {
          ...navItem,
          to: "/caja?tab=completed",
          label: "Pagos del turno",
          icon: <History className="h-5 w-5" />,
        }
      ];
    });

    const isGlobalAdminWithoutBranches = isGlobalAdmin && branches.length === 0;
    const canAccessAdmin = isGlobalAdmin || canView(permissions, "admin_sucursal") || canView(permissions, "admin_global");
    const canAccessTurno = canAccessAdmin || canView(permissions, "turno");
    const puedeGestionarCampanas = isGlobalAdmin || canManage(permissions, "admin_global");
    const puedeRegistrarPromociones = Boolean(sg?.puedeRegistrarPromociones);
    const hasOperationalShift = Boolean(sg?.shiftOpen) && Boolean(sg?.userEnabled);
    const hasSupervisorBypass = Boolean(sg?.isSupervisor);
    const visibleItems = navItemsResolved.filter((item) => {
      if (isGlobalAdminWithoutBranches) {
        return item.to === "/admin";
      }

      if (!hasOperationalShift) {
        return (
          (item.to === "/admin" && canAccessAdmin)
          || (item.to.startsWith("/campanas") && puedeGestionarCampanas)
          || (item.to.startsWith("/promociones/consulta") && (puedeRegistrarPromociones || puedeGestionarCampanas))
          || (item.to.startsWith("/promociones") && (puedeRegistrarPromociones || isGlobalAdmin))
          || (item.to.startsWith("/clientes") && isGlobalAdmin)
          || (item.to === "/ordenes" && isGlobalAdmin)
          || (item.to === "/turno" && canAccessTurno)
          || (item.to === "/reportes" && canAccessAdmin)
          || (item.to === "/monitoreo-global" && isGlobalAdmin)
        );
      }

      if (item.to === "/admin" && isGlobalAdmin) {
        return true;
      }

      if (item.to === "/reportes") {
        return canAccessAdmin || hasSupervisorBypass || Boolean(sg?.isSupervisor) || Boolean(sg?.canAuthorizeOrderCancel);
      }

      if (item.to.startsWith("/campanas")) {
        return puedeGestionarCampanas;
      }

      if (item.to.startsWith("/promociones/consulta")) {
        return puedeRegistrarPromociones || puedeGestionarCampanas;
      }

      if (item.to.startsWith("/promociones")) {
        return puedeRegistrarPromociones || isGlobalAdmin;
      }

      if (item.to === "/mesas" || item.to === "/para-llevar" || item.to === "/express" || item.to === "/extra" || item.to === "/orden-especial" || item.to === "/ordenes") {
        if (!hasSupervisorBypass && Boolean(sg?.canPackOrders)) {
          return item.to === "/extra";
        }
        
        if (item.to === "/mesas") {
          return hasSupervisorBypass || Boolean(sg?.canServeTables);
        }
        if (item.to === "/extra") {
          return hasSupervisorBypass || Boolean(sg?.canServeTables) || Boolean(sg?.canPackOrders);
        }
        if (item.to === "/para-llevar" || item.to === "/express" || item.to === "/orden-especial") {
          return hasSupervisorBypass || isGlobalAdmin || Boolean(sg?.canServeTables);
        }
        return hasSupervisorBypass
          || isGlobalAdmin
          || Boolean(sg?.canServeTables)
          || Boolean(sg?.canAccessOrders);
      }

      if (item.to === "/productos") {
        return hasSupervisorBypass
          || Boolean(sg?.canDispatchOrders)
          || Boolean(sg?.canManageProducts);
      }

      if (isCajaFinanceNavPath(item.to)) {
        return canSeeCajaFinanceNav(sg);
      }

      if (item.to === "/servir") {
        return hasSupervisorBypass || Boolean(sg?.canServePlates);
      }

      if (item.to === "/despacho") {
        if (!(hasSupervisorBypass || Boolean(sg?.canDispatchOrders))) return false;
        return dispatchAccessLoading ? fallbackVisible : hasDispatchAccess;
      }

      if (item.to === "/monitoreo-global") {
        return isGlobalAdmin;
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
    shiftGateQuery.data?.canAccessOrders,
    shiftGateQuery.data?.canEditOrders,
    shiftGateQuery.data?.canDispatchOrders,
    shiftGateQuery.data?.canManageProducts,
    shiftGateQuery.data?.canServeTables,
    shiftGateQuery.data?.canPackOrders,
    shiftGateQuery.data?.canDoubleSession,
    shiftGateQuery.data?.canUseCaja,
    shiftGateQuery.data?.globalCajaSessionsUsed,
    shiftGateQuery.data?.isSupervisor,
    shiftGateQuery.data?.canAuthorizeOrderCancel,
    shiftGateQuery.data?.maxCajaSessions,
    shiftGateQuery.data?.cajaSessionSlots,
    shiftGateQuery.data?.shiftOpen,
    shiftGateQuery.data?.userEnabled,
    shiftGateQuery.data?.cajaStatus,
    shiftGateQuery.data?.puedeRegistrarPromociones,
  ]);
}
