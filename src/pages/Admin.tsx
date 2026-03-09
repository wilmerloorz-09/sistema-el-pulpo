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
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

type AllowedRole = "superadmin" | "admin" | "supervisor";

type AdminTab = {
  value: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
  allowedRoles: AllowedRole[];
  moduleCodes?: string[];
  adminGlobalOverride?: boolean;
};

const TABS: AdminTab[] = [
  {
    value: "branches",
    label: "Sucursales",
    icon: <Building2 className="h-4 w-4" />,
    component: BranchesCrud,
    allowedRoles: ["superadmin", "admin"],
    moduleCodes: ["sucursales"],
    adminGlobalOverride: true,
  },
  {
    value: "dispatch",
    label: "Despacho",
    icon: <Truck className="h-4 w-4" />,
    component: DispatchConfig,
    allowedRoles: ["superadmin", "admin"],
    moduleCodes: ["configuracion"],
    adminGlobalOverride: true,
  },
  { value: "categories", label: "Categorias", icon: <LayoutGrid className="h-4 w-4" />, component: CategoriesCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "subcategories", label: "Subcategorias", icon: <Layers className="h-4 w-4" />, component: SubcategoriesCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "products", label: "Productos", icon: <Package className="h-4 w-4" />, component: ProductsCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "modifiers", label: "Modificadores", icon: <Sparkles className="h-4 w-4" />, component: ModifiersCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "tables", label: "Mesas", icon: <UtensilsCrossed className="h-4 w-4" />, component: TablesCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "payment-methods", label: "Metodos de Pago", icon: <CreditCard className="h-4 w-4" />, component: PaymentMethodsCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "denominations", label: "Denominaciones", icon: <Coins className="h-4 w-4" />, component: DenominationsCrud, allowedRoles: ["superadmin", "admin"], moduleCodes: ["configuracion"], adminGlobalOverride: true },
  { value: "users", label: "Usuarios", icon: <Users className="h-4 w-4" />, component: UsersCrud, allowedRoles: ["superadmin", "admin", "supervisor"], moduleCodes: ["usuarios"], adminGlobalOverride: true },
  { value: "clone", label: "Duplicar", icon: <Copy className="h-4 w-4" />, component: CloneBranchCatalog, allowedRoles: ["superadmin"], moduleCodes: ["configuracion"] },
];

const Admin = () => {
  const { activeRole } = useAuth();
  const { allowedModules } = useBranch();

  const role = (activeRole ?? "admin") as AllowedRole;
  const isGlobalAdmin = role === "admin" || role === "superadmin";

  const visibleTabs = TABS.filter((tab) => {
    if (!tab.allowedRoles.includes(role)) return false;

    const hasModuleAccess = !tab.moduleCodes || tab.moduleCodes.some((code) => allowedModules.includes(code));

    if (hasModuleAccess) return true;

    if (isGlobalAdmin && tab.adminGlobalOverride) return true;

    return false;
  });

  const defaultTab = visibleTabs[0]?.value ?? "users";

  return (
    <div className="p-4 space-y-4">
      <h1 className="font-display text-xl font-bold text-foreground">Administracion</h1>

      {visibleTabs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No tienes modulos administrativos habilitados para esta sucursal.
        </div>
      ) : (
        <Tabs defaultValue={defaultTab} className="w-full">
          <div className="overflow-x-auto -mx-4 px-4 pb-2">
            <TabsList className="inline-flex h-auto gap-1 bg-muted/50 p-1 rounded-xl">
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-lg px-3 py-2 text-xs font-medium gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm whitespace-nowrap"
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
