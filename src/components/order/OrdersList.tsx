import { useState } from "react";
import { useOrdersByStatus, OrderSummary } from "@/hooks/useOrdersByStatus";
import { useBranch } from "@/contexts/BranchContext";
import { OrderCard } from "./OrderCard";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TabType = "sent" | "ready" | "dispatched" | "cancelled" | "paid";

interface TabInfo {
  key: TabType;
  label: string;
  status: string | null;
  showCancel: boolean;
}

const tabs: TabInfo[] = [
  { key: "sent", label: "Enviadas", status: "SENT_TO_KITCHEN", showCancel: true },
  { key: "ready", label: "Listas", status: "READY", showCancel: true },
  { key: "dispatched", label: "Despachadas", status: "KITCHEN_DISPATCHED", showCancel: true },
  { key: "cancelled", label: "Canceladas", status: "CANCELLED", showCancel: false },
  { key: "paid", label: "Pagadas", status: "PAID", showCancel: false },
];

interface OrdersListProps {
  onCancelOrder?: (order: OrderSummary) => void;
}

export default function OrdersList({ onCancelOrder }: OrdersListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("sent");
  const { activeBranchId } = useBranch();

  const sentOrders = useOrdersByStatus("SENT_TO_KITCHEN");
  const readyOrders = useOrdersByStatus("READY");
  const dispatchedOrders = useOrdersByStatus("KITCHEN_DISPATCHED");
  const cancelledOrders = useOrdersByStatus("CANCELLED");
  const paidOrders = useOrdersByStatus("PAID");

  const getOrdersForTab = (tab: TabType) => {
    switch (tab) {
      case "sent":
        return sentOrders;
      case "ready":
        return readyOrders;
      case "dispatched":
        return dispatchedOrders;
      case "cancelled":
        return cancelledOrders;
      case "paid":
        return paidOrders;
    }
  };

  const getTabCount = (tab: TabType) => {
    const orders = getOrdersForTab(tab);
    return orders.data?.length || 0;
  };

  if (!activeBranchId) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Selecciona una sucursal para ver las órdenes
      </div>
    );
  }

  const currentOrders = getOrdersForTab(activeTab);
  const currentTab = tabs.find(t => t.key === activeTab)!;

  const totalOrders = getTabCount("sent") + getTabCount("dispatched") + getTabCount("cancelled") + getTabCount("paid");

  return (
    <div className="w-full">
      {/* Header with total count */}
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-display text-lg font-bold text-foreground">Todas las órdenes</h2>
        <span className="text-xs text-muted-foreground">({totalOrders} total)</span>
      </div>
      {/* Improved Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-muted/30 rounded-xl">
        {tabs.map((tab) => {
          const count = getTabCount(tab.key);
          const isActive = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {tab.label}
              {count > 0 && (
                <Badge
                  variant={isActive ? "default" : "secondary"}
                  className="h-5 px-1.5 text-xs"
                >
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {currentOrders.isLoading ? (
          <div className="col-span-full flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !currentOrders.data || currentOrders.data.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No hay órdenes {currentTab.label.toLowerCase()}
          </div>
        ) : (
          currentOrders.data.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onCancel={onCancelOrder}
              showCancelButton={currentTab.showCancel}
            />
          ))
        )}
      </div>
    </div>
  );
}