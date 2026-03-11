import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, Layers, Package, Sparkles, UtensilsCrossed, CreditCard, Coins, Users, Building2, Copy, Truck } from "lucide-react";
import CategoriesCrud from "@/components/admin/CategoriesCrud";
import SubcategoriesCrud from "@/components/admin/SubcategoriesCrud";
import ProductsCrud from "@/components/admin/ProductsCrud";
import ModifiersCrud from "@/components/admin/ModifiersCrud";
import SubcategoryModifiersCrud from "@/components/admin/SubcategoryModifiersCrud";
import TablesCrud from "@/components/admin/TablesCrud";
import PaymentMethodsCrud from "@/components/admin/PaymentMethodsCrud";
import DenominationsCrud from "@/components/admin/DenominationsCrud";
import UsersCrud from "@/components/admin/UsersCrud";
import BranchesCrud from "@/components/admin/BranchesCrud";
import CloneBranchCatalog from "@/components/admin/CloneBranchCatalog";
import DispatchConfig from "@/components/admin/DispatchConfig";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";

interface AdminTab {
  value: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
  visible: (permissions: Record<string, any>, isGlobalAdmin: boolean) => boolean;
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
    value: "categories",
    label: "Categorias",
    icon: <LayoutGrid className="h-4 w-4" />,
    component: CategoriesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "subcategories",
    label: "Subcategorias",
    icon: <Layers className="h-4 w-4" />,
    component: SubcategoriesCrud,
    visible: (permissions, isGlobalAdmin) => isGlobalAdmin || canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "products",
    label: "Productos",
    icon: <Package className="h-4 w-4" />,
    component: ProductsCrud,
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

  const visibleTabs = TABS.filter((tab) => tab.visible(permissions, isGlobalAdmin));
  const defaultTab = isGlobalAdmin && branches.length === 0
    ? (visibleTabs.find((tab) => tab.value === "branches")?.value ?? visibleTabs[0]?.value ?? "branches")
    : (visibleTabs[0]?.value ?? "users");

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-xl font-bold text-foreground">Administracion</h1>

      {isGlobalAdmin && branches.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No hay sucursales creadas. Puedes crear la primera desde la pestana <span className="font-medium text-foreground">Sucursales</span>.
        </div>
      )}

      {visibleTabs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No tienes permisos administrativos para esta sucursal.
        </div>
      ) : (
        <Tabs defaultValue={defaultTab} className="w-full">
          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <TabsList className="inline-flex h-auto gap-1 rounded-xl bg-muted/50 p-1">
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm"
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {visibleTabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-3">
              <tab.component />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
};

export default Admin;
