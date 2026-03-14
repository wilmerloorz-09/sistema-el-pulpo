import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, UtensilsCrossed, CreditCard, Coins, Users, Building2, Copy, Truck, FolderTree, ChevronDown, Menu, X, AlertTriangle } from "lucide-react";
import ModifiersCrud from "@/components/admin/ModifiersCrud";
import TablesCrud from "@/components/admin/TablesCrud";
import PaymentMethodsCrud from "@/components/admin/PaymentMethodsCrud";
import DenominationsCrud from "@/components/admin/DenominationsCrud";
import UsersCrud from "@/components/admin/UsersCrud";
import BranchesCrud from "@/components/admin/BranchesCrud";
import CloneBranchCatalog from "@/components/admin/CloneBranchCatalog";
import DispatchConfig from "@/components/admin/DispatchConfig";
import MenuNodesCrud from "@/components/admin/MenuNodesCrud";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface AdminTab {
  value: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
  visible: (permissions: Record<string, any>, isGlobalAdmin: boolean) => boolean;
}

interface AdminErrorBoundaryProps {
  activeTabLabel: string;
  children: React.ReactNode;
}

interface AdminErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AdminErrorBoundary extends React.Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  constructor(props: AdminErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || "Error desconocido en el modulo de administracion.",
    };
  }

  componentDidCatch(error: Error) {
    console.error("Admin module crashed", error);
  }

  componentDidUpdate(prevProps: AdminErrorBoundaryProps) {
    if (prevProps.activeTabLabel !== this.props.activeTabLabel && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">No se pudo abrir la seccion {this.props.activeTabLabel}.</p>
              <p className="text-xs">Detalle: {this.state.errorMessage}</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const TABS: AdminTab[] = [
  {
    value: "branches",
    label: "Sucursales",
    icon: <Building2 className="h-4 w-4" />,
    component: BranchesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_global"),
  },
  {
    value: "dispatch",
    label: "Despacho",
    icon: <Truck className="h-4 w-4" />,
    component: DispatchConfig,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "menu-tree",
    label: "Arbol Menu",
    icon: <FolderTree className="h-4 w-4" />,
    component: MenuNodesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "modifiers",
    label: "Modificadores",
    icon: <Sparkles className="h-4 w-4" />,
    component: ModifiersCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "tables",
    label: "Mesas",
    icon: <UtensilsCrossed className="h-4 w-4" />,
    component: TablesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "payment-methods",
    label: "Metodos de Pago",
    icon: <CreditCard className="h-4 w-4" />,
    component: PaymentMethodsCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "denominations",
    label: "Denominaciones",
    icon: <Coins className="h-4 w-4" />,
    component: DenominationsCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "users",
    label: "Usuarios",
    icon: <Users className="h-4 w-4" />,
    component: UsersCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "clone",
    label: "Duplicar",
    icon: <Copy className="h-4 w-4" />,
    component: CloneBranchCatalog,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_global"),
  },
];

const Admin = () => {
  const { permissions, branches, isGlobalAdmin } = useBranch();
  const [activeTab, setActiveTab] = useState("");
  const [mobileTabsOpen, setMobileTabsOpen] = useState(false);

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => tab.visible(permissions, isGlobalAdmin)),
    [permissions, isGlobalAdmin],
  );

  const defaultTab = isGlobalAdmin && branches.length === 0
    ? (visibleTabs.find((tab) => tab.value === "branches")?.value ?? visibleTabs[0]?.value ?? "branches")
    : (visibleTabs[0]?.value ?? "users");

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(defaultTab);
      return;
    }

    if (!activeTab) {
      setActiveTab(defaultTab);
    }
  }, [activeTab, defaultTab, visibleTabs]);

  const selectedTab = visibleTabs.find((tab) => tab.value === activeTab) ?? visibleTabs[0] ?? null;
  const SelectedComponent = selectedTab?.component ?? null;

  return (
    <div className="space-y-4 p-4">
      <div className="surface-glow px-5 py-4">
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-black text-foreground">Administracion</h1>
              <p className="text-sm text-muted-foreground">Configura catalogo, accesos y operacion de la sucursal.</p>
            </div>
          </div>
        {visibleTabs.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 rounded-2xl md:hidden"
            onClick={() => setMobileTabsOpen((open) => !open)}
          >
            {mobileTabsOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            {selectedTab?.label ?? "Secciones"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", mobileTabsOpen && "rotate-180")} />
          </Button>
        )}
        </div>
      </div>

      {isGlobalAdmin && branches.length === 0 && (
        <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
          No hay sucursales creadas. Puedes crear la primera desde la pestana <span className="font-medium text-foreground">Sucursales</span>.
        </div>
      )}

      {visibleTabs.length === 0 ? (
        <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
          No tienes permisos administrativos para esta sucursal.
        </div>
      ) : (
        <>
          <div className="md:hidden">
            {mobileTabsOpen && (
              <div className="rounded-[24px] border border-orange-200 bg-white/85 p-2 shadow-[0_18px_40px_-34px_rgba(249,115,22,0.55)]">
                <div className="grid gap-2">
                  {visibleTabs.map((tab) => (
                    <Button
                      key={tab.value}
                      type="button"
                      variant={tab.value === activeTab ? "default" : "ghost"}
                      className="h-11 justify-start gap-2 rounded-2xl"
                      onClick={() => {
                        setActiveTab(tab.value);
                        setMobileTabsOpen(false);
                      }}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="-mx-4 hidden overflow-x-auto px-4 pb-2 md:block">
            <div className="inline-flex gap-2 rounded-[28px] border border-orange-200 bg-white/80 p-2 shadow-[0_18px_45px_-36px_rgba(249,115,22,0.5)]">
              {visibleTabs.map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  variant={tab.value === activeTab ? "default" : "outline"}
                  className={cn(
                    "gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-xs font-semibold",
                    tab.value === activeTab
                      ? "shadow-[0_16px_30px_-22px_rgba(249,115,22,0.95)]"
                      : "border-transparent bg-white/70 hover:border-orange-200 hover:bg-orange-50",
                  )}
                  onClick={() => setActiveTab(tab.value)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <AdminErrorBoundary activeTabLabel={selectedTab?.label ?? "Administracion"}>
              {SelectedComponent ? <SelectedComponent /> : null}
            </AdminErrorBoundary>
          </div>
        </>
      )}
    </div>
  );
};

export default Admin;
