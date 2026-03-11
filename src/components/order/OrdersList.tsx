import { useState } from "react";
import { useOrdersByStatus, OrderSummary } from "@/hooks/useOrdersByStatus";
import { useBranch } from "@/contexts/BranchContext";
import OrderCard from "./OrderCard";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TabType = "sent" | "ready" | "dispatched" | "cancelled" | "paid";

interface TabInfo {
  key: TabType;
  label: string;
  status: string | null;
  showCancel: boolean;
  helperText: string;
}

const tabs: TabInfo[] = [
  {
    key: "sent",
    label: "Enviadas",
    status: "SENT_TO_KITCHEN",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades que siguen pendientes por preparar.",
  },
  {
    key: "ready",
    label: "Listas",
    status: "READY",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades que ya estan listas para entregar o despachar.",
  },
  {
    key: "dispatched",
    label: "Despachadas",
    status: "KITCHEN_DISPATCHED",
    showCancel: true,
    helperText: "Aqui ves solo las cantidades de mesa que ya fueron despachadas, aunque la linea original haya sido mayor.",
  },
  {
    key: "cancelled",
    label: "Canceladas",
    status: "CANCELLED",
    showCancel: false,
    helperText: "Aqui ves las cantidades anuladas y tambien las ordenes para llevar ya despachadas.",
  },
  {
    key: "paid",
    label: "Pagadas",
    status: "PAID",
    showCancel: false,
    helperText: "Aqui ves las ordenes ya cerradas para cobro.",
  },
];

interface OrdersListProps {
  onCancelOrder?: (order: OrderSummary) => void;
  readOnly?: boolean;
}

export default function OrdersList({ onCancelOrder, readOnly = false }: OrdersListProps) {
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
    return <div className="py-8 text-center text-muted-foreground">Selecciona una sucursal para ver las ordenes</div>;
  }

  const currentOrders = getOrdersForTab(activeTab);
  const currentTab = tabs.find((tab) => tab.key === activeTab)!;
  const totalOrders = tabs.reduce((sum, tab) => sum + getTabCount(tab.key), 0);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-display text-lg font-bold text-foreground">Todas las ordenes</h2>
        <span className="text-xs text-muted-foreground">({totalOrders} total)</span>
        {readOnly && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Solo consulta
          </span>
        )}
      </div>

      <div className="mb-6 flex gap-1 rounded-xl bg-muted/30 p-1">
        {tabs.map((tab) => {
          const count = getTabCount(tab.key);
          const isActive = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <Badge variant={isActive ? "default" : "secondary"} className="h-5 px-1.5 text-xs">
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-4 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        {currentTab.helperText}
      </div>

      <div className="grid auto-rows-max grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {currentOrders.isLoading ? (
          <div className="col-span-full flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !currentOrders.data || currentOrders.data.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No hay ordenes {currentTab.label.toLowerCase()}
          </div>
        ) : (
          currentOrders.data.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onCancel={onCancelOrder}
              showCancelButton={currentTab.showCancel && !readOnly}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </div>
  );
}
