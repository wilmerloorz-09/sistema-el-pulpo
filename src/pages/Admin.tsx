import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, Layers, Package, Sparkles, UtensilsCrossed, CreditCard, Coins, Users, Building2, Copy } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";

const TABS = [
  { value: "branches", label: "Sucursales", icon: <Building2 className="h-4 w-4" />, component: BranchesCrud, superadminOnly: false },
  { value: "categories", label: "Categorías", icon: <LayoutGrid className="h-4 w-4" />, component: CategoriesCrud, superadminOnly: false },
  { value: "subcategories", label: "Subcategorías", icon: <Layers className="h-4 w-4" />, component: SubcategoriesCrud, superadminOnly: false },
  { value: "products", label: "Productos", icon: <Package className="h-4 w-4" />, component: ProductsCrud, superadminOnly: false },
  { value: "modifiers", label: "Modificadores", icon: <Sparkles className="h-4 w-4" />, component: ModifiersCrud, superadminOnly: false },
  { value: "tables", label: "Mesas", icon: <UtensilsCrossed className="h-4 w-4" />, component: TablesCrud, superadminOnly: false },
  { value: "payment-methods", label: "Métodos de Pago", icon: <CreditCard className="h-4 w-4" />, component: PaymentMethodsCrud, superadminOnly: false },
  { value: "denominations", label: "Denominaciones", icon: <Coins className="h-4 w-4" />, component: DenominationsCrud, superadminOnly: false },
  { value: "users", label: "Usuarios", icon: <Users className="h-4 w-4" />, component: UsersCrud, superadminOnly: false },
  { value: "clone", label: "Duplicar", icon: <Copy className="h-4 w-4" />, component: CloneBranchCatalog, superadminOnly: false },
];

const Admin = () => {
  const { activeRole } = useAuth();
  const visibleTabs = TABS.filter(tab => !tab.superadminOnly || activeRole === "superadmin");
  const defaultTab = visibleTabs[0]?.value ?? "categories";

  return (
    <div className="p-4 space-y-4">
      <h1 className="font-display text-xl font-bold text-foreground">Administración</h1>

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
    </div>
  );
};

export default Admin;
