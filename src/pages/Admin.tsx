import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Sparkles,
  CreditCard,
  Coins,
  Users,
  Building2,
  Copy,
  ChevronDown,
  Menu,
  X,
  AlertTriangle,
  UtensilsCrossed,
  ShoppingBag,
  Scale,
  FileStack,
  PackagePlus,
  Landmark,
  QrCode,
  UserCog,
  Package,
} from "lucide-react";
import BancosCrud from "@/components/admin/BancosCrud";
import CuentasBancariasDestinoAdmin from "@/components/admin/CuentasBancariasDestinoAdmin";
import FeriadosAdmin from "@/components/admin/FeriadosAdmin";
import ModifiersCrud from "@/components/admin/ModifiersCrud";
import DenominationsCrud from "@/components/admin/DenominationsCrud";
import CashRegisterTemplatesCrud from "@/components/admin/CashRegisterTemplatesCrud";
import UsersCrud from "@/components/admin/UsersCrud";
import BranchesCrud from "@/components/admin/BranchesCrud";
import CloneBranchCatalog from "@/components/admin/CloneBranchCatalog";
import FrequentProductsAdmin from "@/components/admin/FrequentProductsAdmin";
import MenuNodesCrud from "@/components/admin/MenuNodesCrud";
import ProductosGlobalesAdmin from "@/components/admin/ProductosGlobalesAdmin";
import QrMesasAdmin from "@/components/admin/QrMesasAdmin";
import TemporarySupervisorAdmin from "@/components/admin/TemporarySupervisorAdmin";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface AdminTab {
  value: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
  visible: (
    permissions: Record<string, unknown>,
    isGlobalAdmin: boolean,
    usaCatalogoGlobal: boolean,
  ) => boolean;
}

interface AdminCategoryDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  tabValues: readonly string[];
}

interface AdminCategory extends AdminCategoryDef {
  tabs: AdminTab[];
}

const MenuNodesCrudTable = () => (
  <MenuNodesCrud menuScope="TABLE" title="Menu Mesa" />
);

const MenuNodesCrudTakeout = () => (
  <MenuNodesCrud menuScope="TAKEOUT" title="Con envase" showCopyFromTableButton />
);

const MenuNodesCrudBulk = () => (
  <MenuNodesCrud menuScope="BULK" title="A Granel" />
);

