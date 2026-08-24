import { supabase } from "@/integrations/supabase/client";
import type { TipoProducto } from "@/lib/inventarioProductos";

export type InventarioProductoInfo = {
  productoId: string;
  cantidadDisponible: number;
  tipoProducto: TipoProducto;
  activoCatalogo: boolean;
  /** Por sucursal; false si no hay fila en inventario_productos. */
  integraConVentas: boolean;
  inventarioId: string | null;
};

export function resolveMenuNodeProductId(node: {
  node_type: string;
  id: string;
  legacy_product_id?: string | null;
}): string | null {
  if (node.node_type !== "product") return null;
  const legacyId = node.legacy_product_id?.trim();
  if (legacyId) return legacyId;
  return node.id;
}

export async function fetchInventarioProductoMap(
  branchId: string,
): Promise<Map<string, InventarioProductoInfo>> {
  const map = new Map<string, InventarioProductoInfo>();

  const { data: inventoryRows, error: invError } = await supabase
    .from("inventario_productos")
    .select(`
      id,
      producto_id,
      cantidad_disponible,
      integra_con_ventas,
      products (
        id,
        tipo_producto,
        is_active
      )
    `)
    .eq("sucursal_id", branchId);
  if (invError) throw invError;

  for (const row of inventoryRows ?? []) {
    const product = row.products as {
      id: string;
      tipo_producto: TipoProducto | null;
      is_active: boolean;
    } | null;
    if (!product) continue;
    map.set(row.producto_id, {
      productoId: row.producto_id,
      inventarioId: row.id,
      cantidadDisponible: Number(row.cantidad_disponible ?? 0),
      tipoProducto: product.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO",
      activoCatalogo: product.is_active,
      integraConVentas: Boolean(row.integra_con_ventas),
    });
  }

  return map;
}

export function mergeInventarioInfo(
  inventarioMap: Map<string, InventarioProductoInfo>,
  productId: string,
): InventarioProductoInfo {
  return inventarioMap.get(productId) ?? {
    productoId: productId,
    inventarioId: null,
    cantidadDisponible: 0,
    tipoProducto: "COMPRADO",
    activoCatalogo: true,
    integraConVentas: false,
  };
}
