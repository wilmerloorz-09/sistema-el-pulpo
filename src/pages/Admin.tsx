import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, Layers, Package, Sparkles, UtensilsCrossed, CreditCard, Coins, Users, Building2, Copy, Truck } from "lucide-react";
import CategoriesCrud from "@/components/admin/CategoriesCrud";
import SubcategoriesCrud from "@/components/admin/SubcategoriesCrud";
import ProductsCrud from "@/components/admin/ProductsCrud";
import ModifiersCrud from "@/components/admin/ModifiersCrud";
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
  visible: (permissions: Record<string, any>) => boolean;
}

const TABS: AdminTab[] = [
  {
    value: "branches",
    label: "Sucursales",
    icon: <Building2 className="h-4 w-4" />,
    component: BranchesCrud,
    visible: (permissions) => canManage(permissions, "admin_global"),
  },
  {
    value: "dispatch",
    label: "Despacho",
    icon: <Truck className="h-4 w-4" />,
    component: DispatchConfig,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "categories",
    label: "Categorias",
    icon: <LayoutGrid className="h-4 w-4" />,
    component: CategoriesCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "subcategories",
    label: "Subcategorias",
    icon: <Layers className="h-4 w-4" />,
    component: SubcategoriesCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "products",
    label: "Productos",
    icon: <Package className="h-4 w-4" />,
    component: ProductsCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "modifiers",
    label: "Modificadores",
    icon: <Sparkles className="h-4 w-4" />,
    component: ModifiersCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "tables",
    label: "Mesas",
    icon: <UtensilsCrossed className="h-4 w-4" />,
    component: TablesCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "payment-methods",
    label: "Metodos de Pago",
    icon: <CreditCard className="h-4 w-4" />,
    component: PaymentMethodsCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "denominations",
    label: "Denominaciones",
    icon: <Coins className="h-4 w-4" />,
    component: DenominationsCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "users",
    label: "Usuarios",
    icon: <Users className="h-4 w-4" />,
    component: UsersCrud,
    visible: (permissions) => canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global"),
  },
  {
    value: "clone",
    label: "Duplicar",
    icon: <Copy className="h-4 w-4" />,
    component: CloneBranchCatalog,
    visible: (permissions) => canManage(permissions, "admin_global"),
  },
];

const Admin = () => {
  const { permissions } = useBranch();

  const visibleTabs = TABS.filter((tab) => tab.visible(permissions));
  const defaultTab = visibleTabs[0]?.value ?? "users";

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-xl font-bold text-foreground">Administracion</h1>

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
                  className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
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