const MenuNodesCrudExtra = () => <FrequentProductsAdmin />;

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
    value: "users",
    label: "Usuarios",
    icon: <Users className="h-4 w-4" />,
    component: UsersCrud,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
  {
    value: "temporary-supervisor",
    label: "Supervisor temporal",
    icon: <UserCog className="h-4 w-4" />,
    component: TemporarySupervisorAdmin,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
  {
    value: "productos-globales",
    label: "Productos generales",
    icon: <Package className="h-4 w-4" />,
    component: ProductosGlobalesAdmin,
    visible: (permissions, isGlobalAdmin, usaCatalogoGlobal) =>
      (isGlobalAdmin || canManage(permissions, "admin_global") || canManage(permissions, "admin_sucursal"))
      && (isGlobalAdmin || usaCatalogoGlobal),
  },
  {
    value: "clone",
    label: "Duplicar menú",
    icon: <Copy className="h-4 w-4" />,
    component: CloneBranchCatalog,
    visible: () => false,
  },
  {
    value: "menu-tree-table",
    label: "Menu Mesa",
    icon: <UtensilsCrossed className="h-4 w-4" />,
    component: MenuNodesCrudTable,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "menu-tree-takeout",
    label: "Con envase",
    icon: <ShoppingBag className="h-4 w-4" />,
    component: MenuNodesCrudTakeout,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "menu-tree-bulk",
    label: "A Granel",
    icon: <Scale className="h-4 w-4" />,
    component: MenuNodesCrudBulk,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "menu-tree-extra",
    label: "Más frecuentes",
    icon: <PackagePlus className="h-4 w-4" />,
    component: MenuNodesCrudExtra,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "mesas-qr",
    label: "Mesas QR",
    icon: <QrCode className="h-4 w-4" />,
    component: QrMesasAdmin,
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
    value: "denominations",
    label: "Denominaciones",
    icon: <Coins className="h-4 w-4" />,
    component: DenominationsCrud,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
  {
    value: "cash-register-templates",
    label: "Plantillas de caja",
    icon: <FileStack className="h-4 w-4" />,
    component: CashRegisterTemplatesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "bancos",
    label: "Bancos de origen",
    icon: <Landmark className="h-4 w-4" />,
    component: BancosCrud,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
  {
    value: "cuentas-bancarias",
    label: "Cuentas bancarias",
    icon: <CreditCard className="h-4 w-4" />,
    component: CuentasBancariasDestinoAdmin,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
  {
    value: "feriados",
    label: "Feriados",
    icon: <CalendarDays className="h-4 w-4" />,
    component: FeriadosAdmin,
    visible: (_permissions, isGlobalAdmin) => isGlobalAdmin,
  },
];

const ADMIN_CATEGORIES: AdminCategoryDef[] = [
  {
    id: "organization",
    label: "Organización",
    icon: <Building2 className="h-4 w-4" />,
    tabValues: ["branches", "users", "temporary-supervisor"],
  },
  {
    id: "menu-sales",
    label: "Menú y ventas",
    icon: <UtensilsCrossed className="h-4 w-4" />,
    tabValues: [
      "productos-globales",
      "menu-tree-table",
      "menu-tree-takeout",
      "menu-tree-bulk",
      "menu-tree-extra",
      "mesas-qr",
      "modifiers",
    ],
  },
  {
    id: "cash-payments",
    label: "Caja y pagos",
    icon: <Coins className="h-4 w-4" />,
    tabValues: ["denominations", "cash-register-templates", "bancos", "cuentas-bancarias"],
  },
  {
    id: "calendar",
    label: "Calendario",
    icon: <CalendarDays className="h-4 w-4" />,
    tabValues: ["feriados"],
  },
];

const categoryButtonClass = (isActive: boolean) =>
  cn(
    "h-10 gap-2 whitespace-nowrap rounded-2xl px-4 text-sm font-semibold",
    isActive
      ? "shadow-[0_16px_30px_-22px_rgba(249,115,22,0.95)]"
      : "border-transparent bg-white/70 hover:border-orange-200 hover:bg-orange-50",
  );

const subTabButtonClass = (isActive: boolean) =>
  cn(
    "h-9 gap-1.5 rounded-none border-b-2 bg-transparent px-3 text-xs font-medium shadow-none hover:bg-transparent",
    isActive
      ? "border-primary text-primary"
      : "border-transparent text-muted-foreground hover:border-orange-200/80 hover:text-foreground",
  );

const Admin = () => {
  const { permissions, branches, isGlobalAdmin, activeBranch } = useBranch();
  const usaCatalogoGlobal = Boolean(activeBranch?.usa_catalogo_global);
  const [activeTab, setActiveTab] = useState("");
  const [mobileTabsOpen, setMobileTabsOpen] = useState(false);

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => tab.visible(permissions, isGlobalAdmin, usaCatalogoGlobal)),
    [permissions, isGlobalAdmin, usaCatalogoGlobal],
  );

  const tabsByValue = useMemo(
    () => new Map(visibleTabs.map((tab) => [tab.value, tab])),
    [visibleTabs],
  );

  const visibleCategories = useMemo<AdminCategory[]>(
    () =>
      ADMIN_CATEGORIES.map((category) => ({
        ...category,
        tabs: category.tabValues
          .map((value) => tabsByValue.get(value))
          .filter((tab): tab is AdminTab => Boolean(tab)),
      })).filter((category) => category.tabs.length > 0),
    [tabsByValue],
  );

  const defaultTab = isGlobalAdmin && branches.length === 0
    ? (visibleTabs.find((tab) => tab.value === "branches")?.value ?? visibleTabs[0]?.value ?? "branches")
    : (visibleTabs[0]?.value ?? "users");

  const activeCategory = useMemo(
    () =>
      visibleCategories.find((category) => category.tabs.some((tab) => tab.value === activeTab))
      ?? visibleCategories[0]
      ?? null,
    [activeTab, visibleCategories],
  );

  const activeCategoryTabs = activeCategory?.tabs ?? [];
  const showSubTabs = activeCategoryTabs.length > 1;

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

  const handleCategoryClick = (category: AdminCategory) => {
    const isCurrentCategory = category.tabs.some((tab) => tab.value === activeTab);
    if (!isCurrentCategory) {
      setActiveTab(category.tabs[0].value);
    }
  };

  const mobileNavLabel = activeCategory && selectedTab
    ? `${activeCategory.label} · ${selectedTab.label}`
    : (selectedTab?.label ?? "Secciones");

  return (
    <div className="space-y-4 p-2.5 sm:p-4">
      <div className="surface-glow px-4 py-4 sm:px-5">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              className="h-11 w-full justify-between gap-2 rounded-2xl sm:hidden"
              onClick={() => setMobileTabsOpen((open) => !open)}
            >
              {mobileTabsOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              <span className="truncate">{mobileNavLabel}</span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", mobileTabsOpen && "rotate-180")} />
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
          <div className="sm:hidden">
            {mobileTabsOpen && (
              <div className="rounded-[24px] border border-orange-200 bg-white/85 p-2 shadow-[0_18px_40px_-34px_rgba(249,115,22,0.55)]">
                <div className="space-y-4">
                  {visibleCategories.map((category) => (
                    <div key={category.id} className="space-y-2">
                      <p className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {category.label}
                      </p>
                      <div className="grid gap-1.5">
                        {category.tabs.map((tab) => (
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
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="hidden sm:block">
            <div className="overflow-hidden rounded-[28px] border border-orange-200 bg-white/90 shadow-[0_18px_45px_-36px_rgba(249,115,22,0.5)]">
              <div className={cn("p-3", showSubTabs && "border-b border-orange-100")}>
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Sección
                </p>
                <div className="flex flex-wrap gap-2">
                  {visibleCategories.map((category) => {
                    const isActiveCategory = activeCategory?.id === category.id;

                    return (
                      <Button
                        key={category.id}
                        type="button"
                        variant={isActiveCategory ? "default" : "outline"}
                        className={categoryButtonClass(isActiveCategory)}
                        onClick={() => handleCategoryClick(category)}
                      >
                        {category.icon}
                        <span>{category.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {showSubTabs && activeCategory && (
                <div className="bg-slate-50/90 px-3 pb-1 pt-2.5">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {activeCategory.label}
                  </p>
                  <div className="flex flex-wrap gap-x-1 gap-y-0 border-b border-slate-200/80">
                    {activeCategoryTabs.map((tab) => (
                      <Button
                        key={tab.value}
                        type="button"
                        variant="ghost"
                        className={subTabButtonClass(tab.value === activeTab)}
                        onClick={() => setActiveTab(tab.value)}
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
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
