import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import MenuNavigator from "@/components/order/MenuNavigator";
import type { MenuNode } from "@/hooks/useMenuTree";
import type { InventarioProductoInfo } from "@/lib/inventarioMenuData";
import {
  fetchInventarioProductoMap,
  mergeInventarioInfo,
  resolveMenuNodeProductId,
} from "@/lib/inventarioMenuData";

type InventarioArbolPanelProps = {
  branchId: string | null;
  renderNodeAction: (node: MenuNode, info: InventarioProductoInfo) => ReactNode;
};

const InventarioArbolPanel = ({
  branchId,
  renderNodeAction,
}: InventarioArbolPanelProps) => {
  const inventarioQuery = useQuery({
    queryKey: ["inventario-producto-map", branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      if (!branchId) return new Map();
      return fetchInventarioProductoMap(branchId);
    },
  });

  const inventarioMap = inventarioQuery.data ?? new Map();

  const handleRenderNodeAction = (node: MenuNode) => {
    const productoId = resolveMenuNodeProductId(node);
    if (!productoId) return null;
    const info = mergeInventarioInfo(inventarioMap, productoId);
    return renderNodeAction(node, info);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60 p-3 sm:p-4">
      <MenuNavigator
        menuScope="TABLE"
        hidePrices
        includeInactive
        renderNodeAction={handleRenderNodeAction}
      />
    </div>
  );
};

export default InventarioArbolPanel;
