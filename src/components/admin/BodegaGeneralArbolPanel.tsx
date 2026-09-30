import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import MenuNavigator from "@/components/order/MenuNavigator";
import { useBranch } from "@/contexts/BranchContext";
import { fetchMenuTreeNodes, getMenuTreeQueryKey, type MenuNode } from "@/hooks/useMenuTree";
import type { InventarioProductoInfo } from "@/lib/inventarioMenuData";
import { mergeInventarioInfo } from "@/lib/inventarioMenuData";
import { supabase } from "@/integrations/supabase/client";
import type { TipoProducto } from "@/lib/inventarioProductos";

type BodegaGeneralArbolPanelProps = {
  renderNodeAction: (node: MenuNode, info: InventarioProductoInfo) => ReactNode;
};

function resolveProductoGlobalId(node: MenuNode): string | null {
  if (node.node_type !== "product") return null;
  const globalId = node.producto_global_id?.trim();
  return globalId || null;
}

async function fetchBodegaGeneralProductoMap(): Promise<Map<string, InventarioProductoInfo>> {
  const map = new Map<string, InventarioProductoInfo>();
  const { data, error } = await supabase.rpc("listar_inventario_bodega_general" as any);
  if (error) throw error;

  for (const row of (data as any[]) ?? []) {
    const productoGlobalId = row.producto_global_id as string;
    if (!productoGlobalId) continue;
    const tipoProducto: TipoProducto =
      row.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO";
    map.set(productoGlobalId, {
      productoId: productoGlobalId,
      inventarioId: (row.inventario_id as string | null) ?? null,
      cantidadDisponible: Number(row.cantidad_disponible ?? 0),
      tipoProducto,
      activoCatalogo: Boolean(row.activo),
      integraConVentas: false,
      limiteStock: 0,
    });
  }

  return map;
}

/** Solo productos COMPRADO; categorías sin productos comprados debajo se ocultan. */
function filtrarArbolComprados(
  nodes: MenuNode[],
  inventarioMap: Map<string, InventarioProductoInfo>,
): MenuNode[] {
  const productosVisibles = nodes.filter((node) => {
    if (node.node_type !== "product") return false;
    const productoGlobalId = resolveProductoGlobalId(node);
    return Boolean(productoGlobalId && inventarioMap.get(productoGlobalId)?.tipoProducto === "COMPRADO");
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const categoriasVisibles = new Set<string>();
  for (const producto of productosVisibles) {
    let parentId = producto.parent_id;
    while (parentId && !categoriasVisibles.has(parentId)) {
      categoriasVisibles.add(parentId);
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
  }

  const productoIds = new Set(productosVisibles.map((node) => node.id));
  return nodes.filter((node) => productoIds.has(node.id) || categoriasVisibles.has(node.id));
}

const BodegaGeneralArbolPanel = ({ renderNodeAction }: BodegaGeneralArbolPanelProps) => {
  const { activeBranchId } = useBranch();

  const inventarioQuery = useQuery({
    queryKey: ["inventario-bodega-general-map"],
    queryFn: fetchBodegaGeneralProductoMap,
  });

  const menuQuery = useQuery({
    queryKey: getMenuTreeQueryKey({
      branchId: activeBranchId,
      menuScope: "TABLE",
      includeInactive: true,
    }),
    queryFn: () =>
      fetchMenuTreeNodes({
        branchId: activeBranchId!,
        menuScope: "TABLE",
        includeInactive: true,
      }),
    enabled: !!activeBranchId,
    staleTime: 60_000,
  });

  const inventarioMap = inventarioQuery.data ?? new Map();

  const nodosComprados = useMemo(() => {
    if (!menuQuery.data || !inventarioQuery.data) return null;
    return filtrarArbolComprados(menuQuery.data, inventarioQuery.data);
  }, [menuQuery.data, inventarioQuery.data]);

  const handleRenderNodeAction = (node: MenuNode) => {
    const productoGlobalId = resolveProductoGlobalId(node);
    if (!productoGlobalId) return null;
    const info = mergeInventarioInfo(inventarioMap, productoGlobalId);
    return renderNodeAction(node, {
      ...info,
      productoId: productoGlobalId,
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

export default BodegaGeneralArbolPanel;
