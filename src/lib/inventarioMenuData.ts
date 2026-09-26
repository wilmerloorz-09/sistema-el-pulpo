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
  producto_global_id?: string | null;
}): string | null {
  if (node.node_type !== "product") return null;
  const globalId = node.producto_global_id?.trim();
  if (globalId) return globalId;
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
      // Se sobrescribe abajo con el flag de bodega sucursal (fuente de verdad).
      integraConVentas: Boolean(row.integra_con_ventas),
    });
  }

  // Integra ventas se configura en bodega sucursal.
  const { data: bodegaRows, error: bodegaError } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select("producto_global_id, integra_con_ventas")
    .eq("sucursal_id", branchId);
  if (bodegaError) throw bodegaError;

  for (const row of (bodegaRows as any[]) ?? []) {
    const productoId = String(row.producto_global_id ?? "");
    if (!productoId) continue;
    const existing = map.get(productoId);
    if (existing) {
      existing.integraConVentas = Boolean(row.integra_con_ventas);
    } else if (row.integra_con_ventas) {
      map.set(productoId, {
        productoId,
        inventarioId: null,
        cantidadDisponible: 0,
        tipoProducto: "COMPRADO",
        activoCatalogo: true,
        integraConVentas: true,
      });
    }
  }

  return map;
}

/** Stock de bodega de sucursal (recibido desde bodega general), keyed por producto_global_id. */
export async function fetchInventarioBodegaSucursalMap(
  branchId: string,
): Promise<Map<string, InventarioProductoInfo>> {
  const map = new Map<string, InventarioProductoInfo>();

  const { data: inventoryRows, error: invError } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select(`
      id,
      producto_global_id,
      cantidad_disponible,
      integra_con_ventas,
      productos_globales (
        id,
        tipo_producto,
        activo
      )
    `)
    .eq("sucursal_id", branchId);
  if (invError) throw invError;

  for (const row of (inventoryRows as any[]) ?? []) {
    const product = row.productos_globales as {
      id: string;
      tipo_producto: TipoProducto | null;
      activo: boolean;
    } | null;
    const productoGlobalId = String(row.producto_global_id ?? "");
    if (!productoGlobalId) continue;
    map.set(productoGlobalId, {
      productoId: productoGlobalId,
      inventarioId: row.id ?? null,
      cantidadDisponible: Number(row.cantidad_disponible ?? 0),
      tipoProducto: product?.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO",
      activoCatalogo: product?.activo ?? true,
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
