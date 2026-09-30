import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import MenuNavigator from "@/components/order/MenuNavigator";
import { filtrarArbolPorProducto } from "@/components/admin/BodegaGeneralArbolPanel";
import { fetchMenuTreeNodes, getMenuTreeQueryKey, type MenuNode } from "@/hooks/useMenuTree";
import type { InventarioProductoInfo } from "@/lib/inventarioMenuData";
import {
  fetchInventarioBodegaSucursalMap,
  fetchInventarioProductoMap,
  fetchProductosGlobalesCompradosIds,
  mergeInventarioInfo,
  resolveMenuNodeProductId,
} from "@/lib/inventarioMenuData";

export type InventarioStockSource = "nevera" | "bodega_sucursal";

type InventarioArbolPanelProps = {
  branchId: string | null;
  /** nevera = inventario_productos; bodega_sucursal = inventario_bodega_sucursal */
  stockSource?: InventarioStockSource;
  renderNodeAction: (node: MenuNode, info: InventarioProductoInfo) => ReactNode;
};

const InventarioArbolPanel = ({
  branchId,
  stockSource = "nevera",
  renderNodeAction,
}: InventarioArbolPanelProps) => {
  const inventarioQuery = useQuery({
    queryKey: ["inventario-producto-map", branchId, stockSource],
    enabled: Boolean(branchId),
    queryFn: async () => {
      if (!branchId) return new Map();
      if (stockSource === "bodega_sucursal") {
        return fetchInventarioBodegaSucursalMap(branchId);
      }
      return fetchInventarioProductoMap(branchId);
    },
  });

  const menuQuery = useQuery({
    queryKey: getMenuTreeQueryKey({ branchId, menuScope: "TABLE", includeInactive: true }),
    queryFn: () =>
      fetchMenuTreeNodes({ branchId: branchId!, menuScope: "TABLE", includeInactive: true }),
    enabled: Boolean(branchId),
    staleTime: 60_000,
  });

  const compradosQuery = useQuery({
    queryKey: ["productos-globales-comprados-ids"],
    queryFn: fetchProductosGlobalesCompradosIds,
    staleTime: 60_000,
  });

  const nodosComprados = useMemo(() => {
    if (!menuQuery.data || !compradosQuery.data) return null;
    const comprados = compradosQuery.data;
    return filtrarArbolPorProducto(
      menuQuery.data,
      (productoId) => comprados.has(productoId),
      resolveMenuNodeProductId,
    );
  }, [menuQuery.data, compradosQuery.data]);

  const inventarioMap = inventarioQuery.data ?? new Map();

  const handleRenderNodeAction = (node: MenuNode) => {
    const productoId = resolveMenuNodeProductId(node);
    if (!productoId) return null;
    const info = mergeInventarioInfo(inventarioMap, productoId);
    return renderNodeAction(node, {
      ...info,
      productoId,
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60 p-3 sm:p-4">
      <MenuNavigator
        menuScope="TABLE"
        hidePrices
        includeInactive
        nodesOverride={nodosComprados ?? []}
        forceLoading={!nodosComprados}
        renderNodeAction={handleRenderNodeAction}
      />
    </div>
  );
};

export default InventarioArbolPanel;
